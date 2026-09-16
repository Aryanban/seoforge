import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { DomainConfig, PageAuditResult, DomainAuditResult } from "./types.js";
import { validateSchemaOrg } from "./schema-validator.js";
import { evaluateAeo } from "./aeo-scorer.js";

const xmlParser = new XMLParser();

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

  // 1. Check robots.txt
  const robotsUrl = domain.robots || `${baseUrl}/robots.txt`;
  try {
    const res = await fetch(robotsUrl, { method: "GET", headers: { "User-Agent": "SEOForge-Bot/1.0" } });
    if (res.status === 200) {
      robotsAccessible = true;
    }
  } catch {
    robotsAccessible = false;
  }

  // 2. Check sitemap.xml
  const sitemapUrl = domain.sitemap || `${baseUrl}/sitemap.xml`;
  try {
    const res = await fetch(sitemapUrl, { method: "GET", headers: { "User-Agent": "SEOForge-Bot/1.0" } });
    if (res.status === 200) {
      sitemapAccessible = true;
      const text = await res.text();
      const parsed = xmlParser.parse(text);
      if (parsed?.urlset?.url) {
        const rawList = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
        allSitemapUrls = rawList.map((item: any) => (typeof item === "string" ? item : item.loc)).filter(Boolean);
        sitemapUrlCount = allSitemapUrls.length;
      }
    }
  } catch {
    sitemapAccessible = false;
  }

  // 3. Check llms.txt & llms-full.txt
  const llmsUrl = domain.llmsTxt || `${baseUrl}/llms.txt`;
  try {
    const res = await fetch(llmsUrl, { method: "GET", headers: { "User-Agent": "SEOForge-Bot/1.0" } });
    llmsTxtAccessible = res.status === 200;
  } catch {
    llmsTxtAccessible = false;
  }

  const llmsFullUrl = domain.llmsFullTxt || `${baseUrl}/llms-full.txt`;
  try {
    const res = await fetch(llmsFullUrl, { method: "GET", headers: { "User-Agent": "SEOForge-Bot/1.0" } });
    llmsFullTxtAccessible = res.status === 200;
  } catch {
    llmsFullTxtAccessible = false;
  }

  // 4. Crawl configured paths
  const paths = domain.paths && domain.paths.length > 0 ? domain.paths : ["/"];
  const crawledUrls = new Set<string>();

  for (const path of paths) {
    const fullUrl = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    crawledUrls.add(fullUrl);
    const pageResult = await crawlPage(fullUrl, domain.expectedEntities, canonicalPolicy);
    pages.push(pageResult);
  }

  // 5. Dynamic sitemap sampling
  const sampleCount = options?.sampleSitemap ?? domain.sampleSitemap ?? 0;
  let sampledCount = 0;
  if (sampleCount > 0 && allSitemapUrls.length > 0) {
    const pool = allSitemapUrls.filter((u) => !crawledUrls.has(u));
    // Fisher-Yates shuffle or random pick
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const sampledUrls = shuffled.slice(0, sampleCount);

    for (const sampledUrl of sampledUrls) {
      crawledUrls.add(sampledUrl);
      sampledCount++;
      const sampledResult = await crawlPage(sampledUrl, domain.expectedEntities, canonicalPolicy);
      pages.push(sampledResult);
    }
  }

  const averageAeoScore =
    pages.length > 0
      ? Math.round(pages.reduce((acc, p) => acc + p.aeo.score, 0) / pages.length)
      : 0;

  const passed =
    pages.every((p) => p.status === 200 && p.canonicalMatches) &&
    robotsAccessible &&
    sitemapAccessible;

  return {
    domain,
    robotsAccessible,
    sitemapAccessible,
    sitemapUrlCount,
    llmsTxtAccessible,
    llmsFullTxtAccessible,
    sampledUrlsCount: sampledCount,
    pages,
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
  const start = Date.now();
  let status = 0;
  let html = "";

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "SEOForge-Bot/1.0 (+https://github.com/Aryanban/seoforge)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    status = res.status;
    html = await res.text();
  } catch (err: any) {
    issues.push(`Network fetch failure: ${err.message}`);
    return {
      url,
      status: 0,
      responseTimeMs: Date.now() - start,
      canonicalMatches: false,
      openGraph: {},
      schema: {
        hasJsonLd: false,
        typesFound: [],
        missingExpected: expectedEntities,
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
    };
  }

  const responseTimeMs = Date.now() - start;
  if (responseTimeMs > 1200) {
    issues.push(`High response latency: ${responseTimeMs}ms (exceeds 1200ms target).`);
  }

  const $ = cheerio.load(html);
  const title = $("title").text().trim();
  const description = $('meta[name="description"]').attr("content")?.trim();
  const canonical = $('link[rel="canonical"]').attr("href")?.trim();

  if (!title) issues.push("Missing <title> tag.");
  if (!description) issues.push("Missing meta description.");
  if (!canonical) issues.push("Missing <link rel='canonical'>.");

  let canonicalMatches = false;
  let isSpaCanonicalValid = false;

  if (canonical) {
    const normUrl = url.replace(/\/$/, "");
    const normCanonical = canonical.replace(/\/$/, "");
    canonicalMatches = normUrl === normCanonical;

    if (!canonicalMatches) {
      if (canonicalPolicy === "spa") {
        try {
          const parsedUrl = new URL(url);
          const parsedCanonical = new URL(canonical);
          if (parsedUrl.origin === parsedCanonical.origin && parsedCanonical.pathname === "/") {
            // Valid SPA root fallback
            canonicalMatches = true;
            isSpaCanonicalValid = true;
          }
        } catch {}
      }

      if (!canonicalMatches) {
        issues.push(`Canonical mismatch: declared '${canonical}', requested '${url}'.`);
      }
    }
  }

  const openGraph = {
    title: $('meta[property="og:title"]').attr("content")?.trim(),
    description: $('meta[property="og:description"]').attr("content")?.trim(),
    type: $('meta[property="og:type"]').attr("content")?.trim(),
  };

  if (!openGraph.title) issues.push("Missing og:title OpenGraph property.");

  // Schema & AEO evaluations
  const schema = validateSchemaOrg(html, expectedEntities);
  if (schema.missingExpected.length > 0) {
    issues.push(`Missing expected Schema.org entities: ${schema.missingExpected.join(", ")}.`);
  }

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
    openGraph,
    schema,
    aeo,
    issues,
  };
}

