import { describe, it, expect } from "vitest";
import { runPageChecks, PageCheckContext } from "../src/checks/registry.js";
import { extractLinks, extractImages } from "../src/crawl/link-extractor.js";
import { validateSchemaOrg } from "../src/checks/schema-engine.js";
import { evaluateAeo } from "../src/checks/aeo-engine.js";
import { buildIssueSummary } from "../src/checks/summary.js";
import { generateRecommendations } from "../src/ai/recommendations.js";
import { normalizeUrl } from "../src/crawl/queue.js";

function ctxFor(html: string, pageUrl = "https://example.com/page"): Omit<PageCheckContext, "meta"> {
  return {
    pageUrl,
    finalUrl: pageUrl,
    html,
    status: 200,
    responseTimeMs: 120,
    ttfbMs: 60,
    depth: 1,
    rendered: false,
    headers: { "content-type": "text/html" },
    links: extractLinks(html, pageUrl),
    images: extractImages(html, pageUrl),
    robots: null,
    options: {},
    thresholds: undefined,
    expectedEntities: [],
    canonicalPolicy: "strict",
    sitemapUrls: new Set(),
    isRedirect: false,
    redirectChain: [pageUrl],
    isHttpToHttpsRedirect: false,
  };
}

describe("check engine", () => {
  it("flags a missing title and description", () => {
    const html = `<html><head></head><body><h1>Hi</h1><p>${"word ".repeat(300)}</p></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    const ids = page.auditIssues.map((i) => i.id);
    expect(ids).toContain("title_missing");
    expect(ids).toContain("meta_desc_missing");
  });

  it("flags multiple H1s", () => {
    const html = `<html><head><title>T</title></head><body><h1>One</h1><h1>Two</h1><h3>Skip</h3></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    const ids = page.auditIssues.map((i) => i.id);
    expect(ids).toContain("h1_multiple");
  });

  it("flags a missing H1 and detects noscript-only H1", () => {
    const html = `<html><head><title>T</title></head><body><noscript><h1>Hidden</h1></noscript></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    expect(page.h1Count).toBe(0);
    expect(page.h1InNoscriptOnly).toBe(true);
    expect(page.auditIssues.some((i) => i.id === "h1_missing")).toBe(true);
  });

  it("flags thin content and low AEO", () => {
    const html = `<html><head><title>T</title></head><body><h1>Thin</h1><p>Too short.</p></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    expect(page.auditIssues.some((i) => i.id === "low_word_count")).toBe(true);
    expect(page.auditIssues.some((i) => i.id === "low_aeo_score")).toBe(true);
  });

  it("rewards a well-optimized page with a high AEO score", () => {
    const lead =
      "Example page is an authoritative demonstration property that shows how a well structured document earns a high answer engine optimization score through clear headings, direct answer paragraphs, structured tables, and valid JSON-LD structured data.";
    const html = `<html><head><title>Example page — well optimized</title>
      <meta name="description" content="An optimized example page.">
      <link rel="canonical" href="https://example.com/page">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What is this?","acceptedAnswer":{"@type":"Answer","text":"A well optimized page."}}]}</script>
      </head><body>
      <h1>Example page</h1><p>${lead}</p>
      <h2>Details</h2><table><tr><td>a</td><td>b</td></tr></table>
      </body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    expect(page.aeo.score).toBeGreaterThanOrEqual(90);
    expect(page.auditIssues.filter((i) => i.severity === "Error")).toHaveLength(0);
  });

  it("detects generic anchor text and internal nofollow", () => {
    const html = `<html><head><title>T</title></head><body><h1>Links</h1>
      <a href="/a">Click here</a><a href="/b" rel="nofollow">noollowed internal</a></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    const ids = page.auditIssues.map((i) => i.id);
    expect(ids).toContain("generic_anchor_text");
    expect(ids).toContain("internal_nofollow");
  });

  it("flags images without alt text and without dimensions", () => {
    const html = `<html><head><title>T</title></head><body><h1>Imgs</h1><img src="/a.png"></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    const ids = page.auditIssues.map((i) => i.id);
    expect(ids).toContain("image_missing_alt");
    expect(ids).toContain("image_missing_dimensions");
  });

  it("flags slow responses and missing security headers", () => {
    const html = `<html><head><title>T</title></head><body><h1>Slow</h1></body></html>`;
    const ctx = ctxFor(html, "https://example.com/slow");
    ctx.responseTimeMs = 3500;
    ctx.ttfbMs = 1500;
    ctx.headers = {};
    const { page } = runPageChecks(ctx);
    const ids = page.auditIssues.map((i) => i.id);
    expect(ids).toContain("slow_ttfb");
    expect(ids).toContain("high_latency");
    expect(ids).toContain("missing_security_headers");
  });

  it("detects mixed content on an HTTPS page", () => {
    const html = `<html><head><title>T</title></head><body><h1>Mixed</h1>
      <script src="http://evil.example/lib.js"></script></body></html>`;
    const { page } = runPageChecks(ctxFor(html, "https://example.com/mixed"));
    expect(page.auditIssues.some((i) => i.id === "mixed_content")).toBe(true);
  });

  it("flags noindex directives", () => {
    const html = `<html><head><title>T</title><meta name="robots" content="noindex"></head><body><h1>Noindex</h1></body></html>`;
    const { page } = runPageChecks(ctxFor(html));
    expect(page.isIndexable).toBe(false);
    expect(page.auditIssues.some((i) => i.id === "noindex_meta_tag")).toBe(true);
  });
});

describe("schema engine", () => {
  it("detects missing JSON-LD", () => {
    const r = validateSchemaOrg(`<html><body></body></html>`, ["WebSite"]);
    expect(r.hasJsonLd).toBe(false);
    expect(r.missingExpected).toContain("WebSite");
  });

  it("validates FAQPage and finds expected entities", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Q?","acceptedAnswer":{"@type":"Answer","text":"A"}}]}
      </script></head></html>`;
    const r = validateSchemaOrg(html, ["FAQPage"]);
    expect(r.hasJsonLd).toBe(true);
    expect(r.typesFound).toContain("FAQPage");
    expect(r.missingExpected).toHaveLength(0);
  });

  it("catches malformed JSON-LD", () => {
    const html = `<html><head><script type="application/ld+json">{not json}</script></head></html>`;
    const r = validateSchemaOrg(html);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("flags a SoftwareApplication missing rich-results requirements", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"SoftwareApplication","name":"App"}
      </script></head></html>`;
    const r = validateSchemaOrg(html);
    expect(r.googleRichResultsErrors.length).toBeGreaterThan(0);
  });

  it("reads types from an @graph", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"S","url":"https://example.com"},{"@type":"Person","name":"A"}]}
      </script></head></html>`;
    const r = validateSchemaOrg(html, ["WebSite", "Person"]);
    expect(r.rawGraphCount).toBe(2);
    expect(r.missingExpected).toHaveLength(0);
  });
});

