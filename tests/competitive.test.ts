import { describe, it, expect } from "vitest";
import { runPageChecks, PageCheckContext } from "../src/checks/registry.js";
import { extractLinks, extractImages } from "../src/crawl/link-extractor.js";
import { detectDuplicates } from "../src/analysis/duplicates.js";
import { analyzeUrlHygiene } from "../src/analysis/url-hygiene.js";
import { analyzeAccessibility } from "../src/analysis/a11y.js";
import { auditAiBotPosture } from "../src/analysis/ai-crawlers.js";
import { validateLlmsTxt } from "../src/analysis/llms-txt.js";
import { auditHreflangSitewide } from "../src/analysis/i18n.js";
import { analyzeLogs, classifyBot, parseLogLine } from "../src/analysis/log-parser.js";
import { auditPageSecurity } from "../src/analysis/security.js";
import { titlePixelWidth } from "../src/analysis/serp.js";

function ctxFor(html: string, pageUrl = "https://example.com/page"): Omit<PageCheckContext, "meta"> {
  return {
    pageUrl, finalUrl: pageUrl, html, status: 200, responseTimeMs: 120, ttfbMs: 60,
    depth: 1, rendered: false, headers: { "content-type": "text/html" },
    links: extractLinks(html, pageUrl), images: extractImages(html, pageUrl),
    robots: null, options: {}, thresholds: undefined, expectedEntities: [],
    canonicalPolicy: "strict", sitemapUrls: new Set(),
    isRedirect: false, redirectChain: [pageUrl], isHttpToHttpsRedirect: false,
  };
}

describe("Screaming Frog parity: meta thresholds", () => {
  it("flags title below 30 chars (was 15)", () => {
    const html = `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Short title here okay</title><meta name="description" content="A perfectly fine meta description of adequate length for testing."></head><body><h1>Short title here okay</h1><p>${"word ".repeat(300)}</p></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    expect(page.auditIssues.some((i) => i.id === "title_too_short")).toBe(true);
  });
  it("flags description over 155 chars (was 160)", () => {
    const long = "x".repeat(156);
    const html = `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>A perfectly reasonable page title here</title><meta name="description" content="${long}"></head><body><h1>Head</h1><p>${"word ".repeat(300)}</p></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    expect(page.auditIssues.some((i) => i.id === "meta_desc_too_long")).toBe(true);
  });
  it("flags multiple titles + outside-head + pixel width + same-as-h1", () => {
    const html = `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>First title here is fine and long enough</title><title>Second title also present here yes</title></head><body><h1>Other heading text here</h1><p>${"word ".repeat(300)}</p></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    expect(page.auditIssues.some((i) => i.id === "title_multiple")).toBe(true);
    expect(titlePixelWidth("A".repeat(60))).toBeGreaterThan(200);
  });
  it("flags H1 over 70 characters", () => {
    const html = `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>A perfectly reasonable page title here</title><meta name="description" content="A perfectly fine meta description of adequate length for testing here."></head><body><h1>${"H".repeat(71)}</h1><p>${"word ".repeat(300)}</p></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    expect(page.auditIssues.some((i) => i.id === "h1_too_long_chars")).toBe(true);
  });
});

