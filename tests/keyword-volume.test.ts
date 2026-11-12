import { describe, it, expect } from "vitest";
import { estimateVolumes, isTrendsQueryable, monthlyFromGsc, trendsLadder, type TrendsFetcher } from "../src/keyword-volume.js";

// Fake Trends: true monthly demand per keyword; returns interest scaled so the batch max = 100, rounded per point like Trends.
const DEMAND: Record<string, number> = { big: 10000, mid: 800, small: 60, tiny: 25, anchorA: 40, anchorB: 100, ghost: 0 };
const fake: TrendsFetcher = async (kws) => {
  const max = Math.max(...kws.map((k) => DEMAND[k] ?? 0));
  return kws.map((k) => Math.round(((DEMAND[k] ?? 0) / max) * 100));
};

describe("keyword-volume", () => {
  it("converts GSC impressions to monthly searches and ignores low positions", () => {
    expect(monthlyFromGsc({ query: "q", impressions: 60, position: 2, days: 30 })).toBe(60);
    expect(monthlyFromGsc({ query: "q", impressions: 10, position: 2, days: 10 })).toBe(30);
    expect(monthlyFromGsc({ query: "q", impressions: 60, position: 25, days: 30 })).toBeNull();
  });

  it("resolves small terms through a pivot ladder", async () => {
    const rel = await trendsLadder(["mid", "small", "tiny"], "big", fake);
    expect(rel.get("mid")).toBeCloseTo(0.08, 2);
    // small (0.6% of big) rounds to 1 against big, but resolves accurately via the "mid" pivot.
    expect(rel.get("small")!).toBeGreaterThan(0.004);
    expect(rel.get("small")!).toBeLessThan(0.008);
  });

  it("calibrates Trends ratios to absolute volume with GSC anchors", async () => {
    const r = await estimateVolumes({
      keywords: ["mid", "small", "ghost"],
      anchors: [
        { query: "anchorA", impressions: 40, position: 1.5, days: 30 },
        { query: "anchorB", impressions: 100, position: 2, days: 30 },
      ],
      pivot: "big",
      fetchTrends: fake,
    });
    const byKw = Object.fromEntries(r.estimates.map((e) => [e.keyword, e]));
    expect(r.anchorsUsed.length).toBe(2);
    expect(byKw.mid.monthly!).toBeGreaterThan(600);
    expect(byKw.mid.monthly!).toBeLessThan(1000);
    expect(byKw.ghost.method).toBe("below-trends-floor");
  });

  it("skips operator queries and survives a keyword Trends rejects", async () => {
    expect(isTrendsQueryable('"tata fab" -site:x.com')).toBe(false);
    expect(isTrendsQueryable("dholera plot price")).toBe(true);
    const flaky: TrendsFetcher = async (kws) => {
      if (kws.includes("bad")) throw new Error("Google Trends HTTP 400");
      return fake(kws);
    };
    const rel = await trendsLadder(["mid", "bad"], "big", flaky);
    expect(rel.get("mid")).toBeCloseTo(0.08, 2);
    expect(rel.has("bad")).toBe(false);
  });
});

describe("keyword-volume floors and errors", () => {
  it("never reports below a GSC impression floor, and flags Trends errors", async () => {
    const flaky: TrendsFetcher = async (kws) => {
      if (kws.includes("bad")) throw new Error("Google Trends HTTP 400");
      return fake(kws);
    };
    const r = await estimateVolumes({
      keywords: ["ghost", "bad"],
      anchors: [
        { query: "anchorA", impressions: 40, position: 1.5, days: 30 },
        { query: "ghost", impressions: 90, position: 9, days: 30 },
      ],
      pivot: "big",
      fetchTrends: flaky,
    });
    const byKw = Object.fromEntries(r.estimates.map((e) => [e.keyword, e]));
    expect(byKw.ghost.method).toBe("gsc-floor");
    expect(byKw.ghost.low).toBe(90);
    expect(byKw.bad.method).toBe("trends-error");
  });
});

describe("keyword-volume rate limits", () => {
  it("returns partial results instead of throwing when Trends rate-limits", async () => {
    let calls = 0;
    const limited: TrendsFetcher = async (kws) => {
      if (++calls > 1) throw new Error("Google Trends rate limit: retries exhausted");
      return fake(kws);
    };
    const r = await estimateVolumes({ keywords: ["mid", "a", "b", "c", "small"], anchors: [], pivot: "big", fetchTrends: limited });
    expect(r.rateLimited).toBe(true);
    expect(r.estimates.find((e) => e.keyword === "small")!.method).toBe("trends-error");
  });
});
