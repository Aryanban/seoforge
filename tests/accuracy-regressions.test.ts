import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import * as cheerio from "cheerio";
import { Crawler } from "../src/crawl/crawler.js";
import { languageChecks } from "../src/checks/language.js";
import type { CrawlResult } from "../src/types.js";

const FR =
  "Le développement durable est un mode de développement qui répond aux besoins du présent sans compromettre la capacité des générations futures à répondre aux leurs. Il repose sur trois piliers: économique, social et environnemental. Les entreprises adoptent aujourd'hui des stratégies pour réduire leur empreinte carbone et améliorer les conditions de travail.";

const page = (body: string) =>
  `<!doctype html><html lang="en"><head><title>A reasonably long page title here</title><meta name="description" content="d"></head><body><main><h1>H</h1>${body}</main></body></html>`;

let server: http.Server;
let base = "";
let crawl: CrawlResult;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const html = (b: string, status = 200) => res.writeHead(status, { "content-type": "text/html" }).end(b);
    switch (req.url) {
      case "/":
        return html(page(`<a href="/a">a</a><a href="/old">old</a><a href="/gone">gone</a>`));
      case "/a":
        return html(page(`<p>${"content words ".repeat(80)}</p>`));
      case "/old":
        return res.writeHead(301, { location: "/moved" }).end();
      case "/moved":
        return html(page(`<p>destination</p>`));
      case "/gone":
        return html(`<html><head><title>Not found</title></head><body>404</body></html>`, 404);
      case "/only-in-sitemap":
        return html(page(`<p>orphan</p>`));
      case "/sitemap.xml":
        return res
          .writeHead(200, { "content-type": "application/xml" })
          .end(`<urlset><url><loc>${base}/a</loc></url><url><loc>${base}/only-in-sitemap</loc></url></urlset>`);
      default:
        return html("nf", 404);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  crawl = await new Crawler().crawl(`${base}/`, { respectRobots: false, checkExternalLinks: false, limit: 50, concurrency: 2, maxRequestsPerSecond: 0 });
}, 30000);
afterAll(() => server.close());

const byPath = (p: string) => crawl.pages.find((pg) => new URL(pg.url).pathname === p)!;
const ids = (p: string) => byPath(p).auditIssues.map((i) => i.id);

describe("crawl accuracy regressions", () => {
  it("audits a 404 for its status only and marks it non-indexable", () => {
    expect(byPath("/gone").isIndexable).toBe(false);
    expect(ids("/gone")).toContain("broken_link_404");
    expect(ids("/gone")).not.toEqual(expect.arrayContaining(["title_too_short"]));
    expect(ids("/gone").every((id) => !/^(canonical|meta_desc|og_|schema|mobile|a11y)/.test(id))).toBe(true);
  });

  it("records a 301 with its own code and crawls the destination separately", () => {
    const old = byPath("/old");
    expect(old.status).toBe(301);
    expect(ids("/old")).toContain("redirect_301_permanent");
    expect(ids("/old")).not.toContain("redirect_302_temporary");
    expect(ids("/old").every((id) => !/^(meta_desc|low_word|schema|og_)/.test(id))).toBe(true);
    expect(byPath("/moved").status).toBe(200);
  });

  it("crawls sitemap URLs that links never reach and flags them as sitemap orphans", () => {
    expect(ids("/only-in-sitemap")).toContain("orphan_in_sitemap");
    expect(ids("/only-in-sitemap")).not.toContain("orphan_page");
  });

  it("reports a page without JSON-LD once, not also as a validation error", () => {
    expect(ids("/a")).toContain("schema_missing");
    expect(ids("/a")).not.toContain("schema_org_validation_error");
  });

  it("does not flag repetitive English as another language", () => {
    expect(ids("/a")).not.toContain("lang_content_mismatch");
  });
});

describe("language mismatch", () => {
  const check = (lang: string, text: string) => {
    const html = `<html lang="${lang}"><body><p>${text}</p></body></html>`;
    return languageChecks({ html, $: cheerio.load(html), status: 200, pageUrl: "u" } as any).issues.map((i) => i.id);
  };
  it("still flags French text declared as English", () => expect(check("en", FR)).toEqual(["lang_content_mismatch"]));
  it("accepts French text declared as French", () => expect(check("fr", FR)).toEqual([]));
  it("ignores navigation-only word lists", () => expect(check("en", "Home About Pricing Blog Contact Login ".repeat(20))).toEqual([]));
});
