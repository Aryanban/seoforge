/**
 * Anchor Text Profiler & Risk Analyzer for SEOForge.
 * Rivals paid Ahrefs Site Explorer ($199/mo) with Anchor Text categorization,
 * distribution breakdowns, generic anchor detection, and Google Penguin over-optimization alerts.
 */

import { LinkRecord } from "./types.js";

export type AnchorCategory =
  | "exact_match"
  | "branded"
  | "partial_match"
  | "generic"
  | "naked_url"
  | "empty_image";

export interface AnchorEntry {
  anchorText: string;
  count: number;
  percentage: number;
  category: AnchorCategory;
  dofollowCount: number;
  nofollowCount: number;
  internalCount: number;
  externalCount: number;
}

export interface AnchorProfileReport {
  totalLinks: number;
  uniqueAnchors: number;
  topAnchors: AnchorEntry[];
  distribution: {
    exactMatchPct: number;
    brandedPct: number;
    partialMatchPct: number;
    genericPct: number;
    nakedUrlPct: number;
    emptyImagePct: number;
  };
  dofollowRatio: number; // 0 - 100
  nofollowRatio: number; // 0 - 100
  penguinRiskLevel: "Low" | "Medium" | "High";
  warnings: string[];
}

const GENERIC_ANCHORS = new Set([
  "click here", "read more", "learn more", "visit here", "visit website",
  "link", "here", "source", "website", "more", "this page", "continue reading",
  "check it out", "view more", "details", "download here", "go here", "find out more"
]);

/**
 * Classifies an anchor text string into SEO anchor categories.
 */
export function classifyAnchor(
  anchor: string,
  options: { brandName?: string; targetKeywords?: string[] } = {}
): AnchorCategory {
  const clean = anchor.trim().toLowerCase();
  const brand = (options.brandName || "").trim().toLowerCase();

  // 1. Empty / image
  if (!clean || clean === "(empty)" || clean === "[image]") {
    return "empty_image";
  }

  // 2. Naked URL
  if (clean.startsWith("http://") || clean.startsWith("https://") || clean.startsWith("www.") || clean.startsWith("/")) {
    return "naked_url";
  }

  // 3. Generic low-value anchor
  if (GENERIC_ANCHORS.has(clean) || clean.match(/^click\s*here|^read\s*more|^learn\s*more/i)) {
    return "generic";
  }

  // 4. Branded
  if (brand && clean.includes(brand)) {
    return "branded";
  }

  // 5. Exact match to target keyword
  if (options.targetKeywords && options.targetKeywords.some((k) => k.toLowerCase() === clean)) {
    return "exact_match";
  }

  // 6. Partial match
  if (
    options.targetKeywords &&
    options.targetKeywords.some((k) => {
      const kwWords = k.toLowerCase().split(/\s+/);
      return kwWords.some((w) => w.length >= 4 && clean.includes(w));
    })
  ) {
    return "partial_match";
  }

  return "branded"; // Default unclassified anchors with semantic text
}

/**
 * Generates an Ahrefs-grade Anchor Profile Report across a collection of links.
 */
