import { describe, it, expect } from "vitest";
import { compareCompetitors, comparisonMarkdown } from "../src/competitors/index.js";
import type { CrawlResult } from "../src/types.js";

/** Build a minimal but well-typed crawl fixture for comparison tests. */
function mkCrawl(opts: {
  url: string;
  name: string;
  aeo?: number;
  words?: number;
  schema?: boolean;
  errs?: number;
  warns?: number;
  linkScore?: number;
  broken?: number;
  https?: boolean;
  budget?: number;
}): CrawlResult {
  const aeo = opts.aeo ?? 70;
  const words = opts.words ?? 500;
  const pages = Array.from({ length: 10 }, (_, i) => ({
    url: `${opts.url}/p${i}`,
    normalizedUrl: `${opts.url}/p${i}`,
    finalUrl: `https://${opts.https === false ? "" : ""}${opts.url.replace(/^https?:\/\//, "")}/p${i}`,
    status: 200,
    responseTimeMs: 100,
    depth: 1,
    rendered: false,
    canonical: `${opts.url}/p${i}`,
    canonicalMatches: true,
    title: "A title of normal length",
    titleLength: 45,
    description: "A description",
    descriptionLength: 140,
    wordCount: words,
    h1Count: 1,
    h2Count: 2,
    hreflang: [],
    incomingInternalLinks: [],
    outgoingInternalLinks: [],
    externalLinks: [],
    images: [],
    isOrphan: false,
    internalLinkScore: opts.linkScore ?? 50,
    isIndexable: true,
    blockedByRobots: false,
    schema: { typesFound: opts.schema === false ? [] : ["WebSite"] },
    aeo: { score: aeo },
    openGraph: { incomplete: false, missingKeys: [] },
    twitterCard: "",
    auditIssues: [],
    issues: [],
  }));
  return {
    id: `crawl_${opts.name}`,
    targetUrl: opts.url,
    domainName: opts.name,
    strategy: "discover",
    startedAt: "2026-09-22T00:00:00Z",
    finishedAt: "2026-09-22T00:01:00Z",
    status: "completed",
    options: { limit: opts.budget ?? 100 },
    robotsAccessible: true,
    sitemapAccessible: true,
    sitemapUrlCount: 10,
    pages: pages as never,
    links: Array.from({ length: opts.broken ?? 0 }, (_, i) => ({
      crawlId: `crawl_${opts.name}`,
      source: `${opts.url}/p0`,
      target: `${opts.url}/broken-${i}`,
      anchorText: "x",
      nofollow: false,
      isInternal: true,
      targetStatus: 404,
      isBroken: true,
      isRedirect: false,
      redirectChain: [],
    })),
    sitemapEntries: [],
    issuesSummary: [
      {
        id: "e1",
        name: "Broken link",
        severity: "Error",
        category: "Links",
        affectedPages: opts.errs ?? 0,
        change: 0,
        affectedUrls: [],
        recommendation: "",
      },
      {
        id: "w1",
        name: "Title too long",
        severity: "Warning",
        category: "Meta",
        affectedPages: opts.warns ?? 0,
        change: 0,
        affectedUrls: [],
        recommendation: "",
      },
    ],
    recommendations: [],
    totalErrors: opts.errs ?? 0,
    totalWarnings: opts.warns ?? 0,
    totalNotices: 0,
    totalIssues: (opts.errs ?? 0) + (opts.warns ?? 0),
    averageAeoScore: aeo,
    totalUrlsCrawled: 10,
    maxDepthReached: 1,
    passed: true,
  };
}

