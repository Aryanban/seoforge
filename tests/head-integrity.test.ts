import { describe, it, expect } from "vitest";
import { analyzeHeadIntegrity } from "../src/checks/head-integrity.js";

describe("analyzeHeadIntegrity", () => {
  it("reports no breaker for a clean head", () => {
    const html = `<html><head><title>t</title><meta name="robots" content="index"><link rel="canonical" href="/a"></head><body></body></html>`;
    const result = analyzeHeadIntegrity(html);
    expect(result.breaker).toBeUndefined();
    expect(result.hiddenTags).toEqual([]);
  });

  it("flags an img breaker and the SEO tags hidden after it", () => {
    const html = `<html><head><title>t</title><img src=x><link rel="canonical" href="/a"><meta name="robots" content="noindex"></head><body></body></html>`;
    const result = analyzeHeadIntegrity(html);
    expect(result.breaker).toBe("img");
    expect(result.hiddenTags).toContain("link[rel=canonical]");
    expect(result.hiddenTags).toContain("meta[name=robots]");
  });

  it("ignores img inside noscript in head", () => {
    const html = `<html><head><noscript><img src=x></noscript><meta name="description" content="d"></head><body></body></html>`;
    const result = analyzeHeadIntegrity(html);
    expect(result.breaker).toBeUndefined();
    expect(result.hiddenTags).toEqual([]);
  });

  it("reports a div breaker with nothing hidden after it", () => {
    const html = `<html><head><title>t</title><div>x</div></head><body></body></html>`;
    const result = analyzeHeadIntegrity(html);
    expect(result.breaker).toBe("div");
    expect(result.hiddenTags).toEqual([]);
  });

  it("collects hreflang alternates after a breaker", () => {
    const html = `<html><head><h1>x</h1><link rel="alternate" hreflang="de" href="/de"></head><body></body></html>`;
    const result = analyzeHeadIntegrity(html);
    expect(result.breaker).toBe("h1");
    expect(result.hiddenTags).toEqual(["link[rel=alternate][hreflang]"]);
  });

  it("ignores tags after </head> and elements inside body", () => {
    const html = `<html><head><title>t</title></head><body><img src=x><link rel="canonical" href="/a"></body></html>`;
    const result = analyzeHeadIntegrity(html);
    expect(result.breaker).toBeUndefined();
    expect(result.hiddenTags).toEqual([]);
  });
});
