import { describe, it, expect } from "vitest";
import { findInternalLinkOpportunities, extractTargetKeywords } from "../src/link-opportunities.js";

describe("link-opportunities", () => {
  it("extracts target keywords from H1, Title, and content analysis", () => {
    const page = {
      url: "https://example.com/features/reporting",
      title: "Automated Reporting Tool | Analytics Suite",
      h1Text: "Real-Time Client Reporting",
      contentAnalysis: {
        targetKeyword: "client reporting",
      },
    };

    const keywords = extractTargetKeywords(page);
    expect(keywords).toContain("client reporting");
    expect(keywords).toContain("real time client reporting");
    expect(keywords).toContain("automated reporting tool");
  });

  it("finds internal link opportunities for unlinked keyword mentions", () => {
    const pages = [
      {
        url: "https://example.com/features/reporting",
        title: "Client Reporting Features",
        h1Text: "Client Reporting",
        internalLinkScore: 25,
        incomingInternalLinks: [],
      },
      {
        url: "https://example.com/blog/agency-tips",
        title: "10 Tips for Growing Your Agency",
        bodyText: "When onboarding new accounts, make sure you configure automated client reporting so stakeholders stay informed every week.",
        internalLinkScore: 85,
        incomingInternalLinks: ["https://example.com/"],
      },
    ];

    const opportunities = findInternalLinkOpportunities(pages as any, []);
    expect(opportunities.length).toBe(1);
    expect(opportunities[0].sourceUrl).toBe("https://example.com/blog/agency-tips");
    expect(opportunities[0].targetUrl).toBe("https://example.com/features/reporting");
    expect(opportunities[0].keyword.toLowerCase()).toBe("client reporting");
    expect(opportunities[0].contextSnippet).toContain("client reporting");
    expect(opportunities[0].equityBoost).toBe("High");
    expect(opportunities[0].opportunityScore).toBeGreaterThanOrEqual(70);
  });

  it("skips pages that already link to the target", () => {
    const pages = [
      {
        url: "https://example.com/target",
        h1Text: "Lead Generation",
      },
      {
        url: "https://example.com/source",
        bodyText: "We offer comprehensive lead generation software for teams.",
      },
    ];

    const existingLinks = [
      {
        crawlId: "test",
        source: "https://example.com/source",
        target: "https://example.com/target",
        anchorText: "leads",
        isInternal: true,
        nofollow: false,
        targetStatus: 200,
        isBroken: false,
        isRedirect: false,
        redirectChain: [],
      },
    ];

    const opportunities = findInternalLinkOpportunities(pages as any, existingLinks);
    expect(opportunities.length).toBe(0);
  });
});
