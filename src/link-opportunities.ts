/**
 * Internal Link Opportunities Engine for SEOForge.
 * Rivals paid Ahrefs ($199/mo) by identifying unlinked mentions of target keywords
 * across internal pages to optimize internal PageRank distribution.
 */

import { LinkRecord, PageAuditResult } from "./types.js";
import { normalizeUrl } from "./crawl/queue.js";

export interface InternalLinkOpportunity {
  sourceUrl: string;
  sourceTitle: string;
  targetUrl: string;
  targetTitle: string;
  keyword: string;
  contextSnippet: string;
  sourceEquity: number;
  targetEquity: number;
  equityBoost: "High" | "Medium" | "Low";
  opportunityScore: number; // 0 - 100
}

export interface LinkOpportunityOptions {
  minScore?: number;
  limitPerTarget?: number;
  maxTotal?: number;
}

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "all", "and", "any", "are", "because",
  "been", "before", "being", "between", "both", "but", "can", "could", "did",
  "does", "doing", "down", "during", "each", "few", "for", "from", "further",
  "had", "has", "have", "having", "here", "how", "into", "itself", "just",
  "more", "most", "must", "not", "off", "once", "only", "other", "our", "ours",
  "out", "over", "own", "same", "should", "some", "such", "than", "that", "the",
  "their", "theirs", "them", "then", "there", "these", "they", "this", "those",
  "through", "too", "under", "until", "very", "was", "were", "what", "when",
  "where", "which", "while", "who", "whom", "why", "with", "would", "your",
  "home", "page", "contact", "privacy", "terms", "policy", "login", "signup"
]);

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extracts high-intent candidate keywords that a target page is attempting to rank for.
 */
export function extractTargetKeywords(page: Partial<PageAuditResult>): string[] {
  const keywords = new Set<string>();

  // 1. Explicit target keyword if set
  const explicitTarget = (page as any).contentAnalysis?.targetKeyword;
  if (explicitTarget && explicitTarget.trim().length >= 3) {
    keywords.add(explicitTarget.trim().toLowerCase());
  }

  // 2. Primary H1 phrase
  if (page.h1Text) {
    const cleanH1 = page.h1Text
      .replace(/^[#0-9.:\s]+/, "")
      .replace(/[-_]+/g, " ")
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (cleanH1.length >= 4 && cleanH1.split(/\s+/).length <= 5 && !STOP_WORDS.has(cleanH1)) {
      keywords.add(cleanH1);
    }
  }

  // 3. Title topic chunk (before pipe or dash)
  if (page.title) {
    const mainTitle = page.title
      .split(/[|\-–:]/)[0]
      .replace(/[-_]+/g, " ")
      .replace(/[^a-zA-Z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (mainTitle.length >= 4 && mainTitle.split(/\s+/).length <= 4 && !STOP_WORDS.has(mainTitle)) {
      keywords.add(mainTitle);
    }
  }

  // 4. Content n-grams from analyzer if present
  const ngrams = (page as any).contentAnalysis?.topKeywords;
  if (Array.isArray(ngrams)) {
    for (const kw of ngrams.slice(0, 3)) {
      if (typeof kw === "string" && kw.length >= 4 && !STOP_WORDS.has(kw)) {
        keywords.add(kw.toLowerCase());
      }
    }
  }

  return Array.from(keywords).filter((k) => k.length >= 3 && !STOP_WORDS.has(k));
}

/**
 * Finds high-value internal link opportunities across the crawled link graph.
 */
export function findInternalLinkOpportunities(
  pages: Array<Partial<PageAuditResult> & { bodyText?: string }>,
  existingLinks: LinkRecord[] = [],
  options: LinkOpportunityOptions = {}
): InternalLinkOpportunity[] {
  const { minScore = 20, limitPerTarget = 4, maxTotal = 60 } = options;
  const opportunities: InternalLinkOpportunity[] = [];

  // Index existing internal links by normalized source -> target
  const linkedPairs = new Set<string>();
  for (const link of existingLinks) {
    if (link.isInternal) {
      linkedPairs.add(`${normalizeUrl(link.source)}|${normalizeUrl(link.target)}`);
    }
  }

  for (const targetPage of pages) {
    if (!targetPage.url) continue;
    const targetNorm = normalizeUrl(targetPage.url);
    const targetKeywords = extractTargetKeywords(targetPage);
    if (targetKeywords.length === 0) continue;

    let targetCount = 0;
    const targetEquity = targetPage.internalLinkScore ?? 30;
    const incomingLinksCount = targetPage.incomingInternalLinks?.length ?? 0;

    for (const sourcePage of pages) {
      if (!sourcePage.url) continue;
      const sourceNorm = normalizeUrl(sourcePage.url);
      if (sourceNorm === targetNorm) continue; // Cannot self-link

      // If source already links to target, skip
      if (linkedPairs.has(`${sourceNorm}|${targetNorm}`)) continue;

      // Extract text content from source page
      const content = sourcePage.bodyText || sourcePage.description || sourcePage.title || "";
      if (!content || content.length < 20) continue;

      for (const keyword of targetKeywords) {
        if (targetCount >= limitPerTarget) break;

        const regex = new RegExp(`\\b(${escapeRegExp(keyword)})\\b`, "i");
        const match = regex.exec(content);

        if (match && match.index !== undefined) {
          // Extract snippet of 60 chars before and after match
          const start = Math.max(0, match.index - 50);
          const end = Math.min(content.length, match.index + match[0].length + 50);
          let snippet = content.slice(start, end).replace(/\s+/g, " ").trim();
          if (start > 0) snippet = `…${snippet}`;
          if (end < content.length) snippet = `${snippet}…`;

          const sourceEquity = sourcePage.internalLinkScore ?? 50;

          // Score calculation:
          // 1. High source equity conveys more PageRank (up to 40 pts)
          // 2. Target equity deficit bonus (up to 30 pts)
          // 3. Low incoming links penalty bonus (up to 20 pts)
          // 4. Exact match bonus (10 pts)
          const equityTransfer = Math.round((sourceEquity / 100) * 40);
          const deficitBonus = incomingLinksCount <= 1 ? 25 : incomingLinksCount <= 3 ? 15 : 5;
          const targetNeedBonus = Math.round(((100 - targetEquity) / 100) * 25);
          const score = Math.min(100, equityTransfer + deficitBonus + targetNeedBonus + 10);

          if (score >= minScore) {
            const equityBoost: "High" | "Medium" | "Low" =
              score >= 70 ? "High" : score >= 45 ? "Medium" : "Low";

            opportunities.push({
              sourceUrl: sourcePage.url,
              sourceTitle: sourcePage.title || sourcePage.url,
              targetUrl: targetPage.url,
              targetTitle: targetPage.title || targetPage.url,
              keyword: match[0],
              contextSnippet: snippet,
              sourceEquity,
              targetEquity,
              equityBoost,
              opportunityScore: score,
            });

            targetCount++;
            break; // Move to next source page for this target
          }
        }
      }
    }
  }

  // Sort descending by opportunity score (highest PageRank impact first)
  opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);
  return opportunities.slice(0, maxTotal);
}
