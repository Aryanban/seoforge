import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { DomainConfig, PageAuditResult, DomainAuditResult } from "./types.js";
import { validateSchemaOrg } from "./schema-validator.js";
import { evaluateAeo } from "./aeo-scorer.js";

const xmlParser = new XMLParser();

export async function crawlDomain(domain: DomainConfig): Promise<DomainAuditResult> {
  const pages: PageAuditResult[] = [];
  let robotsAccessible = false;
  let sitemapAccessible = false;
  let sitemapUrlCount = 0;

  // 1. Check robots.txt
  if (domain.robots) {
    try {
      const res = await fetch(domain.robots, { method: "GET", headers: { "User-Agent": "SEOForge-Bot/1.0" } });
      if (res.status === 200) {
        robotsAccessible = true;
      }
    } catch {
      robotsAccessible = false;
    }
  }

  // 2. Check sitemap.xml
  if (domain.sitemap) {
    try {
      const res = await fetch(domain.sitemap, { method: "GET", headers: { "User-Agent": "SEOForge-Bot/1.0" } });
      if (res.status === 200) {
        sitemapAccessible = true;
        const text = await res.text();
        const parsed = xmlParser.parse(text);
        if (parsed?.urlset?.url) {
          sitemapUrlCount = Array.isArray(parsed.urlset.url)
            ? parsed.urlset.url.length
            : 1;
        }
      }
    } catch {
      sitemapAccessible = false;
    }
  }

  // 3. Crawl configured paths
  const paths = domain.paths && domain.paths.length > 0 ? domain.paths : ["/"];
  const baseUrl = domain.url.endsWith("/") ? domain.url.slice(0, -1) : domain.url;

  for (const path of paths) {
    const fullUrl = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const pageResult = await crawlPage(fullUrl, domain.expectedEntities);
    pages.push(pageResult);
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
    pages,
    averageAeoScore,
    passed,
  };
}

async function crawlPage(url: string, expectedEntities: string[] = []): Promise<PageAuditResult> {
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
  if (canonical) {
    const normUrl = url.replace(/\/$/, "");
    const normCanonical = canonical.replace(/\/$/, "");
    canonicalMatches = normUrl === normCanonical;
    if (!canonicalMatches) {
      issues.push(`Canonical mismatch: declared '${canonical}', requested '${url}'.`);
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
    title,
    description,
    openGraph,
    schema,
    aeo,
    issues,
  };
}
