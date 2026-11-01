/**
 * Keyword & Content Gap Matrix — Semrush "Keyword Gap" parity and AEO superpower.
 * Compares topical coverage and landing page targets across baseline site and competitors.
 * Categorizes keywords into Missing, Untapped, Weak, Shared, and Strong, and creates
 * autonomous AEO content briefs.
 */
import { CrawlResult, PageAuditResult } from "../types.js";
import { extractNgrams } from "../content-analyzer.js";
import { classifySearchIntent, estimateKeywordDifficulty, SearchIntent } from "../keyword-intelligence.js";

export interface KeywordGapItem {
  keyword: string;
  status: "Missing" | "Untapped" | "Weak" | "Shared" | "Strong";
  intent: SearchIntent;
  difficulty: { score: number; label: string };
  baselineCoverage: {
    pageCount: number;
    bestUrl?: string;
    hasInTitleOrH1: boolean;
  };
  competitorCoverage: Record<
    string,
    {
      pageCount: number;
      bestUrl?: string;
      hasInTitleOrH1: boolean;
    }
  >;
  opportunityScore: number;
  contentBrief: {
    suggestedH1: string;
    targetSchema: "Article" | "FAQPage" | "Product" | "HowTo";
    aeoDirectAnswerTip: string;
  };
}

export interface ContentGapReport {
  baselineUrl: string;
  competitorUrls: string[];
  totalKeywordsAnalyzed: number;
  summary: {
    missingCount: number;
    untappedCount: number;
    weakCount: number;
    sharedCount: number;
    strongCount: number;
  };
  topOpportunities: KeywordGapItem[];
  allGaps: KeywordGapItem[];
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "will",
  "can", "has", "have", "had", "not", "but", "all", "any", "our", "your",
  "about", "more", "most", "also", "into", "than", "then", "them", "these",
  "home", "page", "login", "signup", "contact", "about us", "terms", "privacy",
]);

function extractKeywordsFromPages(pages: PageAuditResult[]): Map<string, { pageCount: number; bestUrl?: string; hasInTitleOrH1: boolean }> {
  const map = new Map<string, { pageCount: number; bestUrl?: string; hasInTitleOrH1: boolean }>();

  for (const page of pages) {
    if (!page.isIndexable || page.status !== 200) continue;

    const titleLower = (page.title || "").toLowerCase();
    const h1Lower = (page.h1Text || "").toLowerCase();
    const metaDesc = (page.description || "").toLowerCase();

    // Extract phrases from title and H1
    const rawPhrases = [
      titleLower.split(/[-–|:•]/)[0]?.trim(),
      h1Lower,
      metaDesc.slice(0, 80),
    ].filter(Boolean);

    // Also extract top ngrams from page body if available
    const bodyText = `${page.title || ""} ${h1Lower} ${page.description || ""}`;
    const ngrams = extractNgrams(bodyText, 2, 4);

    const candidates = new Set<string>();
    for (const p of rawPhrases) {
      if (p && p.length >= 4 && p.length <= 50) {
        candidates.add(p.replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim());
      }
    }
    for (const ng of ngrams) {
      if (ng.count >= 1 && !STOP_WORDS.has(ng.phrase)) {
        candidates.add(ng.phrase);
      }
    }

    for (const cand of candidates) {
      if (!cand || cand.length < 4 || STOP_WORDS.has(cand)) continue;

      const inTitleOrH1 = titleLower.includes(cand) || h1Lower.includes(cand);
      const existing = map.get(cand) || { pageCount: 0, hasInTitleOrH1: false };
      existing.pageCount++;
      if (inTitleOrH1 && !existing.hasInTitleOrH1) {
        existing.hasInTitleOrH1 = true;
        existing.bestUrl = page.url;
      } else if (!existing.bestUrl) {
        existing.bestUrl = page.url;
      }
      map.set(cand, existing);
    }
  }

  return map;
}

/**
 * Compares keywords between baseline crawl and competitor crawls.
 */
