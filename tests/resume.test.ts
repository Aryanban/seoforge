import { describe, it, expect } from "vitest";
import http from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Crawler } from "../src/crawl/crawler.js";

describe("crawl checkpoint / resume", () => {
  it("resumes a stopped crawl without re-fetching finished pages", async () => {
    const hits = new Map<string, number>();
    const server = http.createServer((req, res) => {
      const url = req.url ?? "";
      // GETs only: the stopped crawl HEAD-checks discovered-but-uncrawled links
      if (url.startsWith("/p/") && req.method === "GET") hits.set(url, (hits.get(url) ?? 0) + 1);
      const n = Number(/\/p\/(\d+)/.exec(url)?.[1] ?? -1);
      const links = n < 0 ? `<a href="/p/0">start</a>` : n < 29 ? `<a href="/p/${n + 1}">next</a>` : "";
      setTimeout(() => res.writeHead(200, { "content-type": "text/html" }).end(`<html lang="en"><head><title>p${n}</title></head><body>${links}</body></html>`), 5);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const checkpointPath = path.join(mkdtempSync(path.join(os.tmpdir(), "seoforge-ckpt-")), "c.ckpt");
    const opts = { checkpointPath, respectRobots: false, followSitemap: false, checkExternalLinks: false, limit: 100, maxDepth: 100, concurrency: 2, maxRequestsPerSecond: 0 };

    const first = new Crawler("crawl_resume_test");
    first.on("page", () => {
      if (hits.size >= 10) first.stop();
    });
    const partial = await first.crawl(`${base}/`, opts);
    expect(partial.status).toBe("stopped");
    expect(existsSync(checkpointPath)).toBe(true);
    const crawledBefore = partial.pages.length;
    expect(crawledBefore).toBeLessThan(31);

    const second = new Crawler(); // id comes from the checkpoint
    const full = await second.crawl(`${base}/`, opts);
    server.close();

    expect(full.status).toBe("completed");
    expect(full.id).toBe("crawl_resume_test");
    expect(full.pages).toHaveLength(31); // "/" + /p/0../p/29
    expect(new Set(full.pages.map((p) => p.normalizedUrl)).size).toBe(31);
    expect([...hits.values()].every((n) => n === 1)).toBe(true);
    expect(existsSync(checkpointPath)).toBe(false);
  }, 20000);

  it("refuses a checkpoint for a different site", async () => {
    const server = http.createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<html><body></body></html>"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const checkpointPath = path.join(mkdtempSync(path.join(os.tmpdir(), "seoforge-ckpt-")), "c.ckpt");
    const opts = { checkpointPath, respectRobots: false, followSitemap: false, checkExternalLinks: false, limit: 5 };
    const c = new Crawler();
    c.on("page", () => c.stop());
    await c.crawl(`${base}/`, opts);
    await expect(new Crawler().crawl(`${base}/other-site`, opts)).rejects.toThrow(/belongs to/);
    server.close();
  }, 20000);
});
