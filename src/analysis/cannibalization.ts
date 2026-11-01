/**
 * Keyword Cannibalization Detector — Semrush & Ahrefs parity.
 * Scans all indexable crawled pages to identify URLs that compete for the
 * exact same target keywords, search intent, and primary headings.
 */
import { PageAuditResult } from "../types.js";

export interface CannibalizationPair {
  urlA: string;
  urlB: string;
  sharedKeywords: string[];
  severity: "Critical" | "High" | "Medium";
  similarity: number;
  reason: string;
  recommendation: string;
}

export interface CannibalizationReport {
  totalPagesAnalyzed: number;
  cannibalizingPairs: CannibalizationPair[];
  affectedUrls: string[];
  summary: {
    criticalCount: number;
    highCount: number;
    mediumCount: number;
  };
}

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "as", "at", "be", "because", "been", "before", "being", "below",
  "between", "both", "but", "by", "could", "did", "do", "does", "doing", "down",
  "during", "each", "few", "for", "from", "further", "had", "has", "have", "having",
  "he", "her", "here", "hers", "herself", "him", "himself", "his", "how", "i", "if",
  "in", "into", "is", "it", "its", "itself", "just", "me", "more", "most", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other",
  "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should",
  "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves",
  "then", "there", "these", "they", "this", "those", "through", "to", "too", "under",
  "until", "up", "very", "was", "we", "were", "what", "when", "where", "which",
  "while", "who", "whom", "why", "with", "would", "you", "your", "yours", "yourself",
]);

/**
 * Tokenize and extract significant intent keywords from titles, H1s, and slugs.
 */
export function extractIntentTokens(page: { title?: string; h1Text?: string; url: string }): Set<string> {
  const text = `${page.title || ""} ${page.h1Text || ""} ${page.url.split("/").pop() || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[-_]/g, " ");

  const tokens = text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  return new Set(tokens);
}

/**
 * Detect keyword cannibalization across all crawled pages.
 */
export function detectCannibalization(pages: PageAuditResult[]): CannibalizationReport {
  // Only indexable 200 OK HTML pages compete in search results
  const candidates = pages.filter(
    (p) => p.status === 200 && p.isIndexable && !p.blockedByRobots && !p.isRedirect
  );

  const pageTokens = new Map<string, Set<string>>();
  for (const page of candidates) {
    pageTokens.set(page.url, extractIntentTokens(page));
  }

  const cannibalizingPairs: CannibalizationPair[] = [];
  const affectedUrlSet = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const pageA = candidates[i];
      const pageB = candidates[j];
      const tokensA = pageTokens.get(pageA.url)!;
      const tokensB = pageTokens.get(pageB.url)!;

      if (tokensA.size === 0 || tokensB.size === 0) continue;

      const shared = new Set<string>();
      for (const t of tokensA) {
        if (tokensB.has(t)) shared.add(t);
      }

      if (shared.size === 0) continue;

      const minSize = Math.min(tokensA.size, tokensB.size);
      const overlapRatio = shared.size / minSize;

      // Check title/H1 exact or near-exact match
      const normTitleA = (pageA.title || "").trim().toLowerCase();
      const normTitleB = (pageB.title || "").trim().toLowerCase();
      const normH1A = (pageA.h1Text || "").trim().toLowerCase();
      const normH1B = (pageB.h1Text || "").trim().toLowerCase();

      const exactTitleMatch = normTitleA && normTitleA === normTitleB;
      const exactH1Match = normH1A && normH1A === normH1B;

      let severity: "Critical" | "High" | "Medium" | null = null;
      let reason = "";
      let recommendation = "";

      if (exactTitleMatch || exactH1Match) {
        severity = "Critical";
        reason = exactTitleMatch
          ? `Both URLs share the EXACT same <title>: "${pageA.title}"`
          : `Both URLs share the EXACT same H1 heading: "${pageA.h1Text}"`;
        recommendation =
          "Differentiate primary target keywords or consolidate content with a 301 redirect or canonical tag.";
      } else if (overlapRatio >= 0.70 || (overlapRatio >= 0.50 && shared.size >= 3)) {
        severity = "High";
        reason = `High intent overlap (${Math.round(overlapRatio * 100)}%) sharing core keyword cluster: [${Array.from(shared).slice(0, 4).join(", ")}]`;
        recommendation =
          "Reposition one URL to target long-tail variants or merge both into a comprehensive single guide.";
      } else if (overlapRatio >= 0.40 && shared.size >= 2) {
        severity = "Medium";
        reason = `Moderate keyword overlap (${Math.round(overlapRatio * 100)}%) targeting similar query terms: [${Array.from(shared).slice(0, 3).join(", ")}]`;
        recommendation =
          "Review internal linking anchor text and refine page headings to signal distinct search intents.";
      }

      if (severity) {
        cannibalizingPairs.push({
          urlA: pageA.url,
          urlB: pageB.url,
          sharedKeywords: Array.from(shared),
          severity,
          similarity: Math.round(overlapRatio * 100) / 100,
          reason,
          recommendation,
        });
        affectedUrlSet.add(pageA.url);
        affectedUrlSet.add(pageB.url);
      }
    }
  }

  // Sort pairs by severity
  const severityRank = { Critical: 3, High: 2, Medium: 1 };
  cannibalizingPairs.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.similarity - a.similarity);

  return {
    totalPagesAnalyzed: candidates.length,
    cannibalizingPairs,
    affectedUrls: Array.from(affectedUrlSet),
    summary: {
      criticalCount: cannibalizingPairs.filter((p) => p.severity === "Critical").length,
      highCount: cannibalizingPairs.filter((p) => p.severity === "High").length,
      mediumCount: cannibalizingPairs.filter((p) => p.severity === "Medium").length,
    },
  };
}
