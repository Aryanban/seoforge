import { describe, it, expect } from "vitest";
import { detectCannibalization, extractIntentTokens } from "../src/analysis/cannibalization.js";
import { PageAuditResult } from "../src/types.js";

function mockPage(url: string, title: string, h1Text: string): PageAuditResult {
  return {
    url,
    normalizedUrl: url,
    finalUrl: url,
    status: 200,
    responseTimeMs: 80,
    depth: 1,
    rendered: false,
    title,
    h1Text,
    isIndexable: true,
    blockedByRobots: false,
    canonical: url,
    canonicalMatches: true,
    wordCount: 600,
    h1Count: 1,
    h2Count: 2,
    issues: [],
    auditIssues: [],
    openGraph: { incomplete: false, missingKeys: [] },
    twitterCard: { incomplete: false },
    hreflang: [],
    incomingInternalLinks: [],
    outgoingInternalLinks: [],
    externalLinks: [],
    images: [],
    isOrphan: false,
    internalLinkScore: 1,
    isRedirect: false,
    isHttpToHttpsRedirect: false,
    schema: { hasJsonLd: true, typesFound: [], missingExpected: [], googleRichResultsErrors: [], schemaOrgErrors: [], errors: [], rawGraphCount: 1 },
    aeo: { score: 85, h1Count: 1, h2Count: 2, hasInvertedPyramidSnippet: true, tableCount: 1, hasFaqSchema: true, recommendations: [] },
  };
}

describe("Keyword Cannibalization Detector (Semrush & Ahrefs parity)", () => {
  it("extracts intent tokens filtering out stop words", () => {
    const tokens = extractIntentTokens({
      url: "https://example.com/blog/best-crm-software-2026",
      title: "Top 10 Best CRM Software for Enterprise Teams",
      h1Text: "Best CRM Software in 2026",
    });
    expect(tokens.has("crm")).toBe(true);
    expect(tokens.has("software")).toBe(true);
    expect(tokens.has("enterprise")).toBe(true);
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("for")).toBe(false);
  });

  it("detects Critical severity when two pages share the same title or H1", () => {
    const pages = [
      mockPage("https://example.com/crm-tools", "Best CRM Software 2026", "Best CRM Software 2026"),
      mockPage("https://example.com/blog/crm-guide", "Best CRM Software 2026", "A Complete Guide to CRM"),
      mockPage("https://example.com/pricing", "Affordable Cloud Hosting Plans", "Cloud Hosting Pricing"),
    ];

    const report = detectCannibalization(pages);
    expect(report.cannibalizingPairs).toHaveLength(1);
    expect(report.cannibalizingPairs[0].severity).toBe("Critical");
    expect(report.cannibalizingPairs[0].urlA).toBe("https://example.com/crm-tools");
    expect(report.cannibalizingPairs[0].urlB).toBe("https://example.com/blog/crm-guide");
    expect(report.affectedUrls).toContain("https://example.com/crm-tools");
    expect(report.affectedUrls).toContain("https://example.com/blog/crm-guide");
  });

  it("detects High severity when pages share high keyword overlap", () => {
    const pages = [
      mockPage("https://example.com/seo-agency-chicago", "SEO Agency Chicago Services", "Top Chicago SEO Marketing Agency"),
      mockPage("https://example.com/services/chicago-seo", "Chicago SEO Agency Experts", "Chicago SEO Agency for Local Businesses"),
    ];

    const report = detectCannibalization(pages);
    expect(report.cannibalizingPairs.length).toBeGreaterThan(0);
    expect(["Critical", "High"]).toContain(report.cannibalizingPairs[0].severity);
  });

  it("ignores completely distinct pages", () => {
    const pages = [
      mockPage("https://example.com/privacy", "Privacy Policy", "Our Privacy Policy"),
      mockPage("https://example.com/terms", "Terms of Service", "Terms and Conditions"),
    ];

    const report = detectCannibalization(pages);
    expect(report.cannibalizingPairs).toHaveLength(0);
  });
});
