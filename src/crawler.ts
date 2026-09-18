import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import fs from "fs/promises";
import path from "path";
import {
  DomainConfig,
  PageAuditResult,
  DomainAuditResult,
  AuditIssue,
  IssueSummary,
  DomainSnapshot,
  PageSnapshot,
} from "./types.js";
import { validateSchemaOrg } from "./schema-validator.js";
import { evaluateAeo } from "./aeo-scorer.js";

const xmlParser = new XMLParser();

const USER_AGENT =
  "Mozilla/5.0 (compatible; SEOForgeBot/1.0; +https://github.com/Aryanban/seoforge)";

// Baseline counts from initial Ahrefs audit (2026-09-18) for webforge.me to track deltas
const AHREFS_BASELINE_WEBFORGE: Record<string, number> = {
  "Orphan page (has no incoming internal links)": 1,
  "Open Graph tags incomplete": 5,
  "H1 tag missing or empty": 1,
  "Low word count": 1,
  "3XX redirect": 1,
  "Changed pages not submitted to IndexNow": 5,
  "Structured data has Google rich results validation error": 5,
  "Structured data has schema.org validation error": 5,
  "Page has only one dofollow incoming internal link": 3,
  "HTTP to HTTPS redirect": 1,
};

function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    parsed.search = "";
    let p = parsed.pathname;
    if (p.length > 1 && p.endsWith("/")) {
      p = p.slice(0, -1);
    }
    return `${parsed.origin}${p}`.toLowerCase();
  } catch {
    return rawUrl.toLowerCase().trim().replace(/\/$/, "");
  }
}

