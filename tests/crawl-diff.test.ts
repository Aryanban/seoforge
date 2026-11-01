import { describe, it, expect } from "vitest";
import { compareCrawls, formatCrawlDiffMarkdown } from "../src/analysis/crawl-diff.js";
import { CrawlResult, PageAuditResult } from "../src/types.js";

function mockPage(url: string, status = 200, title = "Title", isIndexable = true): PageAuditResult {
  return {
    url,
    normalizedUrl: url,
    finalUrl: url,
    status,
    responseTimeMs: 100,
    depth: 1,
    rendered: false,
    title,
    isIndexable,
    blockedByRobots: false,
    canonical: url,
    canonicalMatches: true,
    wordCount: 500,
    h1Count: 1,
    h2Count: 2,
    issues: [],
    auditIssues: [],
    openGraph: { incomplete: false, missingKeys: [] },
    twitterCard: { incomplete: false },
    hreflang: [],
    incomingInternalLinks: [],
    outgoingInternalLinks: [],
    externalLinks: [],
    images: [],
    isOrphan: false,
    internalLinkScore: 1,
    isRedirect: false,
    isHttpToHttpsRedirect: false,
    schema: { hasJsonLd: true, typesFound: [], missingExpected: [], googleRichResultsErrors: [], schemaOrgErrors: [], errors: [], rawGraphCount: 1 },
    aeo: { score: 90, h1Count: 1, h2Count: 2, hasInvertedPyramidSnippet: true, tableCount: 1, hasFaqSchema: true, recommendations: [] },
  };
}

function mockCrawl(id: string, pages: PageAuditResult[]): CrawlResult {
  return {
    id,
    targetUrl: "https://example.com",
    strategy: "discover",
    startedAt: "2026-10-24T10:00:00Z",
    status: "completed",
    options: {},
    robotsAccessible: true,
    sitemapAccessible: true,
    sitemapUrlCount: 10,
    pages,
    links: [],
    sitemapEntries: [],
    issuesSummary: [],
    recommendations: [],
    totalErrors: 0,
    totalWarnings: 0,
    totalNotices: 0,
    totalIssues: 0,
    averageAeoScore: 90,
    totalUrlsCrawled: pages.length,
    maxDepthReached: 1,
    passed: true,
  };
}

describe("Crawl Diff Engine (Screaming Frog & Sitebulb parity)", () => {
  it("detects added and removed URLs", () => {
    const base = mockCrawl("crawl_1", [
      mockPage("https://example.com/"),
      mockPage("https://example.com/about"),
    ]);
    const target = mockCrawl("crawl_2", [
      mockPage("https://example.com/"),
      mockPage("https://example.com/pricing"),
    ]);

    const diff = compareCrawls(base, target);
    expect(diff.urlsAdded).toEqual(["https://example.com/pricing"]);
    expect(diff.urlsRemoved).toEqual(["https://example.com/about"]);
    expect(diff.summary.addedCount).toBe(1);
    expect(diff.summary.removedCount).toBe(1);
  });

  it("detects HTTP status regressions and meta changes", () => {
    const base = mockCrawl("crawl_1", [
      mockPage("https://example.com/blog", 200, "Old Title"),
      mockPage("https://example.com/contact", 200, "Contact Us"),
    ]);
    const target = mockCrawl("crawl_2", [
      mockPage("https://example.com/blog", 404, "Not Found"),
      mockPage("https://example.com/contact", 200, "Contact Our Team"),
    ]);

    const diff = compareCrawls(base, target);
    expect(diff.statusChanges).toHaveLength(1);
    expect(diff.statusChanges[0].isRegression).toBe(true);
    expect(diff.statusChanges[0].fromStatus).toBe(200);
    expect(diff.statusChanges[0].toStatus).toBe(404);

    expect(diff.metaChanges.some((m) => m.field === "title" && m.to === "Contact Our Team")).toBe(true);
    expect(diff.summary.isCleanDeploy).toBe(false);

    const md = formatCrawlDiffMarkdown(diff);
    expect(md).toContain("Regressions Detected");
    expect(md).toContain("HTTP 200 → **HTTP 404**");
  });

  it("detects indexability shifts", () => {
    const p1 = mockPage("https://example.com/private", 200, "Private", true);
    const p2 = mockPage("https://example.com/private", 200, "Private", false);
    p2.blockedByRobots = true;

    const base = mockCrawl("c1", [p1]);
    const target = mockCrawl("c2", [p2]);

    const diff = compareCrawls(base, target);
    expect(diff.indexabilityChanges).toHaveLength(1);
    expect(diff.indexabilityChanges[0].lostIndexability).toBe(true);
  });
});