export function analyzeContentGap(
  baseline: CrawlResult,
  competitors: CrawlResult[]
): ContentGapReport {
  const baselineKeywords = extractKeywordsFromPages(baseline.pages);

  const competitorKeywordMaps = competitors.map((c) => ({
    crawl: c,
    keywords: extractKeywordsFromPages(c.pages),
  }));

  // Gather all unique keywords across all sites
  const allCandidateKeywords = new Set<string>();
  for (const k of baselineKeywords.keys()) allCandidateKeywords.add(k);
  for (const c of competitorKeywordMaps) {
    for (const k of c.keywords.keys()) allCandidateKeywords.add(k);
  }

  const items: KeywordGapItem[] = [];
  let missingCount = 0;
  let untappedCount = 0;
  let weakCount = 0;
  let sharedCount = 0;
  let strongCount = 0;

  for (const kw of allCandidateKeywords) {
    const base = baselineKeywords.get(kw) || { pageCount: 0, hasInTitleOrH1: false };

    const compCoverage: Record<string, { pageCount: number; bestUrl?: string; hasInTitleOrH1: boolean }> = {};
    let compWithTitleCount = 0;
    let totalCompCovering = 0;

    for (const { crawl, keywords } of competitorKeywordMaps) {
      const cov = keywords.get(kw) || { pageCount: 0, hasInTitleOrH1: false };
      compCoverage[crawl.targetUrl] = cov;
      if (cov.pageCount > 0) totalCompCovering++;
      if (cov.hasInTitleOrH1) compWithTitleCount++;
    }

    if (totalCompCovering === 0 && base.pageCount === 0) continue;

    // Status Determination
    let status: KeywordGapItem["status"] = "Shared";
    if (base.pageCount === 0) {
      if (totalCompCovering === competitors.length && competitors.length > 1) {
        status = "Missing";
        missingCount++;
      } else if (totalCompCovering >= 2 || competitors.length === 1) {
        status = "Untapped";
        untappedCount++;
      } else {
        status = "Untapped";
        untappedCount++;
      }
    } else if (!base.hasInTitleOrH1 && compWithTitleCount > 0) {
      status = "Weak";
      weakCount++;
    } else if (base.hasInTitleOrH1 && compWithTitleCount === 0) {
      status = "Strong";
      strongCount++;
    } else {
      status = "Shared";
      sharedCount++;
    }

    const intentRes = classifySearchIntent(kw);
    const intent = intentRes.primaryIntent;
    const diffRes = estimateKeywordDifficulty(kw);
    const difficulty = { score: diffRes.score, label: diffRes.tier };

    // Opportunity Score (0 - 100)
    let opp = 50;
    if (status === "Missing") opp += 30;
    else if (status === "Untapped") opp += 25;
    else if (status === "Weak") opp += 15;
    else if (status === "Shared") opp += 5;
    else if (status === "Strong") opp -= 20;

    if (intent === "commercial" || intent === "transactional") opp += 15;
    if (difficulty.score < 50) opp += 10;
    opp = Math.max(0, Math.min(100, opp));

    // Content Brief Synthesis
    const titleCased = kw.charAt(0).toUpperCase() + kw.slice(1);
    let suggestedH1 = titleCased;
    let targetSchema: "Article" | "FAQPage" | "Product" | "HowTo" = "Article";
    let aeoTip = `Provide a crisp 40-55 word direct definition of ${kw} right beneath the H1.`;

    if (intent === "transactional") {
      suggestedH1 = `Best ${titleCased} Solutions & Pricing`;
      targetSchema = "Product";
      aeoTip = `Include a side-by-side comparison table of key features and pricing metrics for AI engines.`;
    } else if (intent === "commercial") {
      suggestedH1 = `Top ${titleCased} Comparison & Buyer's Guide`;
      targetSchema = "Article";
      aeoTip = `Feature pros/cons bullets and key decision criteria to capture Perplexity and ChatGPT Search citations.`;
    } else if (intent === "informational") {
      suggestedH1 = `What is ${titleCased}? The Definitive Guide`;
      targetSchema = "FAQPage";
      aeoTip = `Answer common questions in H2 headings followed immediately by concise answer paragraphs.`;
    }

    items.push({
      keyword: kw,
      status,
      intent,
      difficulty,
      baselineCoverage: base,
      competitorCoverage: compCoverage,
      opportunityScore: opp,
      contentBrief: {
        suggestedH1,
        targetSchema,
        aeoDirectAnswerTip: aeoTip,
      },
    });
  }

  // Sort by opportunity score descending
  items.sort((a, b) => b.opportunityScore - a.opportunityScore);

  const topOpportunities = items.filter(
    (i) => i.status === "Missing" || i.status === "Untapped" || i.status === "Weak"
  ).slice(0, 25);

  return {
    baselineUrl: baseline.targetUrl,
    competitorUrls: competitors.map((c) => c.targetUrl),
    totalKeywordsAnalyzed: items.length,
    summary: {
      missingCount,
      untappedCount,
      weakCount,
      sharedCount,
      strongCount,
    },
    topOpportunities,
    allGaps: items,
  };
}

/**
 * Formats content gap analysis into an actionable markdown report.
 */
export function formatContentGapMarkdown(report: ContentGapReport): string {
  const lines: string[] = [];
  lines.push(`# 🎯 Keyword & Content Gap Matrix`);
  lines.push(`**Target Baseline:** \`${report.baselineUrl}\``);
  lines.push(`**Competitors Compared:** ${report.competitorUrls.map((u) => `\`${u}\``).join(", ")}`);
  lines.push("");
  lines.push(`## Gap Summary`);
  lines.push(`- **Missing Keywords (All competitors dominate, 0 on baseline):** ${report.summary.missingCount}`);
  lines.push(`- **Untapped Opportunities (High potential competitor terms):** ${report.summary.untappedCount}`);
  lines.push(`- **Weak Coverage (Competitors have dedicated H1/Title, baseline only mentions):** ${report.summary.weakCount}`);
  lines.push(`- **Shared Battlegrounds (Both target):** ${report.summary.sharedCount}`);
  lines.push(`- **Strong Footholds (Baseline dominates):** ${report.summary.strongCount}`);
  lines.push("");

  if (report.topOpportunities.length > 0) {
    lines.push(`## 🚀 Top High-ROI Content Opportunities`);
    lines.push(`| Keyword | Status | Intent | Difficulty | Opportunity Score | Recommended Action & AEO Brief |`);
    lines.push(`| :--- | :---: | :---: | :---: | :---: | :--- |`);
    for (const opp of report.topOpportunities.slice(0, 15)) {
      lines.push(
        `| **${opp.keyword}** | \`${opp.status}\` | ${opp.intent} | ${opp.difficulty.score} (${opp.difficulty.label}) | **${opp.opportunityScore}/100** | Create page: *"${opp.contentBrief.suggestedH1}"* (${opp.contentBrief.targetSchema} schema). ${opp.contentBrief.aeoDirectAnswerTip} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