describe("redirect classification + canonical", () => {
  it("classifies 302 as temporary warning", () => {
    const html = `<html><head><title>A perfectly reasonable page title here</title></head><body><h1>H</h1></body></html>`;
    const ctx = ctxFor(html);
    ctx.isRedirect = true; ctx.redirectChain = [ctx.pageUrl, "https://example.com/dest"]; (ctx as any).redirectStatusCode = 302; ctx.finalUrl = "https://example.com/dest";
    const { page } = runPageChecks(ctx);
    expect(page.auditIssues.some((i) => i.id === "redirect_302_temporary")).toBe(true);
  });
  it("flags cross-domain canonical", () => {
    const html = `<html><head><title>A perfectly reasonable page title here</title><link rel="canonical" href="https://other.com/page"></head><body><h1>H</h1></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    expect(page.auditIssues.some((i) => i.id === "canonical_cross_domain")).toBe(true);
  });
});

describe("duplicate detection", () => {
  const words = Array.from({ length: 120 }, (_, i) => `wordtoken${i}`);
  const body = words.join(" ");
  it("groups exact duplicates", () => {
    const r = detectDuplicates([
      { url: "https://x/a", bodyText: body },
      { url: "https://x/b", bodyText: body },
      { url: "https://x/c", bodyText: "completely different content about quantum physics and stuff here today" },
    ]);
    expect(r.exactGroups).toHaveLength(1);
    expect(r.exactGroups[0]).toHaveLength(2);
  });
  it("detects near duplicates above 0.85 jaccard", () => {
    const variantWords = words.map((w, i) => (i === 60 ? "alttag60" : w));
    const variant = variantWords.join(" ");
    const r = detectDuplicates([
      { url: "https://x/a", bodyText: body },
      { url: "https://x/b", bodyText: variant },
    ]);
    expect(r.exactGroups).toHaveLength(0);
    expect(r.nearDuplicates.length).toBeGreaterThan(0);
  });
});

describe("url hygiene", () => {
  it("flags long/param/session/underscore/uppercase urls", () => {
    const r = analyzeUrlHygiene({ url: "https://example.com/Blog_Posts/My_Article_Name_That_Goes_On_And_On_And_On_And_On_And_On_And_On?utm_source=x&sid=abc123" });
    expect(r.overLength).toBe(true);
    expect(r.hasUnderscore).toBe(true);
    expect(r.hasUppercase).toBe(true);
    expect(r.hasParameters).toBe(true);
    expect(r.hasSessionId).toBe(true);
  });
});

describe("accessibility", () => {
  it("flags missing lang, viewport, alt, link names", () => {
    const html = `<html><head><title>T</title></head><body><img src="/a.png"><a href="/x"></a><input type="text" name="q"></body></html>`;
    const f = analyzeAccessibility(html);
    const ids = f.map((x) => x.id);
    expect(ids).toContain("a11y_html_lang_missing");
    expect(ids).toContain("mobile_viewport_missing");
    expect(ids).toContain("a11y_image_alt");
    expect(ids).toContain("a11y_link_name");
    expect(ids).toContain("a11y_input_label");
  });
  it("flags zoom-disabled viewport", () => {
    const html = `<html lang="en"><head><meta name="viewport" content="width=device-width, maximum-scale=1.0"></head><body></body></html>`;
    expect(analyzeAccessibility(html).some((x) => x.id === "a11y_viewport_zoom")).toBe(true);
  });
});

describe("ai crawler posture", () => {
  it("detects blocked AI search bots", () => {
    const robots = "User-agent: *\nDisallow: /\n";
    const r = auditAiBotPosture(robots);
    expect(r.blockedSearchBots).toContain("OAI-SearchBot");
    expect(r.blockedSearchBots).toContain("PerplexityBot");
    expect(r.recommendations.length).toBeGreaterThan(0);
  });
  it("allows explicit per-bot allow", () => {
    const robots = "User-agent: *\nDisallow: /private\n\nUser-agent: OAI-SearchBot\nAllow: /\n";
    const r = auditAiBotPosture(robots);
    expect(r.blockedSearchBots).not.toContain("OAI-SearchBot");
  });
});

describe("llms.txt validation", () => {
  it("flags missing file", () => {
    const r = validateLlmsTxt({ url: "https://x/llms.txt", status: 404, body: "" });
    expect(r.present).toBe(false);
    expect(r.findings.some((f) => f.id === "llms_txt_missing")).toBe(true);
  });
  it("validates a compliant file", () => {
    const body = "# Acme\n\n> Acme makes widgets.\n\n## Docs\n\n- [Guide](https://x/guide)\n";
    const r = validateLlmsTxt({ url: "https://x/llms.txt", status: 200, contentType: "text/markdown; charset=utf-8", body });
    expect(r.valid).toBe(true);
    expect(r.stats.linkCount).toBe(1);
  });
});

describe("hreflang reciprocity", () => {
  it("flags missing return links", () => {
    const pages = new Map([
      ["https://x/en", [{ lang: "en", href: "https://x/en" }, { lang: "hi", href: "https://x/hi" }, { lang: "x-default", href: "https://x/en" }]],
      ["https://x/hi", [{ lang: "hi", href: "https://x/hi" }]],
    ]);
    const pageInfo = new Map([
      ["https://x/en", { status: 200, isIndexable: true }],
      ["https://x/hi", { status: 200, isIndexable: true }],
    ]);
    const issues = auditHreflangSitewide({ pages, pageInfo });
    expect(issues.some((i) => i.id === "hreflang_missing_return")).toBe(true);
  });
});

describe("log parser", () => {
  it("parses CLF lines and classifies bots", () => {
    const line = '127.0.0.1 - - [10/Oct/2026:13:00:00 +0000] "GET /page HTTP/1.1" 200 1234 "-" "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot"';
    const e = parseLogLine(line);
    expect(e).not.toBeNull();
    expect(e!.status).toBe(200);
    expect(classifyBot(e!.userAgent)).toBe("OAI-SearchBot");
  });
  it("reports waste + never-crawled", () => {
    const log = [
      '1.1.1.1 - - [10/Oct/2026:13:00:00 +0000] "GET /ok HTTP/1.1" 200 100 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"',
      '1.1.1.1 - - [10/Oct/2026:13:01:00 +0000] "GET /dead HTTP/1.1" 404 100 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"',
    ].join("\n");
    const r = analyzeLogs(log, { knownPages: [{ url: "https://x/ok", status: 200, isIndexable: true }, { url: "https://x/hidden", status: 200, isIndexable: true }] });
    expect(r.botHits.some((b) => b.bot === "Googlebot")).toBe(true);
    expect(r.waste.length).toBeGreaterThan(0);
    expect(r.neverCrawledIndexable).toContain("https://x/hidden");
  });
});

describe("security + document + url checks via pipeline", () => {
  it("flags active mixed content + missing favicon/lang/viewport/url params", () => {
    const html = `<html><head><title>A perfectly reasonable page title here</title><meta name="description" content="A perfectly fine meta description of adequate length for testing here."></head><body><h1>Head</h1><script src="http://cdn.example/lib.js"></script><p>${"word ".repeat(300)}</p></body></html>`;
    const { page } = runPageChecks(ctxFor(html, "https://example.com/Bad_URL_With_Caps?utm_x=1"));
    const ids = page.auditIssues.map((i) => i.id);
    expect(ids).toContain("mixed_content_active");
    expect(ids).toContain("favicon_missing");
    expect(ids).toContain("mobile_viewport_missing");
    expect(ids).toContain("url_uppercase");
    expect(ids).toContain("url_has_parameters");
  });
  it("flags cache validator + gzip-vs-brotli + large payload notices", () => {
    const html = `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>A perfectly reasonable page title here</title><meta name="description" content="A perfectly fine meta description of adequate length for testing here."><link rel="icon" href="/f.ico"></head><body><h1>Head</h1><p>${"word ".repeat(300)}</p></body></html>`;
    const ctx = ctxFor(html);
    ctx.headers = { "content-type": "text/html", "content-encoding": "gzip" };
    const { page } = runPageChecks(ctx);
    const ids = page.auditIssues.map((i) => i.id);
    expect(ids).toContain("no_cache_validators");
    expect(ids).toContain("no_cache_max_age");
  });
  it("audits cookie flags + hsts + server disclosure", () => {
    const f = auditPageSecurity({ url: "https://x/", html: "<html></html>", status: 200, headers: { "set-cookie": "sid=1; Path=/", server: "nginx/1.24.0" } });
    expect(f.some((x) => x.id === "cookie_flags_missing")).toBe(true);
    expect(f.some((x) => x.id === "server_version_exposed")).toBe(true);
  });
});
