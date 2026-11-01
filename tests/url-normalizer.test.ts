import { describe, it, expect } from "vitest";
import { cleanAndNormalizeUrl, isCrawlTrapLoop } from "../src/analysis/url-normalizer.js";

describe("URL Normalizer & Crawl Trap Shield", () => {
  it("strips tracking parameters while preserving functional parameters in sorted order", () => {
    const raw = "https://MySite.com:443/Products/?utm_source=twitter&page=3&fbclid=123&category=shoes#pricing";
    const cleaned = cleanAndNormalizeUrl(raw);

    expect(cleaned).toBe("https://mysite.com/products?category=shoes&page=3");
  });

  it("removes duplicate slashes and default ports", () => {
    const raw = "http://example.com:80//blog//seo-guide/";
    const cleaned = cleanAndNormalizeUrl(raw);

    expect(cleaned).toBe("http://example.com/blog/seo-guide");
  });

  it("detects repeating segment crawl traps", () => {
    const normalUrl = "https://example.com/shop/apparel/shoes";
    expect(isCrawlTrapLoop(normalUrl)).toBe(false);

    const repeatingTrap = "https://example.com/shop/shoes/shop/shoes/shop/shoes";
    expect(isCrawlTrapLoop(repeatingTrap)).toBe(true);

    const deepTrap = "https://example.com/a/b/c/a/b/c";
    expect(isCrawlTrapLoop(deepTrap)).toBe(true);
  });
});
