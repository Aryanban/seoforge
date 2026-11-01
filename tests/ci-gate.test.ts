import { describe, it, expect } from "vitest";
import { evaluateCiGate } from "../src/analysis/ci-gate.js";
import { CrawlResult, PageAuditResult } from "../src/types.js";

function mockCrawl(totalErrors: number, totalWarnings: number, avgAeo: number, pages: Partial<PageAuditResult>[] = []): CrawlResult {
  return {
    id: "crawl_test",
    targetUrl: "https://mywebsite.com",
    strategy: "discover",
    startedAt: "2026-10-24T10:00:00Z",
    status: "completed",
    options: {},
    robotsAccessible: true,
    sitemapAccessible: true,
    sitemapUrlCount: 5,
    pages: pages.map((p) => ({
      url: "https://mywebsite.com/",
      normalizedUrl: "https://mywebsite.com/",
      finalUrl: "https://mywebsite.com/",
      status: 200,
      responseTimeMs: 100,
      depth: 1,
      rendered: false,
      isIndexable: true,
      blockedByRobots: false,
      canonical: "https://mywebsite.com/",
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
      ...p,
    })),
    links: [],
    sitemapEntries: [],
    issuesSummary: [],
    recommendations: [],
    totalErrors,
    totalWarnings,
    totalNotices: 0,
    totalIssues: totalErrors + totalWarnings,
    averageAeoScore: avgAeo,
    totalUrlsCrawled: pages.length || 1,
    maxDepthReached: 1,
    passed: totalErrors === 0,
  };
}

describe("CI/CD SEO Gatekeeper", () => {
  it("passes when all thresholds are satisfied", () => {
    const crawl = mockCrawl(0, 2, 85, [{ url: "https://mywebsite.com", status: 200, isIndexable: true }]);
    const result = evaluateCiGate(crawl, { maxErrors: 0, maxWarnings: 5, minAeoScore: 80 });

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.markdownReport).toContain("PASSED");
    expect(result.markdownReport).toContain("Ready for production deployment");
  });

  it("fails when critical errors or 404s are present", () => {
    const crawl = mockCrawl(1, 12, 60, [
      { url: "https://mywebsite.com/dead", status: 404, isIndexable: false },
    ]);
    const result = evaluateCiGate(crawl, { maxErrors: 0, maxWarnings: 10, minAeoScore: 70 });

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.rule.includes("Critical Errors"))).toBe(true);
    expect(result.violations.some((v) => v.rule.includes("Broken"))).toBe(true);
    expect(result.markdownReport).toContain("FAILED");
  });
});
