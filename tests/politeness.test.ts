import { describe, it, expect } from "vitest";
import http from "node:http";
import { crawlSite, externalLanes } from "../src/crawl/crawler.js";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function serve(handler: Handler) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  return { url, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const html = (body: string) => `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`;
const base = { respectRobots: false, followSitemap: false, checkExternalLinks: false, timeoutMs: 4000 } as const;

describe("crawl politeness", () => {
  it("enforces maxRequestsPerSecond across concurrent workers", async () => {
    const perSecond = new Map<number, number>();
    const site = await serve((req, res) => {
      const s = Math.floor(Date.now() / 1000);
      // count crawl fetches only; robots/llms.txt startup probes are not paced
      if (req.url?.startsWith("/p/")) perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
      const n = Number(/\/p\/(\d+)/.exec(req.url ?? "")?.[1] ?? 0);
      res.writeHead(200, { "content-type": "text/html" }).end(html(`<a href="/p/${n + 1}">a</a><a href="/p/${n + 2}">b</a>`));
    });
    await crawlSite(`${site.url}/p/0`, { ...base, limit: 25, maxDepth: 50, concurrency: 8, maxRequestsPerSecond: 10 });
    await site.close();
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(11);
  }, 15000);

  it("backs off on 429 + Retry-After and still crawls every page", async () => {
    let first = true;
    const site = await serve((req, res) => {
      if (req.url === "/p/1" && first) {
        first = false;
        return void res.writeHead(429, { "retry-after": "1" }).end();
      }
      const n = Number(/\/p\/(\d+)/.exec(req.url ?? "")?.[1] ?? 0);
      res.writeHead(200, { "content-type": "text/html" }).end(html(n < 5 ? `<a href="/p/${n + 1}">next</a>` : ""));
    });
    const result = await crawlSite(`${site.url}/p/0`, { ...base, limit: 10, maxDepth: 10, maxRequestsPerSecond: 0 });
    await site.close();
    expect(result.pages.filter((p) => p.status === 200)).toHaveLength(6);
  }, 15000);
});

describe("link verification", () => {
  it("re-checks HEAD failures with GET before marking a link broken", async () => {
    const site = await serve((req, res) => {
      if (req.url === "/no-head") return void res.writeHead(req.method === "HEAD" ? 405 : 200).end("ok");
      if (req.url === "/gone") return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "text/html" }).end(html(`<a href="/no-head">x</a><a href="/gone">y</a>`));
    });
    const result = await crawlSite(`${site.url}/`, { ...base, limit: 5, maxDepth: 0 });
    await site.close();
    const byTarget = new Map(result.links.map((l) => [l.target.replace(site.url, ""), l]));
    expect(byTarget.get("/no-head")?.isBroken).toBe(false);
    expect(byTarget.get("/no-head")?.targetStatus).toBe(200);
    expect(byTarget.get("/gone")?.isBroken).toBe(true);
  }, 15000);

  it("paces internal link checks with maxRequestsPerSecond", async () => {
    const perSecond = new Map<number, number>();
    const site = await serve((req, res) => {
      const s = Math.floor(Date.now() / 1000);
      if (req.url?.startsWith("/t/")) perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
      const links = Array.from({ length: 20 }, (_, i) => `<a href="/t/${i}">t</a>`).join("");
      res.writeHead(200, { "content-type": "text/html" }).end(html(links));
    });
    // depth 0: the 20 /t/ targets are never crawled, only HEAD-verified
    await crawlSite(`${site.url}/`, { ...base, limit: 5, maxDepth: 0, concurrency: 8, maxRequestsPerSecond: 8 });
    await site.close();
    expect([...perSecond.values()].reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(9);
  }, 15000);

  it("does not report a 429 link target as broken", async () => {
    const site = await serve((req, res) => {
      if (req.url === "/busy") return void res.writeHead(429).end();
      res.writeHead(200, { "content-type": "text/html" }).end(html(`<a href="/busy">x</a>`));
    });
    const result = await crawlSite(`${site.url}/`, { ...base, limit: 5, maxDepth: 0 });
    await site.close();
    const busy = result.links.find((l) => l.target.endsWith("/busy"));
    expect(busy?.targetStatus).toBe(429);
    expect(busy?.isBroken).toBe(false);
  }, 15000);
});

describe("externalLanes", () => {
  it("caps lanes per host and spreads URLs evenly", () => {
    const urls = [
      ...Array.from({ length: 5 }, (_, i) => `https://big.example/${i}`),
      "https://small.example/a",
    ];
    const lanes = externalLanes(urls, 2);
    const big = lanes.filter((l) => l[0].includes("big."));
    expect(big).toHaveLength(2);
    expect(big.map((l) => l.length).sort()).toEqual([2, 3]);
    expect(lanes.flat().sort()).toEqual([...urls].sort());
    expect(lanes[lanes.length - 1]).toEqual(["https://small.example/a"]);
  });
});

describe("sitewide duplicate detection", () => {
  it("reports exact and near duplicates without retaining body text", async () => {
    const words = (seed: number, n: number) => Array.from({ length: n }, (_, i) => `w${(i * 7 + seed) % 997}x${i}`).join(" ");
    const shared = words(1, 300);
    const site = await serve((req, res) => {
      const body: Record<string, string> = {
        "/": `<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><a href="/d">d</a>`,
        "/a": `<p>${shared}</p>`,
        "/b": `<p>${shared}</p>`, // exact copy of /a
        "/c": `<p>${shared} extra tail words here</p>`, // near copy
        "/d": `<p>${words(500, 300)}</p>`, // unrelated
      };
      res.writeHead(200, { "content-type": "text/html" }).end(html(body[req.url ?? ""] ?? ""));
    });
    const result = await crawlSite(`${site.url}/`, { ...base, limit: 10, maxDepth: 2 });
    await site.close();
    const ids = (path: string) => result.pages.find((p) => p.url.endsWith(path))!.auditIssues.map((i) => i.id);
    expect(ids("/b").concat(ids("/a"))).toContain("duplicate_content_exact");
    expect(ids("/c").some((id) => id.startsWith("duplicate_content_near") || id === "near_duplicate_content")).toBe(true);
    expect(ids("/d").some((id) => id.startsWith("duplicate_content") || id === "near_duplicate_content")).toBe(false);
    expect(result.pages.every((p) => p.bodyText === undefined)).toBe(true);
  }, 15000);
});
