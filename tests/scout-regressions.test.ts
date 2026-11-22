/** Regression tests for bugs found in the codebase-wide bug hunt. */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditAiBotPosture } from "../src/analysis/ai-crawlers.js";
import { checkSoft404 } from "../src/analysis/soft-404.js";
import { computeSimHash } from "../src/analysis/simhash.js";
import { analyzeAccessibility } from "../src/analysis/a11y.js";
import { validateSchemaOrg } from "../src/checks/schema-engine.js";
import { auditPageSecurity } from "../src/analysis/security.js";
import { generateCodePatch } from "../src/analysis/code-patcher.js";
import { openStore, closeStore } from "../src/store/db.js";
import * as repo from "../src/store/repository.js";
import { createServer } from "../src/api/server.js";

describe("analysis accuracy", () => {
  it("a bot with its own robots group ignores the * group (RFC 9309)", () => {
    const r = auditAiBotPosture("User-agent: *\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /admin\n");
    expect(r.blockedSearchBots).not.toContain("PerplexityBot");
  });

  it("only whole-segment error canonicals and short titles signal soft 404", () => {
    const base = { url: "https://s.test/a", status: 200, wordCount: 150, bodyText: "x" };
    expect(checkSoft404({ ...base, canonical: "https://s.test/error-codes-guide" }).isSoft404).toBe(false);
    expect(checkSoft404({ ...base, title: "Google says page not found errors are mostly harmless for rankings" }).isSoft404).toBe(false);
    expect(checkSoft404({ ...base, title: "Page not found | Brand" }).isSoft404).toBe(true);
  });

  it("simhash distinguishes non-Latin pages", () => {
    const a = computeSimHash("مرحبا بكم في موقعنا الرسمي لبيع العقارات الفاخرة في دبي");
    const b = computeSimHash("这是一个关于烹饪和美食的完全不同的页面 内容 完全 不同");
    expect(a).not.toBe(0n);
    expect(a).not.toBe(b);
  });

  it('accepts alt="" for decorative images and es-419 / zh-Hant-TW language tags', () => {
    const ids = (html: string) => analyzeAccessibility(html).map((f) => f.id);
    expect(ids('<html lang="es-419"><img src="a.png" alt=""></html>')).not.toContain("a11y_image_alt");
    expect(ids('<html lang="zh-Hant-TW"></html>')).not.toContain("a11y_html_lang_invalid");
    expect(ids('<html lang="en"><img src="a.png"></html>')).toContain("a11y_image_alt");
  });

  it("a JSON-LD null block is reported, not thrown", () => {
    expect(() => validateSchemaOrg('<script type="application/ld+json">null</script>')).not.toThrow();
  });

  it("canonical/alternate http links are not active mixed content", () => {
    const ids = (html: string) => auditPageSecurity({ url: "https://s.test/", html, status: 200, headers: {} }).map((f) => f.id);
    expect(ids('<link rel="alternate" hreflang="en" href="http://s.test/en">')).not.toContain("mixed_content_active");
    expect(ids('<link rel="stylesheet" href="http://cdn.test/a.css">')).toContain("mixed_content_active");
  });

  it("code patches insert user text literally ($& is not expanded)", () => {
    const res = generateCodePatch({
      framework: "html",
      sourceCode: "<html><head><title>Old</title></head></html>",
      issueId: "title_missing",
      fixData: { title: "Save $& now" },
    });
    expect(res.patchedCode ?? (res as any).code).toContain("<title>Save $& now</title>");
  });
});

describe("store queries", () => {
  let dir = "";
  afterAll(async () => {
    closeStore();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  const crawl = (id: string, startedAt: string): any => ({
    id, targetUrl: "https://s.test/", strategy: "discover", status: "completed", startedAt, finishedAt: startedAt,
    options: {}, robotsAccessible: true, sitemapAccessible: true, sitemapUrlCount: 0, pages: [], links: [],
    sitemapEntries: [], issuesSummary: [], totalErrors: 0, totalWarnings: 0, totalNotices: 0, totalIssues: 0,
    averageAeoScore: 50, totalUrlsCrawled: 0, maxDepthReached: 0, passed: true,
    recommendations: ["Low", "Critical", "Medium", "High"].map((priority, i) => ({
      issueId: `r${i}`, name: `R${i}`, severity: "Error", priority, category: "Links", affectedPages: 1, change: 0, effort: "S", recommendation: "", markdown: "",
    })),
  });

  it("trend returns the newest crawls oldest-first; priorities sort by rank; NaN paging is safe", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "seoforge-"));
    const db = openStore(path.join(dir, "t.db"));
    for (let i = 1; i <= 4; i++) repo.saveCrawl(db, crawl(`c${i}`, `2026-01-0${i}T00:00:00Z`));
    expect(repo.getTrend(db, "https://s.test/", 2).map((t) => t.crawlId)).toEqual(["c3", "c4"]);
    expect(repo.getRecommendations(db, "c4").map((r) => r.priority)).toEqual(["Critical", "High", "Medium", "Low"]);
    expect(() => repo.getLinks(db, "c4", { page: NaN, pageSize: NaN })).not.toThrow();
  });
});

describe("API cross-site guard", () => {
  it("rejects non-JSON write requests and allows JSON ones through", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seoforge-api-"));
    const app = createServer({ baseDir: dir });
    const plain = await app.request("/api/crawl", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
    expect(plain.status).toBe(415);
    const json = await app.request("/api/crawl", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(json.status).not.toBe(415);
    closeStore();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
