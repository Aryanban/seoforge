import { describe, it, expect } from "vitest";
import {
  analyzeLinkIntersect,
  extractRootDomain,
  formatLinkIntersectMarkdown,
} from "../src/analysis/link-intersect.js";

describe("Link Intersect Engine (Ahrefs Parity)", () => {
  it("normalizes domains and URLs properly", () => {
    expect(extractRootDomain("https://www.techcrunch.com/articles/ai")).toBe("techcrunch.com");
    expect(extractRootDomain("sub.github.io/blog/")).toBe("sub.github.io");
    expect(extractRootDomain("http://medium.com")).toBe("medium.com");
  });

  it("identifies high-priority gaps across competitors", () => {
    const report = analyzeLinkIntersect({
      targetDomain: "mysite.com",
      targetBacklinks: ["https://twitter.com/mysite", "https://github.com/mysite/repo"],
      competitors: [
        {
          domain: "competitor-a.com",
          backlinks: [
            "https://techcrunch.com/features/a",
            "https://github.com/comp-a/demo",
            "https://producthunt.com/posts/a",
            "https://dev.to/comp-a/guide",
          ],
        },
        {
          domain: "competitor-b.com",
          backlinks: [
            "https://techcrunch.com/features/b",
            "https://producthunt.com/posts/b",
            "https://hackernews.com/item/123",
          ],
        },
      ],
      minCompetitorOverlap: 2,
    });

    expect(report.targetDomain).toBe("mysite.com");
    expect(report.competitorDomains).toEqual(["competitor-a.com", "competitor-b.com"]);

    // techcrunch.com and producthunt.com link to BOTH competitors, but NOT to mysite
    const tc = report.matrix.find((m) => m.referringDomain === "techcrunch.com");
    expect(tc).toBeDefined();
    expect(tc?.competitorCount).toBe(2);
    expect(tc?.hasTargetLink).toBe(false);
    expect(tc?.priority).toBe("Critical");

    const ph = report.matrix.find((m) => m.referringDomain === "producthunt.com");
    expect(ph).toBeDefined();
    expect(ph?.competitorCount).toBe(2);
    expect(ph?.hasTargetLink).toBe(false);
    expect(ph?.priority).toBe("Critical");

    // github.com links to competitor-a AND mysite has it
    const gh = report.matrix.find((m) => m.referringDomain === "github.com");
    expect(gh).toBeDefined();
    expect(gh?.hasTargetLink).toBe(true);

    expect(report.highPriorityGaps.length).toBeGreaterThanOrEqual(2);
    expect(report.summary.critical).toBe(2);
  });

  it("formats a readable markdown report", () => {
    const report = analyzeLinkIntersect({
      targetDomain: "mysite.com",
      competitors: [
        {
          domain: "comp1.com",
          backlinks: ["https://dev.to/comp1"],
        },
      ],
    });

    const md = formatLinkIntersectMarkdown(report);
    expect(md).toContain("# 🔗 Link Intersect & Backlink Gap Report");
    expect(md).toContain("`mysite.com`");
    expect(md).toContain("dev.to");
  });
});
