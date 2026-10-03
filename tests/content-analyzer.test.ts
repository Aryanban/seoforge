import { describe, it, expect } from "vitest";
import {
  countSyllables,
  calculateReadability,
  extractNgrams,
  auditTargetKeyword,
  analyzeContent,
} from "../src/content-analyzer.js";

describe("Content & Keyword Analyzer", () => {
  it("counts syllables accurately for English words", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("hello")).toBe(2);
    expect(countSyllables("beautiful")).toBe(3);
    expect(countSyllables("optimization")).toBeGreaterThanOrEqual(4);
  });

  it("calculates Flesch Reading Ease and Grade Level", () => {
    const simpleText = "The cat sat on the mat. The dog ran in the sun. It was a good day.";
    const metrics = calculateReadability(simpleText);
    expect(metrics.wordCount).toBeGreaterThan(10);
    expect(metrics.fleschReadingEase).toBeGreaterThan(80);
    expect(metrics.fleschKincaidGrade).toBeLessThan(6);
    expect(metrics.readingLevel).toContain("Easy");
  });

  it("extracts 1-gram, 2-gram, and 3-gram keywords with stop words filtered", () => {
    const text = `
      Local SEO services help small businesses rank higher on Google Maps.
      Local SEO services increase inbound calls and lead conversion.
      Our local SEO services deliver measurable rankings and genuine ROI.
    `;
    const bigrams = extractNgrams(text, 2, 2);
    expect(bigrams.length).toBeGreaterThan(0);
    expect(bigrams[0].phrase).toBe("local seo");
    expect(bigrams[0].count).toBe(3);
    expect(bigrams[0].density).toBeGreaterThan(0);

    const trigrams = extractNgrams(text, 3, 2);
    expect(trigrams.some((t) => t.phrase.includes("local seo services"))).toBe(true);
  });

  it("flags keyword stuffing when density exceeds 3.5%", () => {
    // 5 occurrences in a 30-word text = ~16% density
    const text = "Dentist in Delhi provides dental implants. Visit our dentist in Delhi clinic. Best dentist in Delhi now. Our dentist in Delhi helps. Call dentist in Delhi.";
    const bigrams = extractNgrams(text, 3, 3);
    const stuffing = bigrams.find((b) => b.phrase === "dentist in delhi");
    expect(stuffing).toBeDefined();
    expect(stuffing?.isStuffing).toBe(true);
  });

  it("audits target keyword placement across all signals", () => {
    const audit = auditTargetKeyword("plumbing repair", {
      bodyText: "Plumbing repair services for homeowners. We do fast plumbing repair in Austin with certified plumbers.",
      title: "Best Plumbing Repair in Austin | 24/7 Experts",
      h1: "Austin Plumbing Repair",
      description: "Affordable emergency plumbing repair services across Austin, TX.",
      url: "https://example.com/services/plumbing-repair",
      imgAlts: ["plumbing repair technician van"],
    });

    expect(audit.inUrl).toBe(true);
    expect(audit.inTitle).toBe(true);
    expect(audit.inH1).toBe(true);
    expect(audit.inDescription).toBe(true);
    expect(audit.inFirst100Words).toBe(true);
    expect(audit.inImageAlts).toBe(true);
    expect(audit.count).toBe(2);
    expect(audit.status).toBe("optimal");
    expect(audit.recommendations.length).toBe(0);
  });

  it("analyzes full HTML document into complete content report", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Top SEO Agency | Enterprise Organic Growth</title>
          <meta name="description" content="Discover how our top SEO agency helps enterprise brands dominate search engines with Answer Engine Optimization." />
        </head>
        <body>
          <nav><a href="/">Home</a><a href="/about">About</a></nav>
          <h1>Top SEO Agency for Modern Brands</h1>
          <h2>Organic Search Strategy</h2>
          <p>Our top SEO agency specializes in organic traffic growth, technical site audits, and AEO snippets.</p>
          <h2>Technical Architecture</h2>
          <p>We fix crawl errors, optimize Core Web Vitals, and deploy valid Schema.org JSON-LD to dominate AI search.</p>
          <img src="/logo.png" alt="Top SEO agency logo" />
          <footer>Copyright 2026</footer>
        </body>
      </html>
    `;

    const result = analyzeContent(html, { url: "https://example.com/seo-agency" });
    expect(result.readability.wordCount).toBeGreaterThan(20);
    expect(result.headings.h1Count).toBe(1);
    expect(result.headings.h2Count).toBe(2);
    expect(result.headings.hasSkippedLevels).toBe(false);
    expect(result.keywords.bigrams.length).toBeGreaterThan(0);
    expect(result.targetKeywordAudit).toBeDefined();
    expect(result.targetKeywordAudit?.inTitle).toBe(true);
  });
});
