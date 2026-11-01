import { describe, it, expect } from "vitest";
import {
  testRobotsPath,
  auditRobotsAiCompliance,
  formatRobotsAuditMarkdown,
} from "../src/analysis/robots-simulator.js";

const SAMPLE_ROBOTS = `
User-agent: *
Disallow: /admin/
Disallow: /api/
Allow: /api/public/

User-agent: GPTBot
Disallow: /

User-agent: Googlebot
Disallow: /private/
Allow: /
`;

describe("Robots.txt Dynamic Simulator (RFC 9309 & AI Compliance)", () => {
  it("enforces user-agent specific overrides and longest match rule", () => {
    // Wildcard bot testing
    const r1 = testRobotsPath(SAMPLE_ROBOTS, "/admin/dashboard", "Mozilla/5.0");
    expect(r1.allowed).toBe(false);

    // /api/public is longer match than /api/ -> allow wins
    const r2 = testRobotsPath(SAMPLE_ROBOTS, "/api/public/v1", "Mozilla/5.0");
    expect(r2.allowed).toBe(true);

    // GPTBot has specific block for all paths
    const r3 = testRobotsPath(SAMPLE_ROBOTS, "/blog/post-1", "GPTBot");
    expect(r3.allowed).toBe(false);

    // Googlebot has specific block for /private/ but allows others
    const r4 = testRobotsPath(SAMPLE_ROBOTS, "/admin/dashboard", "Googlebot");
    expect(r4.allowed).toBe(true); // User-agent: Googlebot does NOT have /admin/ disallow!
    const r5 = testRobotsPath(SAMPLE_ROBOTS, "/private/doc", "Googlebot");
    expect(r5.allowed).toBe(false);
  });

  it("audits multi-bot AI compliance across search and AI agents", () => {
    const audit = auditRobotsAiCompliance(SAMPLE_ROBOTS, ["/", "/api", "/admin"]);
    expect(audit.totalBotsTested).toBeGreaterThan(10);
    const gptBot = audit.botSummaries.find((b) => b.bot === "GPTBot");
    expect(gptBot?.status).toBe("Blocked");

    const md = formatRobotsAuditMarkdown(audit);
    expect(md).toContain("# 🤖 Robots.txt Multi-Bot Simulation");
    expect(md).toContain("GPTBot");
  });
});
