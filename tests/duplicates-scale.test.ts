import { describe, it, expect } from "vitest";
import { detectDuplicates } from "../src/analysis/duplicates.js";

// Deterministic pseudo-random words so pages are genuinely distinct.
function words(seed: number, n: number): string[] {
  let x = seed * 2654435761 >>> 0;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out.push(`w${x % 5000}`);
  }
  return out;
}

const BOILERPLATE = words(999_999, 120).join(" "); // shared template text on every page

describe("detectDuplicates at scale (MinHash + LSH)", () => {
  it("handles a large templated site without quadratic blow-up or false positives", () => {
    const pages = Array.from({ length: 3000 }, (_, i) => ({
      url: `https://x/p/${i}`,
      bodyText: `${BOILERPLATE} ${words(i + 1, 200).join(" ")}`,
    }));
    const t0 = performance.now();
    const r = detectDuplicates(pages);
    const ms = performance.now() - t0;
    expect(r.nearDuplicates).toHaveLength(0);
    expect(r.exactGroups).toHaveLength(0);
    expect(ms).toBeLessThan(10_000);
  });

  it("reports each member of a near-duplicate pair once, against its closest match", () => {
    const base = words(42, 400);
    const variant = base.map((w, i) => (i === 200 ? "changed" : w));
    const r = detectDuplicates([
      { url: "https://x/a", bodyText: base.join(" ") },
      { url: "https://x/b", bodyText: variant.join(" ") },
      { url: "https://x/c", bodyText: words(7, 400).join(" ") },
    ]);
    const byUrl = new Map(r.nearDuplicates.map((d) => [d.url, d]));
    expect(byUrl.get("https://x/a")?.duplicateOf).toBe("https://x/b");
    expect(byUrl.get("https://x/b")?.duplicateOf).toBe("https://x/a");
    expect(byUrl.has("https://x/c")).toBe(false);
    expect(byUrl.get("https://x/a")!.similarity).toBeGreaterThanOrEqual(0.85);
  });
});

import * as cheerio from "cheerio";
import { evaluateAeo } from "../src/checks/aeo-engine.js";

describe("AEO direct-answer detection", () => {
  const para = Array.from({ length: 45 }, (_, i) => `word${i}`).join(" ");
  it("finds the answer paragraph when the H1 is wrapped in a container", () => {
    const $ = cheerio.load(`<main><div class="hero"><h1>Survey 10</h1><span>badge</span></div><p>${para}</p></main>`);
    expect(evaluateAeo($ as any).hasInvertedPyramidSnippet).toBe(true);
  });
  it("does not credit a paragraph that belongs to a later heading", () => {
    const $ = cheerio.load(`<main><h1>Title</h1><h2>Section</h2></main>`);
    expect(evaluateAeo($ as any).hasInvertedPyramidSnippet).toBe(false);
  });
});
