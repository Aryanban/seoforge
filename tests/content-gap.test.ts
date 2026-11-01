import { describe, it, expect } from "vitest";
import { analyzeContentGap, formatContentGapMarkdown } from "../src/analysis/content-gap.js";
import { CrawlResult, PageAuditResult } from "../src/types.js";

function makeFakePage(url: string, title: string, h1: string): PageAuditResult {
  return {
    url,
    normalizedUrl: url,
    finalUrl: url,
    status: 200,
    responseTimeMs: 100,
    ttfbMs: 50,
    depth: 1,
    rendered: false,
    title,
    titleLength: title.length,
    description: `${title} - High quality guide and product review.`,
    descriptionLength: 50,
    wordCount: 500,
    h1Count: 1,
    h1Text: h1,
    h2Count: 2,
    openGraph: { incomplete: false, missingKeys: [] },
    twitterCard: { incomplete: false },
    hreflang: [],
    incomingInternalLinks: [],
    outgoingInternalLinks: [],
    externalLinks: [],
    images: [],
    isOrphan: false,
    internalLinkScore: 10,
    isRedirect: false,
    isHttpToHttpsRedirect: false,
    isIndexable: true,
    canonicalMatches: true,
    blockedByRobots: false,
    schema: { schemas: [], validSchemas: [], invalidSchemas: [], errors: [], warnings: [] },
    aeo: { score: 85, breakdown: { directAnswerReadiness: 20, contentStructure: 20, schemaClarity: 15, brandAuthority: 15, citationSignals: 15 }, insights: [] },
    issues: [],
  };
}

function makeFakeCrawl(targetUrl: string, pages: PageAuditResult[]): CrawlResult {
  return {
    id: `crawl_${Math.random()}`,
    targetUrl,
    domainName: new URL(targetUrl).hostname,
    project: "test",
    strategy: "full-site",
    status: "completed",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    totalUrlsCrawled: pages.length,
    maxDepthReached: 1,
    totalErrors: 0,
    totalWarnings: 0,
    totalNotices: 0,
    totalIssues: 0,
    averageAeoScore: 85,
    robotsAccessible: true,
    sitemapAccessible: true,
    sitemapUrlCount: pages.length,
    llmsTxtAccessible: true,
    llmsFullTxtAccessible: true,
    passed: true,
    issuesSummary: [],
    pages,
    links: [],
    recommendations: [],
  };
}

describe("Keyword & Content Gap Engine (Semrush Parity)", () => {
  it("identifies Missing, Weak, and Shared keywords across competitors", () => {
    const baseline = makeFakeCrawl("https://mysite.com", [
      makeFakePage("https://mysite.com", "SEO Audit Automation Software", "SEO Audit Tool"),
      makeFakePage("https://mysite.com/pricing", "SEO Software Pricing", "Affordable SEO Plans"),
    ]);

    const competitorA = makeFakeCrawl("https://compa.com", [
      makeFakePage("https://compa.com", "SEO Audit Automation Software", "SEO Audit Tool"),
      makeFakePage("https://compa.com/backlink-checker", "Free Backlink Checker Tool", "Backlink Checker"),
    ]);

    const competitorB = makeFakeCrawl("https://compb.com", [
      makeFakePage("https://compb.com/backlink-checker", "Ultimate Backlink Checker Online", "Backlink Checker"),
      makeFakePage("https://compb.com/rank-tracker", "SERP Rank Tracking Tool", "SERP Rank Tracker"),
    ]);

    const report = analyzeContentGap(baseline, [competitorA, competitorB]);

    expect(report.baselineUrl).toBe("https://mysite.com");
    expect(report.competitorUrls.length).toBe(2);

    // "backlink checker" exact match should be identified as Missing because BOTH competitors have it in H1 and baseline has 0
    const blc = report.allGaps.find((g) => g.keyword === "backlink checker");
    expect(blc).toBeDefined();
    expect(blc?.status).toBe("Missing");
    expect(blc?.opportunityScore).toBeGreaterThan(60);

    // Format markdown
    const md = formatContentGapMarkdown(report);
    expect(md).toContain("# 🎯 Keyword & Content Gap Matrix");
    expect(md).toContain("`https://mysite.com`");
    expect(md).toContain("Missing Keywords");
  });
});
