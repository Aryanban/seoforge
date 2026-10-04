import { describe, it, expect } from "vitest";
import { classifyAnchor, analyzeAnchorProfile } from "../src/anchor-analyzer.js";
import { LinkRecord } from "../src/types.js";

describe("anchor-analyzer", () => {
  it("classifies exact match, branded, generic, and naked URL anchors", () => {
    expect(
      classifyAnchor("SEOForge", { brandName: "SEOForge" })
    ).toBe("branded");

    expect(
      classifyAnchor("Click here for details")
    ).toBe("generic");

    expect(
      classifyAnchor("https://example.com/blog")
    ).toBe("naked_url");

    expect(
      classifyAnchor("keyword tracking", { targetKeywords: ["keyword tracking"] })
    ).toBe("exact_match");

    expect(classifyAnchor("")).toBe("empty_image");
  });

  it("analyzes anchor distribution and flags high Penguin risk on over-optimized anchors", () => {
    const makeLink = (anchor: string, nofollow = false): LinkRecord => ({
      crawlId: "test",
      source: "https://example.com/page-a",
      target: "https://example.com/target",
      anchorText: anchor,
      isInternal: true,
      nofollow,
      targetStatus: 200,
      isBroken: false,
      isRedirect: false,
      redirectChain: [],
    });

    const links = [
      makeLink("best crm"),
      makeLink("best crm"),
      makeLink("best crm"),
      makeLink("best crm"),
      makeLink("best crm"),
      makeLink("click here"),
      makeLink("SEOForge"),
      makeLink("https://example.com"),
    ];

    const report = analyzeAnchorProfile(links, {
      brandName: "SEOForge",
      targetKeywords: ["best crm"],
    });

    expect(report.totalLinks).toBe(8);
    expect(report.penguinRiskLevel).toBe("High");
    expect(report.warnings.some((w) => w.includes("Penguin"))).toBe(true);
    expect(report.topAnchors[0].anchorText).toBe("best crm");
    expect(report.topAnchors[0].count).toBe(5);
  });
});