describe("competitor comparison", () => {
  it("compares measured metrics across sites", () => {
    const base = mkCrawl({ url: "https://ours.com", name: "ours.com", aeo: 70, words: 500, warns: 40 });
    const comp = mkCrawl({ url: "https://rival.com", name: "rival.com", aeo: 90, words: 900, warns: 5 });
    const cmp = compareCompetitors(base, [comp]);
    const byKey = Object.fromEntries(cmp.metrics.map((m) => [m.key, m]));
    expect(byKey.aeo.baseline).toBe(70);
    expect(byKey.aeo.competitors[0]).toBe(90);
    expect(byKey.warnings.baseline).toBe(40);
    expect(byKey.warnings.competitors[0]).toBe(5);
  });

  it("flags gaps where a competitor leads and reports strengths", () => {
    const base = mkCrawl({ url: "https://ours.com", name: "ours.com", aeo: 60, words: 300, linkScore: 20 });
    const comp = mkCrawl({ url: "https://rival.com", name: "rival.com", aeo: 85, words: 800, linkScore: 75 });
    const cmp = compareCompetitors(base, [comp]);
    expect(cmp.gaps.length).toBeGreaterThan(0);
    expect(cmp.gaps.some((g) => g.metric === "aeo")).toBe(true);
    expect(cmp.strengths).toHaveLength(0);
  });

  it("recognizes where the baseline leads every competitor", () => {
    const base = mkCrawl({ url: "https://ours.com", name: "ours.com", aeo: 95, words: 1000, linkScore: 90 });
    const comp = mkCrawl({ url: "https://rival.com", name: "rival.com", aeo: 50, words: 400, linkScore: 30 });
    const cmp = compareCompetitors(base, [comp]);
    expect(cmp.strengths).toContain("Average AEO score");
    expect(cmp.gaps).toHaveLength(0);
  });

  it("treats a lower-is-better metric as a gap only when the competitor is lower", () => {
    const base = mkCrawl({ url: "https://ours.com", name: "ours.com", broken: 5 });
    const comp = mkCrawl({ url: "https://rival.com", name: "rival.com", broken: 0 });
    const cmp = compareCompetitors(base, [comp]);
    const brokenGap = cmp.gaps.find((g) => g.metric === "broken");
    expect(brokenGap).toBeDefined();
    expect(brokenGap!.shortfall).toBe(5);
  });

  it("marks uneven crawl budgets as not comparable", () => {
    const base = mkCrawl({ url: "https://ours.com", name: "ours.com", budget: 1000 });
    const comp = mkCrawl({ url: "https://rival.com", name: "rival.com", budget: 10 });
    const cmp = compareCompetitors(base, [comp]);
    expect(cmp.budgetComparable).toBe(false);
    expect(cmp.limitations.some((l) => l.includes("NOT comparable"))).toBe(true);
  });

  it("accepts comparable budgets", () => {
    const base = mkCrawl({ url: "https://ours.com", name: "ours.com", budget: 100 });
    const comp = mkCrawl({ url: "https://rival.com", name: "rival.com", budget: 100 });
    const cmp = compareCompetitors(base, [comp]);
    expect(cmp.budgetComparable).toBe(true);
  });

  it("requires at least one competitor", () => {
    const base = mkCrawl({ url: "https://ours.com", name: "ours.com" });
    expect(() => compareCompetitors(base, [])).toThrow("at least one competitor");
  });

  it("caps the competitor count at five", () => {
    const base = mkCrawl({ url: "https://ours.com", name: "ours.com" });
    const comps = Array.from({ length: 6 }, (_, i) => mkCrawl({ url: `https://c${i}.com`, name: `c${i}.com` }));
    expect(() => compareCompetitors(base, comps)).toThrow("at most five");
  });

  it("renders a markdown matrix, gaps and limits", () => {
    const base = mkCrawl({ url: "https://ours.com", name: "ours.com", aeo: 60 });
    const comp = mkCrawl({ url: "https://rival.com", name: "rival.com", aeo: 85 });
    const md = comparisonMarkdown(compareCompetitors(base, [comp]));
    expect(md).toContain("# Competitor gap analysis: ours.com");
    expect(md).toContain("## Metric matrix");
    expect(md).toContain("## Limits");
  });
});
