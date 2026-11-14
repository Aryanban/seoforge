import { describe, it, expect } from "vitest";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { parseSitemap, lastmodProblem, SITEMAP_MAX_URLS } from "../src/crawl/sitemap-parser.js";

const urlset = (n: number, lastmod?: string) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from(
    { length: n },
    (_, i) => `<url><loc>http://x.test/${i}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`
  ).join("")}</urlset>`;

async function serve(routes: Record<string, (res: http.ServerResponse) => void>, fn: (base: string) => Promise<void>) {
  const server = http.createServer((req, res) => (routes[req.url ?? ""] ?? ((r) => r.writeHead(404).end()))(res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as any).port}`);
  } finally {
    server.close();
  }
}

describe("parseSitemap", () => {
  it("reads a gzipped sitemap served as application/x-gzip", async () => {
    await serve({ "/s.xml.gz": (r) => r.writeHead(200, { "content-type": "application/x-gzip" }).end(gzipSync(urlset(50))) }, async (base) => {
      const res = await parseSitemap(`${base}/s.xml.gz`);
      expect(res.urlCount).toBe(50);
      expect(res.errors).toEqual([]);
    });
  });

  it("reads gzipped sitemaps inside a sitemap index", async () => {
    await serve(
      {
        "/index.xml": (r) =>
          r
            .writeHead(200, { "content-type": "application/xml" })
            .end(`<sitemapindex><sitemap><loc>BASE/a.xml.gz</loc></sitemap></sitemapindex>`.replace("BASE", `http://127.0.0.1:${(r.socket!.address() as any).port}`)),
        "/a.xml.gz": (r) => r.writeHead(200, { "content-type": "application/gzip" }).end(gzipSync(urlset(3))),
      },
      async (base) => {
        const res = await parseSitemap(`${base}/index.xml`);
        expect(res.hasSitemapIndex).toBe(true);
        expect(res.urlCount).toBe(3);
      }
    );
  });

  it("reports files over the 50,000-URL limit", async () => {
    await serve({ "/big.xml": (r) => r.writeHead(200, { "content-type": "application/xml" }).end(urlset(SITEMAP_MAX_URLS + 1)) }, async (base) => {
      const res = await parseSitemap(`${base}/big.xml`, { limit: 10 });
      expect(res.errors.join()).toMatch(/50000 per file/);
    });
  });

  it("reports invalid and future lastmod values once per file", async () => {
    await serve({ "/s.xml": (r) => r.writeHead(200, { "content-type": "application/xml" }).end(urlset(4, "15/11/2026")) }, async (base) => {
      const res = await parseSitemap(`${base}/s.xml`);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]).toMatch(/4 <lastmod> values that are not W3C Datetime/);
    });
  });
});

describe("lastmodProblem", () => {
  const now = Date.parse("2026-11-15T00:00:00Z");
  it.each(["2026", "2026-11", "2026-11-14", "2026-11-14T10:30Z", "2026-11-14T10:30:05+01:00", "2026-11-14T10:30:05.123-05:00"])("accepts %s", (v) =>
    expect(lastmodProblem(v, now)).toBeNull()
  );
  it.each(["15/11/2026", "2026-13-01", "2026-11-14T10:30", "2026-11-14 10:30:00Z", "yesterday"])("rejects %s", (v) => expect(lastmodProblem(v, now)).toBe("invalid"));
  it("flags dates more than a day ahead", () => expect(lastmodProblem("2027-01-01", now)).toBe("future"));
});
