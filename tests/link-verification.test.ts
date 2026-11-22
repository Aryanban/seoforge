import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { crawlSite, isBrokenStatus } from "../src/crawl/crawler.js";

/** Site on one port linking to a case- and query-sensitive "external" host on another. */
describe("link verification", () => {
  let site: http.Server;
  let ext: http.Server;
  let siteUrl = "";
  let extUrl = "";

  beforeAll(async () => {
    ext = http.createServer((req, res) => {
      const ok = req.url === "/AbC" || req.url === "/app?id=7";
      res.writeHead(ok ? 200 : 404).end();
    });
    await new Promise<void>((r) => ext.listen(0, "127.0.0.1", r));
    extUrl = `http://127.0.0.1:${(ext.address() as AddressInfo).port}`;
    site = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<title>Home</title><h1>Home</h1><a href="${extUrl}/AbC">a</a><a href="${extUrl}/app?id=7">b</a><a href="${extUrl}/gone">c</a>`);
    });
    await new Promise<void>((r) => site.listen(0, "localhost", r));
    siteUrl = `http://localhost:${(site.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => site.close(r));
    await new Promise((r) => ext.close(r));
  });

  it("probes the real URL and records each link once", async () => {
    const result = await crawlSite(`${siteUrl}/`, { limit: 1, followSitemap: false, respectRobots: false, timeoutMs: 4000 });
    const ext = result.links.filter((l) => !l.isInternal);
    expect(ext.map((l) => [l.target, l.targetStatus]).sort()).toEqual([
      [`${extUrl}/AbC`, 200],
      [`${extUrl}/app?id=7`, 200],
      [`${extUrl}/gone`, 404],
    ]);
  });

  it("does not treat rate-limit or bot-block codes as broken", () => {
    expect([404, 410, 500].every(isBrokenStatus)).toBe(true);
    expect([200, 301, 429, 999].some(isBrokenStatus)).toBe(false);
  });
});