export async function crawlDomain(
  domain: DomainConfig,
  options?: { sampleSitemap?: number; canonicalPolicy?: "strict" | "spa" }
): Promise<DomainAuditResult> {
  const pages: PageAuditResult[] = [];
  let robotsAccessible = false;
  let sitemapAccessible = false;
  let sitemapUrlCount = 0;
  let allSitemapUrls: string[] = [];
  let llmsTxtAccessible: boolean | undefined = undefined;
  let llmsFullTxtAccessible: boolean | undefined = undefined;

  const baseUrl = domain.url.endsWith("/") ? domain.url.slice(0, -1) : domain.url;
  const canonicalPolicy = options?.canonicalPolicy || domain.canonicalPolicy || "strict";
  const crawlDate = new Date().toISOString();

  // 1. Check robots.txt
  const robotsUrl = domain.robots || `${baseUrl}/robots.txt`;
  try {
    const res = await fetchWithTimeout(robotsUrl, 8000);
    robotsAccessible = res.status === 200;
  } catch {
    robotsAccessible = false;
  }

  // 2. Check sitemap.xml
  const sitemapUrl = domain.sitemap || `${baseUrl}/sitemap.xml`;
  try {
    const res = await fetchWithTimeout(sitemapUrl, 8000);
    if (res.status === 200) {
      sitemapAccessible = true;
      const text = await res.text();
      const parsed = xmlParser.parse(text);
      if (parsed?.urlset?.url) {
        const rawList = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
        allSitemapUrls = rawList
          .map((item: any) => (typeof item === "string" ? item : item.loc))
          .filter(Boolean);
        sitemapUrlCount = allSitemapUrls.length;
      }
    }
  } catch {
    sitemapAccessible = false;
  }

  // 3. Check llms.txt & llms-full.txt
  const llmsUrl = domain.llmsTxt || `${baseUrl}/llms.txt`;
  try {
    const res = await fetchWithTimeout(llmsUrl, 6000);
    llmsTxtAccessible = res.status === 200;
  } catch {
    llmsTxtAccessible = false;
  }

  const llmsFullUrl = domain.llmsFullTxt || `${baseUrl}/llms-full.txt`;
  try {
    const res = await fetchWithTimeout(llmsFullUrl, 6000);
    llmsFullTxtAccessible = res.status === 200;
  } catch {
    llmsFullTxtAccessible = false;
  }

  // 4. Crawl configured paths
  const paths = domain.paths && domain.paths.length > 0 ? domain.paths : ["/"];
  const crawledUrls = new Set<string>();

  for (const path of paths) {
    const fullUrl = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    crawledUrls.add(normalizeUrl(fullUrl));
    const pageResult = await crawlPage(fullUrl, domain.expectedEntities, canonicalPolicy);
    pages.push(pageResult);
  }

  // 5. Dynamic sitemap sampling
  const sampleCount = options?.sampleSitemap ?? domain.sampleSitemap ?? 0;
  let sampledCount = 0;
  if (sampleCount > 0 && allSitemapUrls.length > 0) {
    const pool = allSitemapUrls.filter((u) => !crawledUrls.has(normalizeUrl(u)));
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const sampledUrls = shuffled.slice(0, sampleCount);

    for (const sampledUrl of sampledUrls) {
      crawledUrls.add(normalizeUrl(sampledUrl));
      sampledCount++;
      const sampledResult = await crawlPage(sampledUrl, domain.expectedEntities, canonicalPolicy);
      pages.push(sampledResult);
    }
  }

  // 6. PHASE 2: Build Internal Link Graph & Detect Orphan / Single-Link Pages
  const incomingMap = new Map<string, Set<string>>();
  for (const page of pages) {
    const srcNorm = normalizeUrl(page.url);
    for (const target of page.outgoingInternalLinks) {
      const tgtNorm = normalizeUrl(target);
      if (!incomingMap.has(tgtNorm)) {
        incomingMap.set(tgtNorm, new Set<string>());
      }
      incomingMap.get(tgtNorm)!.add(srcNorm);
    }
  }

  const rootNormalized = normalizeUrl(domain.url);

  for (const page of pages) {
    const normUrl = normalizeUrl(page.url);
    const incomingSet = incomingMap.get(normUrl) || new Set<string>();
    // Exclude self-references
    incomingSet.delete(normUrl);
    page.incomingInternalLinks = Array.from(incomingSet);

    // Orphan Page Check: 0 incoming internal links from within the domain
    if (page.incomingInternalLinks.length === 0 && normUrl !== rootNormalized) {
      page.isOrphan = true;
      const issue: AuditIssue = {
        id: "orphan_page",
        name: "Orphan page (has no incoming internal links)",
        severity: "Error",
        message: "Page has no incoming internal links from any other crawled page on the domain.",
        url: page.url,
      };
      page.auditIssues.push(issue);
      page.issues.push(`[Error] ${issue.name}: ${issue.message}`);
    }

    // Single Link Check: Exactly 1 incoming internal link
    if (page.incomingInternalLinks.length === 1 && normUrl !== rootNormalized) {
      const issue: AuditIssue = {
        id: "single_incoming_link",
        name: "Page has only one dofollow incoming internal link",
        severity: "Notice",
        message: `Page has only 1 incoming internal link (from ${page.incomingInternalLinks[0]}).`,
        url: page.url,
        details: { linkedFrom: page.incomingInternalLinks[0] },
      };
      page.auditIssues.push(issue);
      page.issues.push(`[Notice] ${issue.name}: ${issue.message}`);
    }
  }

  // 7. PHASE 3: Historical Snapshot Comparison & Change Tracking
  const snapshotDir = path.resolve(process.cwd(), "reports/.snapshots");
  await fs.mkdir(snapshotDir, { recursive: true });
  const domainKey = domain.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const snapshotPath = path.join(snapshotDir, `${domainKey}.json`);

  let previousSnapshot: DomainSnapshot | null = null;
  try {
    const snapRaw = await fs.readFile(snapshotPath, "utf-8");
    previousSnapshot = JSON.parse(snapRaw);
  } catch {
    previousSnapshot = null;
  }

  // Detect tag/content changes vs previous snapshot
  if (previousSnapshot?.pages) {
    for (const page of pages) {
      const prev = previousSnapshot.pages[normalizeUrl(page.url)];
      if (prev) {
        if (prev.title && page.title && prev.title !== page.title) {
          const issue: AuditIssue = {
            id: "title_changed",
            name: "Title tag changed",
            severity: "Notice",
            message: `Title changed from '${prev.title}' to '${page.title}'.`,
            url: page.url,
          };
          page.auditIssues.push(issue);
          page.issues.push(`[Notice] ${issue.name}: ${issue.message}`);
        }

        if (prev.description && page.description && prev.description !== page.description) {
          const issue: AuditIssue = {
            id: "meta_desc_changed",
            name: "Meta description changed",
            severity: "Notice",
            message: `Meta description changed between crawls.`,
            url: page.url,
          };
          page.auditIssues.push(issue);
          page.issues.push(`[Notice] ${issue.name}: ${issue.message}`);
        }

        if (prev.h1Text && page.h1Text && prev.h1Text !== page.h1Text) {
          const issue: AuditIssue = {
            id: "h1_changed",
            name: "H1 tag changed",
            severity: "Notice",
            message: `H1 tag changed from '${prev.h1Text}' to '${page.h1Text}'.`,
            url: page.url,
          };
          page.auditIssues.push(issue);
          page.issues.push(`[Notice] ${issue.name}: ${issue.message}`);
        }

        if (prev.canonical && page.canonical && prev.canonical !== page.canonical) {
          const issue: AuditIssue = {
            id: "canonical_changed",
            name: "Canonical URL changed",
            severity: "Notice",
            message: `Canonical changed from '${prev.canonical}' to '${page.canonical}'.`,
            url: page.url,
          };
          page.auditIssues.push(issue);
          page.issues.push(`[Notice] ${issue.name}: ${issue.message}`);
        }

        if (Math.abs(page.wordCount - (prev.wordCount || 0)) > 25) {
          const issue: AuditIssue = {
            id: "word_count_changed",
            name: "Word count changed",
            severity: "Notice",
            message: `Word count changed from ${prev.wordCount} to ${page.wordCount}.`,
            url: page.url,
          };
          page.auditIssues.push(issue);
          page.issues.push(`[Notice] ${issue.name}: ${issue.message}`);
        }
      }
    }
  }

  // 8. PHASE 4: Group Issues into Ahrefs-Style Issue Summary
  const issuesMap = new Map<
    string,
    {
      id: string;
      name: string;
      severity: "Error" | "Warning" | "Notice";
      affectedUrls: Set<string>;
      recommendation: string;
    }
  >();

  for (const page of pages) {
    for (const issue of page.auditIssues) {
      if (!issuesMap.has(issue.name)) {
        issuesMap.set(issue.name, {
          id: issue.id,
          name: issue.name,
          severity: issue.severity,
          affectedUrls: new Set<string>(),
          recommendation: getRecommendationForIssue(issue.name),
        });
      }
      issuesMap.get(issue.name)!.affectedUrls.add(page.url);
    }
  }

  const issuesSummary: IssueSummary[] = [];
  const currentIssueCounts: Record<string, number> = {};

  for (const [name, data] of issuesMap.entries()) {
    const count = data.affectedUrls.size;
    currentIssueCounts[name] = count;

    let prevCount = 0;
    if (previousSnapshot?.issueCounts && previousSnapshot.issueCounts[name] !== undefined) {
      prevCount = previousSnapshot.issueCounts[name];
    } else if (domain.url.includes("webforge.me") && AHREFS_BASELINE_WEBFORGE[name] !== undefined) {
      prevCount = AHREFS_BASELINE_WEBFORGE[name];
    }

    const change = count - prevCount;

    issuesSummary.push({
      id: data.id,
      name,
      severity: data.severity,
      affectedPages: count,
      change,
      affectedUrls: Array.from(data.affectedUrls),
      recommendation: data.recommendation,
    });
  }

  // Also include resolved issues from previous baseline with negative change delta
  const baseline =
    domain.url.includes("webforge.me")
      ? AHREFS_BASELINE_WEBFORGE
      : previousSnapshot?.issueCounts || {};

  for (const [bName, bCount] of Object.entries(baseline)) {
    if (!currentIssueCounts[bName] && bCount > 0) {
      const severity = getSeverityForIssue(bName);
      issuesSummary.push({
        id: bName.toLowerCase().replace(/[^a-z0-9]/g, "_"),
        name: bName,
        severity,
        affectedPages: 0,
        change: -bCount,
        affectedUrls: [],
        recommendation: getRecommendationForIssue(bName),
      });
    }
  }

  // Sort: Error first, Warning second, Notice third; then by affected count descending
  const severityWeight = { Error: 3, Warning: 2, Notice: 1 };
  issuesSummary.sort((a, b) => {
    if (severityWeight[a.severity] !== severityWeight[b.severity]) {
      return severityWeight[b.severity] - severityWeight[a.severity];
    }
    return b.affectedPages - a.affectedPages;
  });

  const totalErrors = issuesSummary
    .filter((s) => s.severity === "Error")
    .reduce((acc, s) => acc + s.affectedPages, 0);
  const totalWarnings = issuesSummary
    .filter((s) => s.severity === "Warning")
    .reduce((acc, s) => acc + s.affectedPages, 0);
  const totalNotices = issuesSummary
    .filter((s) => s.severity === "Notice")
    .reduce((acc, s) => acc + s.affectedPages, 0);
  const totalIssues = totalErrors + totalWarnings + totalNotices;

  // 9. Save current crawl snapshot
  const currentSnapshot: DomainSnapshot = {
    domainUrl: domain.url,
    crawlDate,
    pages: {},
    issueCounts: currentIssueCounts,
  };
  for (const p of pages) {
    currentSnapshot.pages[normalizeUrl(p.url)] = {
      url: p.url,
      title: p.title,
      description: p.description,
      canonical: p.canonical,
      h1Text: p.h1Text,
      wordCount: p.wordCount,
      status: p.status,
    };
  }
  await fs.writeFile(snapshotPath, JSON.stringify(currentSnapshot, null, 2), "utf-8");

  const averageAeoScore =
    pages.length > 0
      ? Math.round(pages.reduce((acc, p) => acc + p.aeo.score, 0) / pages.length)
      : 0;

  const passed =
    pages.every((p) => p.status === 200 && p.canonicalMatches) &&
    robotsAccessible &&
    sitemapAccessible &&
    totalErrors === 0;

  return {
    domain,
    crawlDate,
    previousCrawlDate: previousSnapshot?.crawlDate,
    robotsAccessible,
    sitemapAccessible,
    sitemapUrlCount,
    llmsTxtAccessible,
    llmsFullTxtAccessible,
    sampledUrlsCount: sampledCount,
    pages,
    issuesSummary,
    totalErrors,
    totalWarnings,
    totalNotices,
    totalIssues,
    averageAeoScore,
    passed,
  };
}

