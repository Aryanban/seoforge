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

  it("does not flag a long real content page whose name contains 404", () => {
    const normalWords = Array(900).fill("survey land record village plot map").join(" ");
    const page = {
      url: "https://dholeramap.com/survey/ambli/404",
      status: 200,
      title: "Survey 404, Ambli: Map & 7/12 Records | DholeraMap",
      h1Text: "Survey No. 404, Ambli",
      bodyText: normalWords,
      wordCount: 900,
    };

    const res = checkSoft404(page);
    expect(res.isSoft404).toBe(false);
    expect(res.confidence).toBeLessThan(45);
  });

  it("flags a short page titled '404 Not Found' with 'Page not found' H1", () => {
    const page = {
      url: "https://example.com/missing",
      status: 200,
      title: "404 Not Found",
      h1Text: "Page not found",
      bodyText: "Sorry the page you asked for is gone. Try the home page or search instead for what you need today.",
      wordCount: 20,
    };

    const res = checkSoft404(page);
    expect(res.isSoft404).toBe(true);
    expect(res.confidence).toBeGreaterThanOrEqual(45);
  });

  it("flags a short 'Error 404' titled page", () => {
    const page = {
      url: "https://example.com/broken",
      status: 200,
      title: "Error 404 | Site",
      h1Text: "Oops",
      bodyText: "Something went wrong here.",
      wordCount: 5,
    };

    const res = checkSoft404(page);
    expect(res.isSoft404).toBe(true);
  });

  it("scores a long 'Page not found' titled page lower than a short one", () => {
    const longPage = {
      url: "https://example.com/long",
      status: 200,
      title: "Page not found",
      bodyText: Array(900).fill("normal article text about land and plots").join(" "),
      wordCount: 900,
    };
    const shortPage = {
      url: "https://example.com/short",
      status: 200,
      title: "404 Not Found",
      h1Text: "Page not found",
      bodyText: "Sorry the page you asked for is gone. Try the home page or search instead for what you need today.",
      wordCount: 20,
    };

    const longRes = checkSoft404(longPage);
    const shortRes = checkSoft404(shortPage);
    expect(longRes.isSoft404).toBe(false);
    expect(longRes.confidence).toBeLessThan(shortRes.confidence);
  });
});
