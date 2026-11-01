import { describe, it, expect } from "vitest";
import { scoreContent } from "../src/analysis/live-content-scorer.js";

describe("Live Content Scorer (SurferSEO & Semrush Writing Assistant parity)", () => {
  it("scores high-quality optimized article well", () => {
    const article = `
# Complete Guide to NextJS SEO

NextJS SEO is essential for modern web applications looking to rank on search engines. In this complete guide, we cover metadata, OpenGraph tags, sitemaps, and server-side rendering for optimal indexability.

## What is NextJS SEO?
NextJS SEO refers to the technical and on-page optimization techniques used to maximize search engine visibility for applications built with the Next.js framework. It combines server-side rendering, metadata APIs, and Core Web Vitals performance tuning.

## Core Pillars of NextJS SEO
- Static Site Generation (SSG) for ultra-fast TTFB
- Incremental Static Regeneration (ISR)
- Built-in next/image component for automated WebP conversion
- Dynamic robots.txt and sitemap.xml generation

## Comparison Table
| Feature | Client-Side SPA | Next.js Server Components |
| :--- | :--- | :--- |
| Initial HTML | Blank | Fully pre-rendered |
| Bot Crawlability | Slow / risky | Instant |
    `.trim();

    const report = scoreContent({
      title: "Complete Guide to NextJS SEO",
      body: article,
      primaryKeyword: "NextJS SEO",
      secondaryKeywords: ["metadata", "sitemaps", "Core Web Vitals"],
      targetWordCount: 150,
    });

    expect(report.overallScore).toBeGreaterThanOrEqual(80);
    expect(report.primaryKeywordMetric.foundInTitle).toBe(true);
    expect(report.primaryKeywordMetric.foundInH1).toBe(true);
    expect(report.primaryKeywordMetric.foundInIntro).toBe(true);
    expect(report.structure.h1Count).toBe(1);
    expect(report.structure.hasProperHierarchy).toBe(true);
    expect(report.structure.hasBulletList).toBe(true);
    expect(report.structure.hasTable).toBe(true);
    expect(report.aeoAnswerReady).toBe(true);
  });

  it("penalizes missing keywords, missing H1, and short word count", () => {
    const poorArticle = "Just a short paragraph with no headings and no target keyword mentioned at all.";
    const report = scoreContent({
      title: "Random Title",
      body: poorArticle,
      primaryKeyword: "Headless CMS",
      targetWordCount: 500,
    });

    expect(report.overallScore).toBeLessThan(40);
    expect(report.primaryKeywordMetric.foundInTitle).toBe(false);
    expect(report.primaryKeywordMetric.foundInH1).toBe(false);
    expect(report.structure.h1Count).toBe(0);
    expect(report.recommendations.some((r) => r.text.includes("Headless CMS"))).toBe(true);
  });
});