export async function crawlPage(
  url: string,
  expectedEntities: string[] = [],
  canonicalPolicy: "strict" | "spa" = "strict"
): Promise<PageAuditResult> {
  const issues: string[] = [];
  const auditIssues: AuditIssue[] = [];
  const start = Date.now();
  let status = 0;
  let html = "";
  let finalUrl = url;
  let isRedirect = false;
  let isHttpToHttpsRedirect = false;
  const redirectChain: string[] = [];

  try {
    const res = await fetchWithTimeout(url, 12000);
    status = res.status;
    finalUrl = res.url || url;
    html = await res.text();

    if (url.startsWith("http://") && finalUrl.startsWith("https://")) {
      isHttpToHttpsRedirect = true;
      const issue: AuditIssue = {
        id: "http_to_https_redirect",
        name: "HTTP to HTTPS redirect",
        severity: "Notice",
        message: "Page requested over insecure HTTP redirects automatically to secure HTTPS.",
        url,
      };
      auditIssues.push(issue);
      issues.push(`[Notice] ${issue.name}`);
    }

    if (res.redirected || (status >= 300 && status < 400)) {
      isRedirect = true;
      redirectChain.push(url, finalUrl);
      const issue: AuditIssue = {
        id: "redirect_3xx",
        name: "3XX redirect",
        severity: "Warning",
        message: `URL redirected to '${finalUrl}' (status: ${status}).`,
        url,
      };
      auditIssues.push(issue);
      issues.push(`[Warning] ${issue.name}: ${url} -> ${finalUrl}`);
    }
  } catch (err: any) {
    const issue: AuditIssue = {
      id: "fetch_failure",
      name: "Page unreachable or request failed",
      severity: "Error",
      message: `Network fetch failed: ${err.message}`,
      url,
    };
    auditIssues.push(issue);
    issues.push(`[Error] ${issue.name}: ${issue.message}`);

    return {
      url,
      status: 0,
      responseTimeMs: Date.now() - start,
      canonicalMatches: false,
      wordCount: 0,
      h1Count: 0,
      openGraph: { incomplete: true, missingKeys: ["all"] },
      twitterCard: { incomplete: true },
      incomingInternalLinks: [],
      outgoingInternalLinks: [],
      externalLinks: [],
      isOrphan: false,
      isRedirect: false,
      isHttpToHttpsRedirect: false,
      schema: {
        hasJsonLd: false,
        typesFound: [],
        missingExpected: expectedEntities,
        googleRichResultsErrors: [],
        schemaOrgErrors: ["Page unreachable"],
        errors: ["Fetch failed"],
        rawGraphCount: 0,
      },
      aeo: {
        score: 0,
        h1Count: 0,
        h2Count: 0,
        hasInvertedPyramidSnippet: false,
        tableCount: 0,
        hasFaqSchema: false,
        recommendations: ["Page unreachable"],
      },
      issues,
      auditIssues,
    };
  }

  const responseTimeMs = Date.now() - start;
  if (responseTimeMs > 1200) {
    const issue: AuditIssue = {
      id: "high_latency",
      name: "High page response latency",
      severity: "Warning",
      message: `Response time was ${responseTimeMs}ms (exceeds recommended 1200ms threshold).`,
      url,
    };
    auditIssues.push(issue);
    issues.push(`[Warning] ${issue.name}: ${responseTimeMs}ms`);
  }

  const $ = cheerio.load(html);

  // 1. Title Tag
  const title = $("title").text().trim();
  if (!title) {
    const issue: AuditIssue = {
      id: "title_missing",
      name: "Title tag missing or empty",
      severity: "Warning",
      message: "The page has no <title> tag or the title is empty.",
      url,
    };
    auditIssues.push(issue);
    issues.push(`[Warning] ${issue.name}`);
  }

  // 2. Meta Description
  const description = $('meta[name="description"]').attr("content")?.trim();
  if (!description) {
    const issue: AuditIssue = {
      id: "meta_desc_missing",
      name: "Meta description missing or empty",
      severity: "Warning",
      message: "The page has no meta description tag.",
      url,
    };
    auditIssues.push(issue);
    issues.push(`[Warning] ${issue.name}`);
  }

  // 3. Canonical Tag
  const canonical = $('link[rel="canonical"]').attr("href")?.trim();
  let canonicalMatches = false;
  let isSpaCanonicalValid = false;

  if (!canonical) {
    const issue: AuditIssue = {
      id: "canonical_missing",
      name: "Canonical tag missing",
      severity: "Warning",
      message: "Missing <link rel='canonical'> tag in <head>.",
      url,
    };
    auditIssues.push(issue);
    issues.push(`[Warning] ${issue.name}`);
  } else {
    const normUrl = normalizeUrl(url);
    const normCanonical = normalizeUrl(canonical);
    canonicalMatches = normUrl === normCanonical;

    if (!canonicalMatches) {
      if (canonicalPolicy === "spa") {
        try {
          const parsedUrl = new URL(url);
          const parsedCanonical = new URL(canonical);
          if (parsedUrl.origin === parsedCanonical.origin && parsedCanonical.pathname === "/") {
            canonicalMatches = true;
            isSpaCanonicalValid = true;
          }
        } catch {}
      }

      if (!canonicalMatches) {
        const issue: AuditIssue = {
          id: "canonical_mismatch",
          name: "Canonical URL mismatch",
          severity: "Warning",
          message: `Declared canonical '${canonical}' does not match requested URL '${url}'.`,
          url,
        };
        auditIssues.push(issue);
        issues.push(`[Warning] ${issue.name}: declared '${canonical}', requested '${url}'.`);
      }
    }
  }

  // 4. Open Graph Tags
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim();
  const ogUrl = $('meta[property="og:url"]').attr("content")?.trim();
  const ogType = $('meta[property="og:type"]').attr("content")?.trim();

  const missingOgKeys: string[] = [];
  if (!ogTitle) missingOgKeys.push("og:title");
  if (!ogDesc) missingOgKeys.push("og:description");
  if (!ogImage) missingOgKeys.push("og:image");
  if (!ogUrl) missingOgKeys.push("og:url");

  const ogIncomplete = missingOgKeys.length > 0;
  if (ogIncomplete) {
    const issue: AuditIssue = {
      id: "og_tags_incomplete",
      name: "Open Graph tags incomplete",
      severity: "Warning",
      message: `Missing essential Open Graph properties: ${missingOgKeys.join(", ")}.`,
      url,
    };
    auditIssues.push(issue);
    issues.push(`[Warning] ${issue.name}: missing ${missingOgKeys.join(", ")}`);
  }

  const openGraph = {
    title: ogTitle,
    description: ogDesc,
    image: ogImage,
    url: ogUrl,
    type: ogType,
    incomplete: ogIncomplete,
    missingKeys: missingOgKeys,
  };

  // 5. Twitter Card Tags
  const twitterCardTag = $('meta[name="twitter:card"]').attr("content")?.trim();
  const twitterTitle = $('meta[name="twitter:title"]').attr("content")?.trim();
  const twitterDesc = $('meta[name="twitter:description"]').attr("content")?.trim();
  const twitterImage = $('meta[name="twitter:image"]').attr("content")?.trim();

  const twitterCard = {
    card: twitterCardTag,
    title: twitterTitle,
    description: twitterDesc,
    image: twitterImage,
    incomplete: !twitterCardTag || !twitterTitle || !twitterImage,
  };

  // 6. Heading (H1) Verification (Ahrefs Standard: H1 inside noscript does not count)
  // Check main DOM outside noscript
  const mainDom = cheerio.load(html);
  mainDom("noscript").remove();
  const domH1s = mainDom("h1");
  const h1Count = domH1s.length;
  const h1Text = h1Count > 0 ? domH1s.first().text().trim() : undefined;

  // Check if H1 exists only in noscript
  const allH1s = $("h1");
  const h1InNoscriptOnly = h1Count === 0 && allH1s.length > 0;

  if (h1Count === 0) {
    const msg = h1InNoscriptOnly
      ? "H1 tag missing in primary DOM (detected inside <noscript> only). Ahrefs and search engines require visible <h1> in the main body."
      : "The page has no <h1> tag or the tag is empty.";
    const issue: AuditIssue = {
      id: "h1_missing",
      name: "H1 tag missing or empty",
      severity: "Warning",
      message: msg,
      url,
    };
    auditIssues.push(issue);
    issues.push(`[Warning] ${issue.name}`);
  } else if (h1Count > 1) {
    const issue: AuditIssue = {
      id: "h1_multiple",
      name: "Multiple H1 tags found",
      severity: "Warning",
      message: `Page contains ${h1Count} <h1> tags. Standard SEO recommends exactly one primary <h1> per document.`,
      url,
    };
    auditIssues.push(issue);
    issues.push(`[Warning] ${issue.name}: ${h1Count} found`);
  }

  // 7. Word Count (Ahrefs Standard: Visible body text excluding scripts, styles, noscript)
  const textClone = cheerio.load(html);
  textClone("script, style, noscript, svg, link, meta").remove();
  const rawBodyText = textClone("body").text().replace(/\s+/g, " ").trim();
  const wordCount = rawBodyText ? rawBodyText.split(" ").filter(Boolean).length : 0;

  if (wordCount < 250) {
    const issue: AuditIssue = {
      id: "low_word_count",
      name: "Low word count",
      severity: "Warning",
      message: `Page body text has only ${wordCount} words (minimum threshold is 250 words for search indexing).`,
      url,
      details: { wordCount },
    };
    auditIssues.push(issue);
    issues.push(`[Warning] ${issue.name}: ${wordCount} words (target >= 250)`);
  }

  // 8. Link Extraction for Link Graph
  const outgoingInternalLinks: string[] = [];
  const externalLinks: string[] = [];
  let parsedCurrentUrl: URL;
  try {
    parsedCurrentUrl = new URL(url);
  } catch {
    parsedCurrentUrl = new URL("https://www.webforge.me/");
  }

  $("a[href]").each((_, el) => {
    const rawHref = $(el).attr("href")?.trim();
    if (!rawHref) return;
    if (
      rawHref.startsWith("#") ||
      rawHref.startsWith("javascript:") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:")
    ) {
      return;
    }

    try {
      const resolved = new URL(rawHref, parsedCurrentUrl.href);
      if (resolved.origin === parsedCurrentUrl.origin) {
        outgoingInternalLinks.push(resolved.href);
      } else {
        externalLinks.push(resolved.href);
      }
    } catch {}
  });

  // 9. Schema.org & Google Rich Results Evaluation
  const schema = validateSchemaOrg(html, expectedEntities);

  if (schema.googleRichResultsErrors.length > 0) {
    for (const err of schema.googleRichResultsErrors) {
      const issue: AuditIssue = {
        id: "schema_google_rich_results_error",
        name: "Structured data has Google rich results validation error",
        severity: "Notice",
        message: err,
        url,
      };
      auditIssues.push(issue);
      issues.push(`[Notice] ${issue.name}: ${err}`);
    }
  }

  if (schema.schemaOrgErrors.length > 0) {
    for (const err of schema.schemaOrgErrors) {
      const issue: AuditIssue = {
        id: "schema_org_validation_error",
        name: "Structured data has schema.org validation error",
        severity: "Notice",
        message: err,
        url,
      };
      auditIssues.push(issue);
      issues.push(`[Notice] ${issue.name}: ${err}`);
    }
  }

  if (schema.missingExpected.length > 0) {
    const issue: AuditIssue = {
      id: "schema_missing_expected",
      name: "Missing expected Schema.org entities",
      severity: "Notice",
      message: `Missing expected Schema.org entities: ${schema.missingExpected.join(", ")}.`,
      url,
    };
    auditIssues.push(issue);
    issues.push(`[Notice] ${issue.name}: ${schema.missingExpected.join(", ")}`);
  }

  // 10. AEO Scorer
  const aeo = evaluateAeo(html);

  return {
    url,
    status,
    responseTimeMs,
    canonical,
    canonicalMatches,
    isSpaCanonicalValid,
    title,
    description,
    wordCount,
    h1Count,
    h1Text,
    h1InNoscriptOnly,
    openGraph,
    twitterCard,
    incomingInternalLinks: [],
    outgoingInternalLinks,
    externalLinks,
    isOrphan: false,
    redirectChain: isRedirect ? redirectChain : undefined,
    isRedirect,
    isHttpToHttpsRedirect,
    schema,
    aeo,
    issues,
    auditIssues,
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function getSeverityForIssue(name: string): "Error" | "Warning" | "Notice" {
  if (name.includes("Orphan") || name.includes("4XX") || name.includes("5XX")) return "Error";
  if (
    name.includes("Open Graph") ||
    name.includes("H1 tag missing") ||
    name.includes("Low word count") ||
    name.includes("3XX redirect") ||
    name.includes("Multiple H1") ||
    name.includes("latency")
  ) {
    return "Warning";
  }
  return "Notice";
}

function getRecommendationForIssue(name: string): string {
  switch (name) {
    case "Orphan page (has no incoming internal links)":
      return "Add internal dofollow links pointing to this URL from the navigation bar, footer, or parent index page.";
    case "Open Graph tags incomplete":
      return "Ensure og:title, og:description, og:image (1200x630), and og:url are present in the <head> tags.";
    case "H1 tag missing or empty":
      return "Add a descriptive, single <h1> heading outside of <noscript> in the primary HTML DOM.";
    case "Low word count":
      return "Expand visible body text to at least 250–350 words of rich technical context and architectural copy.";
    case "3XX redirect":
      return "Update links to point directly to the destination URL without going through intermediate redirect hops.";
    case "Changed pages not submitted to IndexNow":
      return "Submit updated URLs to Bing & Yandex using the IndexNow protocol key.";
    case "Structured data has Google rich results validation error":
      return "Ensure SoftwareApplication has 'offers', 'review', or 'aggregateRating'; check Google Rich Results test requirements.";
    case "Structured data has schema.org validation error":
      return "Use typed EducationalOrganization/Organization nodes instead of string primitives for alumniOf/worksFor.";
    case "Page has only one dofollow incoming internal link":
      return "Cross-link this page from at least 2 other pages via contextual body links or navigation.";
    case "HTTP to HTTPS redirect":
      return "Ensure all internal links and search engine seed URLs strictly use https:// rather than http://.";
    default:
      return "Review page HTML metadata and optimize according to Google Search Essentials and Bing Webmaster Guidelines.";
  }
}