describe("aeo engine", () => {
  it("scores an empty page low", () => {
    const r = evaluateAeo(`<html><body></body></html>`);
    expect(r.score).toBeLessThan(40);
    expect(r.hasInvertedPyramidSnippet).toBe(false);
  });

  it("detects the inverted-pyramid answer paragraph", () => {
    const answer =
      "An optimized page is a document structured so that answer engines can extract a concise direct answer immediately after the primary heading without parsing the entire body of the page.";
    const html = `<html><body><h1>Topic</h1><p>${answer}</p><h2>More</h2><table><tr><td>1</td></tr></table>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script></body></html>`;
    const r = evaluateAeo(html);
    expect(r.hasInvertedPyramidSnippet).toBe(true);
    expect(r.hasFaqSchema).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(90);
  });
});

describe("summary + recommendations", () => {
  it("groups issues by name and counts affected pages", () => {
    const html = `<html><head></head><body><h1>Hi</h1></body></html>`;
    const a = runPageChecks(ctxFor(html, "https://example.com/a"));
    const b = runPageChecks(ctxFor(html, "https://example.com/b"));
    const summary = buildIssueSummary([a.page, b.page]);
    expect(summary.some((s) => s.name === "Title tag missing or empty")).toBe(true);
    const titleIssue = summary.find((s) => s.name === "Title tag missing or empty");
    expect(titleIssue?.affectedPages).toBe(2);
  });

  it("produces prioritized recommendations with fix markdown", () => {
    const html = `<html><head></head><body><h1>Hi</h1></body></html>`;
    const page = runPageChecks(ctxFor(html)).page;
    const summary = buildIssueSummary([page]);
    const recs = generateRecommendations(summary);
    expect(recs.length).toBeGreaterThan(0);
    const titleRec = recs.find((r) => r.issueId === "title_missing");
    expect(titleRec).toBeDefined();
    expect(titleRec?.markdown).toContain("How to fix");
    expect(titleRec?.markdown).toContain("Why it matters");
  });

  it("normalizes URLs consistently for dedup", () => {
    expect(normalizeUrl("https://Example.com/A/")).toBe(normalizeUrl("https://example.com/A"));
    expect(normalizeUrl("https://example.com/a#frag")).toBe(normalizeUrl("https://example.com/a"));
  });
});