export function analyzeAnchorProfile(
  links: LinkRecord[],
  options: { brandName?: string; targetKeywords?: string[] } = {}
): AnchorProfileReport {
  if (links.length === 0) {
    return {
      totalLinks: 0,
      uniqueAnchors: 0,
      topAnchors: [],
      distribution: {
        exactMatchPct: 0,
        brandedPct: 0,
        partialMatchPct: 0,
        genericPct: 0,
        nakedUrlPct: 0,
        emptyImagePct: 0,
      },
      dofollowRatio: 100,
      nofollowRatio: 0,
      penguinRiskLevel: "Low",
      warnings: [],
    };
  }

  const map = new Map<
    string,
    {
      count: number;
      category: AnchorCategory;
      dofollowCount: number;
      nofollowCount: number;
      internalCount: number;
      externalCount: number;
    }
  >();

  let dofollowTotal = 0;
  let nofollowTotal = 0;

  for (const link of links) {
    const rawAnchor = (link.anchorText || "").trim();
    const anchorKey = rawAnchor || "(empty)";
    const cat = classifyAnchor(rawAnchor, options);

    if (link.nofollow) nofollowTotal++;
    else dofollowTotal++;

    const existing = map.get(anchorKey) || {
      count: 0,
      category: cat,
      dofollowCount: 0,
      nofollowCount: 0,
      internalCount: 0,
      externalCount: 0,
    };

    existing.count++;
    if (link.nofollow) existing.nofollowCount++;
    else existing.dofollowCount++;
    if (link.isInternal) existing.internalCount++;
    else existing.externalCount++;

    map.set(anchorKey, existing);
  }

  const total = links.length;
  const entries: AnchorEntry[] = Array.from(map.entries())
    .map(([anchorText, data]) => ({
      anchorText,
      count: data.count,
      percentage: Math.round((data.count / total) * 100),
      category: data.category,
      dofollowCount: data.dofollowCount,
      nofollowCount: data.nofollowCount,
      internalCount: data.internalCount,
      externalCount: data.externalCount,
    }))
    .sort((a, b) => b.count - a.count);

  // Category counts
  let exactCount = 0;
  let brandedCount = 0;
  let partialCount = 0;
  let genericCount = 0;
  let nakedCount = 0;
  let emptyCount = 0;

  for (const item of entries) {
    if (item.category === "exact_match") exactCount += item.count;
    else if (item.category === "branded") brandedCount += item.count;
    else if (item.category === "partial_match") partialCount += item.count;
    else if (item.category === "generic") genericCount += item.count;
    else if (item.category === "naked_url") nakedCount += item.count;
    else if (item.category === "empty_image") emptyCount += item.count;
  }

  const distribution = {
    exactMatchPct: Math.round((exactCount / total) * 100),
    brandedPct: Math.round((brandedCount / total) * 100),
    partialMatchPct: Math.round((partialCount / total) * 100),
    genericPct: Math.round((genericCount / total) * 100),
    nakedUrlPct: Math.round((nakedCount / total) * 100),
    emptyImagePct: Math.round((emptyCount / total) * 100),
  };

  const warnings: string[] = [];

  // Google Penguin Risk Check: over-optimized exact-match anchors
  let penguinRiskLevel: "Low" | "Medium" | "High" = "Low";
  if (distribution.exactMatchPct > 40) {
    penguinRiskLevel = "High";
    warnings.push(
      `High Penguin Risk: Exact match anchors account for ${distribution.exactMatchPct}% of links. Natural profiles typically stay under 20%.`
    );
  } else if (distribution.exactMatchPct > 25) {
    penguinRiskLevel = "Medium";
    warnings.push(
      `Moderate Anchor Over-Optimization: Exact match anchors are ${distribution.exactMatchPct}%. Introduce more branded and natural variations.`
    );
  }

  // Generic Anchor Dilution Check
  if (distribution.genericPct > 15) {
    warnings.push(
      `Generic Anchor Dilution: ${distribution.genericPct}% of links use non-descriptive phrases ("click here", "read more"). Replace with descriptive topical anchors.`
    );
  }

  // Missing Alt Text / Empty Anchors Check
  if (distribution.emptyImagePct > 10) {
    warnings.push(
      `Empty Anchor Text: ${distribution.emptyImagePct}% of links have no anchor text or missing image alt attributes.`
    );
  }

  return {
    totalLinks: total,
    uniqueAnchors: entries.length,
    topAnchors: entries.slice(0, 50),
    distribution,
    dofollowRatio: Math.round((dofollowTotal / total) * 100),
    nofollowRatio: Math.round((nofollowTotal / total) * 100),
    penguinRiskLevel,
    warnings,
  };
}
