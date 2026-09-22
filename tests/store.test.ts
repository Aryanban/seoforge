import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { startFixtureSite, FixtureSite } from "./fixtures/site.js";
import { crawlSite } from "../src/crawl/crawler.js";
import { openStore, closeStore, migrateLegacySnapshots } from "../src/store/db.js";
import * as repo from "../src/store/repository.js";

describe("persistence layer", () => {
  let site: FixtureSite;
  let tmpDir: string;
  let dbPath: string;
  let crawlId: string;

  beforeAll(async () => {
    site = await startFixtureSite();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "seoforge-test-"));
    dbPath = path.join(tmpDir, "seoforge.db");

    const result = await crawlSite(`${site.url}/`, {
      maxDepth: 2,
      limit: 20,
      respectRobots: false,
      checkExternalLinks: false,
      timeoutMs: 4000,
      followSitemap: false,
      paths: ["/orphan"],
    });
    crawlId = result.id;

    const db = openStore(dbPath);
    repo.saveCrawl(db, result);
  });

  afterAll(async () => {
    closeStore();
    await site.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("lists saved crawls", () => {
    const db = openStore(dbPath);
    const list = repo.listCrawls(db, 10);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((c) => c.id === crawlId)).toBe(true);
  });

  it("reads grouped issues", () => {
    const db = openStore(dbPath);
    const { rows, total } = repo.getIssues(db, crawlId);
    expect(total).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.name === "Title tag missing or empty")).toBe(true);
  });

  it("reads pages with filters", () => {
    const db = openStore(dbPath);
    const all = repo.getPages(db, crawlId);
    expect(all.total).toBeGreaterThanOrEqual(6);
    const thin = repo.getPages(db, crawlId, { search: "orphan" });
    expect(thin.rows.some((p) => p.url.includes("/orphan"))).toBe(true);
  });

  it("reads recommendations persisted from the crawl", () => {
    const db = openStore(dbPath);
    const recs = repo.getRecommendations(db, crawlId);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some((r) => r.markdown.includes("How to fix"))).toBe(true);
  });

  it("rebuilds the full crawl result after a restart", () => {
    closeStore();
    const db = openStore(dbPath);
    const full = repo.getFullCrawl(db, crawlId);
    expect(full).not.toBeNull();
    expect(full!.pages.length).toBeGreaterThanOrEqual(6);
    expect(full!.recommendations.length).toBeGreaterThan(0);
    const orphan = full!.pages.find((p) => p.isOrphan);
    expect(orphan).toBeDefined();
  });

  it("reconstructs crawls larger than the pagination cap (regression)", () => {
    // getFullCrawl must return the WHOLE crawl, not a paginated slice.
    // A pageSize clamp of 500 used to silently truncate big sites, which
    // under-counted issues in every exported report.
    const db = openStore(path.join(tmpDir, "big.db"));
    const count = 600;
    const pages = Array.from({ length: count }, (_, i) =>
      ({
        url: `https://big.example.com/p${i}`,
        normalizedUrl: `https://big.example.com/p${i}`,
        finalUrl: `https://big.example.com/p${i}`,
        status: 200,
        responseTimeMs: 100,
        ttfbMs: 50,
        depth: 1,
        rendered: false,
        canonical: `https://big.example.com/p${i}`,
        canonicalMatches: true,
        title: `Page ${i}`,
        description: "desc",
        wordCount: 500,
        h1Count: 1,
        h1Text: `Page ${i}`,
        h2Count: 1,
        incomingInternalLinks: [],
        outgoingInternalLinks: [],
        externalLinks: [],
        isOrphan: false,
        internalLinkScore: 1,
        isIndexable: true,
        auditIssues: [
          { id: "meta_description_long", name: "Meta description too long", severity: "Warning", category: "Meta", message: "too long", url: `https://big.example.com/p${i}` },
        ],
        aeo: { score: 100, answerParagraphFound: true, invertedPyramid: true, schemaCoverage: 1, faqPresent: false, factors: [] },
        schema: { hasJsonLd: false, typesFound: [], missingExpected: [], googleRichResultsErrors: [], schemaOrgErrors: [], errors: [], rawGraphCount: 0 },
      } as any)
    );
    const links = Array.from({ length: count }, (_, i) => ({
      source: `https://big.example.com/p${i}`,
      target: `https://big.example.com/p${(i + 1) % count}`,
      anchorText: "next",
      nofollow: false,
      isInternal: true,
      targetStatus: 200,
      isBroken: false,
      isRedirect: false,
      redirectChain: [],
    }));

    repo.saveCrawl(db, {
      id: "crawl_big",
      targetUrl: "https://big.example.com/",
      strategy: "discover",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      options: {} as any,
      robotsAccessible: true,
      sitemapAccessible: false,
      sitemapUrlCount: 0,
      pages,
      links,
      sitemapEntries: [],
      issuesSummary: [],
      recommendations: [],
      totalErrors: 0,
      totalWarnings: count,
      totalNotices: 0,
      totalUrlsCrawled: count,
      maxDepthReached: 1,
      averageAeoScore: 100,
      passed: false,
    } as any);

    const full = repo.getFullCrawl(db, "crawl_big");
    expect(full).not.toBeNull();
    expect(full!.pages.length).toBe(count);
    expect(full!.links.length).toBe(count);
    // Issue counts must reflect every page, not a truncated slice.
    const meta = full!.issuesSummary.find((i) => i.name === "Meta description too long");
    expect(meta?.affectedPages).toBe(count);
    expect(meta?.affectedUrls.length).toBe(count);
  });

  it("migrates legacy JSON snapshots", async () => {    const legacyDir = path.join(tmpDir, "legacy");
    const snapshotDir = path.join(legacyDir, "reports", ".snapshots");
    await fs.mkdir(snapshotDir, { recursive: true });
    await fs.writeFile(
      path.join(snapshotDir, "example-com.json"),
      JSON.stringify({
        domainUrl: "https://example.com",
        crawlDate: "2026-01-01T00:00:00.000Z",
        pages: {
          "https://example.com/": {
            url: "https://example.com/",
            title: "Legacy Home",
            wordCount: 100,
            status: 200,
          },
        },
        issueCounts: {},
      }),
      "utf-8"
    );

    const migrated = await migrateLegacySnapshots(legacyDir);
    expect(migrated).toBe(1);

    const db = openStore(path.join(legacyDir, "reports", "seoforge.db"));
    const list = repo.listCrawls(db, 10, "https://example.com");
    expect(list.some((c) => c.id === "legacy_example-com")).toBe(true);
  });
});
