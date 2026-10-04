import { describe, it, expect } from "vitest";
import {
  classifySearchIntent,
  estimateKeywordDifficulty,
  generateKeywordVariations,
  auditSearchIntentAlignment,
} from "../src/keyword-intelligence.js";

describe("keyword-intelligence", () => {
  it("classifies informational, commercial, transactional, and navigational intent", () => {
    expect(classifySearchIntent("how to improve website speed").primaryIntent).toBe("informational");
    expect(classifySearchIntent("best email finder tools 2026").primaryIntent).toBe("commercial");
    expect(classifySearchIntent("buy cheap domain name").primaryIntent).toBe("transactional");
    expect(classifySearchIntent("stripe login dashboard").primaryIntent).toBe("navigational");
  });

  it("calculates realistic keyword difficulty and refers domains needed", () => {
    const headTerm = estimateKeywordDifficulty("crm");
    expect(headTerm.score).toBeGreaterThanOrEqual(75);
    expect(headTerm.tier).toMatch(/Hard|Super Hard/);
    expect(headTerm.estimatedRefDomainsNeeded).toBeGreaterThanOrEqual(50);

    const longTail = estimateKeywordDifficulty("free open source crm for local contractors");
    expect(longTail.score).toBeLessThan(40);
    expect(longTail.tier).toMatch(/Very Easy|Easy/);
  });

  it("generates variations and question queries", () => {
    const res = generateKeywordVariations("local seo");
    expect(res.questions.length).toBeGreaterThan(0);
    expect(res.questions[0].keyword).toContain("local seo");
    expect(res.commercial.length).toBeGreaterThan(0);
    expect(res.longTail.length).toBeGreaterThan(0);
  });

  it("audits intent alignment and flags missing comparison structures", () => {
    const checkCommercialFail = auditSearchIntentAlignment("best project management tools", {
      wordCount: 300,
      hasComparisonTable: false,
    });
    expect(checkCommercialFail.aligned).toBe(false);
    expect(checkCommercialFail.recommendations.some((r) => r.includes("comparison"))).toBe(true);

    const checkCommercialPass = auditSearchIntentAlignment("best project management tools", {
      wordCount: 1200,
      hasComparisonTable: true,
    });
    expect(checkCommercialPass.aligned).toBe(true);
  });
});
