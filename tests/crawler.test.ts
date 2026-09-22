import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startFixtureSite, FixtureSite } from "./fixtures/site.js";
import { crawlSite } from "../src/crawl/crawler.js";

describe("full-site crawler", () => {
  let site: FixtureSite;

  beforeAll(async () => {
    site = await startFixtureSite();
  });

  afterAll(async () => {
    await site.close();
  });

  it("crawls a fixture site and detects every planted defect", async () => {
    const result = await crawlSite(`${site.url}/`, {
      strategy: "discover",
      maxDepth: 3,
      limit: 30,
      concurrency: 4,
      respectRobots: false,
      checkExternalLinks: false,
      paths: ["/orphan"],
      timeoutMs: 4000,
      followSitemap: false,
    });

    expect(result.status).toBe("completed");
    expect(result.totalUrlsCrawled).toBeGreaterThanOrEqual(7);

    const issueNames = new Set(result.issuesSummary.map((i) => i.name));
    const pageByUrl = new Map(result.pages.map((p) => [p.url, p]));

    // Broken internal link (404 target)
    expect(issueNames.has("Broken internal link")).toBe(true);
    const brokenPage = pageByUrl.get(`${site.url}/broken-link`);
    expect(brokenPage?.auditIssues.some((i) => i.id === "broken_internal_link")).toBe(true);

    // Missing title
    expect(issueNames.has("Title tag missing or empty")).toBe(true);

    // Missing H1
    expect(issueNames.has("H1 tag missing or empty")).toBe(true);

    // Thin content
    expect(issueNames.has("Low word count")).toBe(true);

    // Missing image alt
    expect(issueNames.has("Image missing alt text")).toBe(true);

    // Orphan page (seeded, never linked to)
    const orphan = pageByUrl.get(`${site.url}/orphan`);
    expect(orphan?.isOrphan).toBe(true);
    expect(orphan?.auditIssues.some((i) => i.id === "orphan_page")).toBe(true);

    // The healthy homepage must NOT be flagged as an orphan or missing title
    const home = pageByUrl.get(`${site.url}/`);
    expect(home?.title).toBe("SEOForge Fixture — Home");
    expect(home?.canonicalMatches).toBe(true);
    expect(home?.isOrphan).toBe(false);
    expect(home?.schema.hasJsonLd).toBe(true);
    expect(home?.schema.typesFound).toContain("WebSite");
    expect(home?.schema.typesFound).toContain("FAQPage");
    expect(home?.aeo.hasFaqSchema).toBe(true);
  }, 30000);

  it("follows redirects and records the chain", async () => {
    const result = await crawlSite(`${site.url}/redirect`, {
      maxDepth: 1,
      limit: 5,
      respectRobots: false,
      checkExternalLinks: false,
      timeoutMs: 4000,
      followSitemap: false,
    });
    const redirectPage = result.pages.find((p) => p.url.includes("/redirect"));
    expect(redirectPage).toBeDefined();
    expect(redirectPage?.isRedirect).toBe(true);
    expect(redirectPage?.auditIssues.some((i) => i.id === "redirect_3xx")).toBe(true);
  }, 15000);

  it("seeds from the sitemap in sitemap strategy", async () => {
    const result = await crawlSite(`${site.url}/`, {
      strategy: "sitemap",
      maxDepth: 1,
      limit: 20,
      respectRobots: false,
      checkExternalLinks: false,
      timeoutMs: 4000,
      followSitemap: true,
      sitemapOverride: `${site.url}/sitemap.xml`,
    });
    expect(result.sitemapAccessible).toBe(true);
    expect(result.sitemapUrlCount).toBe(3);
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain(`${site.url}/orphan`);
  }, 15000);
});
