import { describe, it, expect } from "vitest";
import {
  analyzeRedirectChain,
  generateDirectRedirectCode,
} from "../src/analysis/redirect-tracer.js";

describe("Redirect Chain & Equity Loss Tracer", () => {
  it("detects clean 1-hop redirect without excessive loss", () => {
    const res = analyzeRedirectChain([
      { url: "https://mysite.com/old", status: 301 },
      { url: "https://mysite.com/new", status: 200 },
    ]);
    expect(res.totalHops).toBe(1);
    expect(res.isLoop).toBe(false);
    expect(res.estimatedEquityRetentionPct).toBeGreaterThanOrEqual(95);
    expect(res.severity).toBe("Good");
  });

  it("detects multi-hop redirect chains and equity loss", () => {
    const res = analyzeRedirectChain([
      { url: "http://mysite.com/old", status: 301 },
      { url: "https://mysite.com/old", status: 301 },
      { url: "https://mysite.com/mid", status: 302 },
      { url: "https://mysite.com/new", status: 200 },
    ]);
    expect(res.totalHops).toBe(3);
    expect(res.hasMixedStatuses).toBe(true);
    expect(res.estimatedEquityLossPct).toBeGreaterThan(25);
    expect(res.severity).toBe("Critical");
    expect(res.issues.length).toBeGreaterThan(0);
  });

  it("detects infinite redirect loops", () => {
    const res = analyzeRedirectChain([
      { url: "https://mysite.com/a", status: 301 },
      { url: "https://mysite.com/b", status: 301 },
      { url: "https://mysite.com/a", status: 301 },
    ]);
    expect(res.isLoop).toBe(true);
    expect(res.estimatedEquityRetentionPct).toBe(0);
    expect(res.severity).toBe("Critical");
  });

  it("generates framework-specific redirect rules", () => {
    const nextCode = generateDirectRedirectCode("https://mysite.com/old", "https://mysite.com/new", "nextjs");
    expect(nextCode).toContain("source: '/old'");
    expect(nextCode).toContain("destination: '/new'");
    expect(nextCode).toContain("permanent: true");

    const nginxCode = generateDirectRedirectCode("https://mysite.com/old", "https://mysite.com/new", "nginx");
    expect(nginxCode).toContain("rewrite ^/old$ https://mysite.com/new permanent;");
  });
});
