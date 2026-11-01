import { describe, it, expect } from "vitest";
import { checkSoft404, auditSoft404Issue } from "../src/analysis/soft-404.js";

describe("Soft 404 Detection Engine", () => {
  it("detects soft 404 when title and H1 contain 'Page Not Found'", () => {
    const page = {
      url: "https://example.com/products/old-item",
      status: 200,
      title: "404 - Page Not Found | Store",
      h1Text: "Oops! We couldn't find what you're looking for",
      bodyText: "Sorry, this page does not exist or has been removed.",
      wordCount: 15,
    };

    const res = checkSoft404(page);
    expect(res.isSoft404).toBe(true);
    expect(res.confidence).toBeGreaterThanOrEqual(80);
    expect(res.signals.length).toBeGreaterThanOrEqual(2);

    const issue = auditSoft404Issue(page);
    expect(issue).not.toBeNull();
    expect(issue?.id).toBe("soft_404");
    expect(issue?.severity).toBe("Error");
  });

  it("does not flag legitimate 200 content pages as soft 404", () => {
    const page = {
      url: "https://example.com/blog/seo-guide",
      status: 200,
      title: "The Ultimate Guide to Technical SEO in 2026",
      h1Text: "Technical SEO Masterclass",
      bodyText: "Learn how to optimize your website for modern AI search engines and Core Web Vitals.",
      wordCount: 1500,
    };

    const res = checkSoft404(page);
    expect(res.isSoft404).toBe(false);
    expect(res.confidence).toBe(0);

    const issue = auditSoft404Issue(page);
    expect(issue).toBeNull();
  });

  it("ignores non-200 status codes", () => {
    const page = {
      url: "https://example.com/real-404",
      status: 404,
      title: "404 Not Found",
    };

    const res = checkSoft404(page);
    expect(res.isSoft404).toBe(false);
  });
});
