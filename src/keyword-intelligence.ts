/**
 * Keyword Intelligence & Search Intent Engine for SEOForge.
 * Rivals paid Ahrefs Keywords Explorer ($199/mo) with local Search Intent classification,
 * Keyword Difficulty (KD) estimation, and long-tail question/variation generation.
 */

export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational";

export interface SearchIntentResult {
  primaryIntent: SearchIntent;
  secondaryIntent?: SearchIntent;
  confidence: number; // 0 - 100
  intentLabel: string;
  explanation: string;
}

export type DifficultyTier = "Very Easy" | "Easy" | "Medium" | "Hard" | "Super Hard";

export interface KeywordDifficultyResult {
  score: number; // 0 - 100
  tier: DifficultyTier;
  estimatedRefDomainsNeeded: number; // Ahrefs-style referring domains estimate
  competitiveFactors: string[];
}

export interface KeywordVariation {
  keyword: string;
  intent: SearchIntent;
  difficulty: number;
}

export interface KeywordVariationsResult {
  questions: KeywordVariation[];
  commercial: KeywordVariation[];
  longTail: KeywordVariation[];
}

export interface IntentAlignmentCheck {
  aligned: boolean;
  score: number; // 0 - 100
  recommendations: string[];
}

const INFORMATIONAL_TRIGGERS = [
  "how", "what", "why", "who", "when", "where", "guide", "tutorial",
  "tips", "steps", "ideas", "learn", "example", "definition", "overview",
  "explained", "meaning", "difference between", "diy", "history"
];

const COMMERCIAL_TRIGGERS = [
  "best", "top", "review", "reviews", "vs", "versus", "comparison",
  "alternative", "alternatives", "pros and cons", "worth it", "benchmark",
  "cheapest", "ratings", "ranking"
];

const TRANSACTIONAL_TRIGGERS = [
  "buy", "order", "price", "pricing", "cost", "discount", "coupon",
  "cheap", "hire", "service", "services", "download", "purchase",
  "quote", "estimate", "deal", "shop", "sale", "subscription"
];

const NAVIGATIONAL_TRIGGERS = [
  "login", "signin", "sign in", "log in", "portal", "account",
  "dashboard", "official", "app", "website", "support", "contact us"
];

/**
 * Classifies a query into Google/Ahrefs search intent categories.
 */
export function classifySearchIntent(query: string): SearchIntentResult {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/);

  let infoScore = 0;
  let commScore = 0;
  let transScore = 0;
  let navScore = 0;

  for (const trigger of INFORMATIONAL_TRIGGERS) {
    if (q.includes(trigger)) infoScore += 30;
  }
  for (const trigger of COMMERCIAL_TRIGGERS) {
    if (q.includes(trigger)) commScore += 35;
  }
  for (const trigger of TRANSACTIONAL_TRIGGERS) {
    if (q.includes(trigger)) transScore += 35;
  }
  for (const trigger of NAVIGATIONAL_TRIGGERS) {
    if (q.includes(trigger)) navScore += 40;
  }

  // Length heuristics: long question phrases are almost always informational
  if (words.length >= 5 && infoScore > 0) infoScore += 25;
  // If no triggers, general short head terms default to informational or commercial exploration
  if (infoScore === 0 && commScore === 0 && transScore === 0 && navScore === 0) {
    infoScore = 40;
  }

  const scores = [
    { intent: "informational" as SearchIntent, score: infoScore },
    { intent: "commercial" as SearchIntent, score: commScore },
    { intent: "transactional" as SearchIntent, score: transScore },
    { intent: "navigational" as SearchIntent, score: navScore },
  ].sort((a, b) => b.score - a.score);

  const primary = scores[0];
  const secondary = scores[1].score > 20 ? scores[1] : undefined;

  const total = primary.score + (secondary?.score || 0);
  const confidence = Math.min(98, Math.round((primary.score / Math.max(total, 1)) * 100));

  const labels: Record<SearchIntent, string> = {
    informational: "Informational (Learn & Discover)",
    commercial: "Commercial (Compare & Evaluate)",
    transactional: "Transactional (Buy & Convert)",
    navigational: "Navigational (Find Specific Brand/Page)",
  };

  const explanations: Record<SearchIntent, string> = {
    informational: "Users are seeking knowledge, step-by-step guides, or definitions.",
    commercial: "Users are evaluating solutions, looking for reviews, benchmarks, or top lists.",
    transactional: "Users have high commercial purchase intent and are looking to buy or subscribe.",
    navigational: "Users are attempting to navigate directly to a login portal or brand page.",
  };

  return {
    primaryIntent: primary.intent,
    secondaryIntent: secondary?.intent,
    confidence,
    intentLabel: labels[primary.intent],
    explanation: explanations[primary.intent],
  };
}

/**
 * Estimates Ahrefs-style Keyword Difficulty (KD 0-100) based on linguistic markers,
 * search intent competition, and term specificity.
 */
export function estimateKeywordDifficulty(keyword: string): KeywordDifficultyResult {
  const q = keyword.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const factors: string[] = [];

  let baseKd = 50;

  // 1. Length & Head-term analysis
  if (words.length === 1) {
    baseKd = 85;
    factors.push("Broad single-word head term with massive search volume");
  } else if (words.length === 2) {
    baseKd = 65;
    factors.push("2-word competitive head keyword");
  } else if (words.length === 3) {
    baseKd = 42;
    factors.push("3-word targeted phrase");
  } else if (words.length >= 4) {
    baseKd = 22;
    factors.push("Long-tail query with lower competitive density");
  }

  // 2. Intent modifiers
  const intent = classifySearchIntent(keyword);
  if (intent.primaryIntent === "transactional") {
    baseKd += 14;
    factors.push("High-value transactional buying intent attracts heavy commercial authority");
  } else if (intent.primaryIntent === "commercial") {
    baseKd += 8;
    factors.push("Commercial comparison terms attract affiliate and review sites");
  } else if (intent.primaryIntent === "informational" && words.length >= 4) {
    baseKd -= 10;
    factors.push("Specific informational query easier to rank with comprehensive content");
  }

  const score = Math.max(5, Math.min(98, baseKd));

  // 3. Difficulty tier
  let tier: DifficultyTier = "Medium";
  if (score <= 20) tier = "Very Easy";
  else if (score <= 40) tier = "Easy";
  else if (score <= 60) tier = "Medium";
  else if (score <= 80) tier = "Hard";
  else tier = "Super Hard";

  // 4. Estimated referring domains needed (Ahrefs model curve)
  let refDomains = 0;
  if (score <= 15) refDomains = 0;
  else if (score <= 30) refDomains = Math.round(score * 0.2); // ~1-6 domains
  else if (score <= 50) refDomains = Math.round(score * 0.5); // ~15-25 domains
  else if (score <= 75) refDomains = Math.round(score * 1.2); // ~50-90 domains
  else refDomains = Math.round(score * 2.5); // ~150-250+ domains

  return {
    score,
    tier,
    estimatedRefDomainsNeeded: refDomains,
    competitiveFactors: factors,
  };
}

/**
 * Generates high-value question queries, commercial variants, and long-tail keywords.
 */
export function generateKeywordVariations(seedKeyword: string): KeywordVariationsResult {
  const seed = seedKeyword.trim();
  const clean = seed.replace(/^[#0-9.:\s]+/, "");

  const questionTemplates = [
    `How to use ${clean} effectively`,
    `What is ${clean} and how does it work`,
    `Why is ${clean} important for SEO`,
    `When should you implement ${clean}`,
    `Is ${clean} worth the investment`,
  ];

  const commercialTemplates = [
    `Best ${clean} tools and software`,
    `${clean} vs alternatives comparison`,
    `Top rated ${clean} platforms`,
    `Free vs paid ${clean} options`,
  ];

  const longTailTemplates = [
    `${clean} complete guide for beginners`,
    `${clean} best practices and checklist`,
    `Automated ${clean} workflow`,
    `${clean} step by step tutorial`,
  ];

  const mapVariation = (kw: string): KeywordVariation => ({
    keyword: kw,
    intent: classifySearchIntent(kw).primaryIntent,
    difficulty: estimateKeywordDifficulty(kw).score,
  });

  return {
    questions: questionTemplates.map(mapVariation),
    commercial: commercialTemplates.map(mapVariation),
    longTail: longTailTemplates.map(mapVariation),
  };
}

/**
 * Validates whether a page's content structure satisfies the search intent of its target keyword.
 */
export function auditSearchIntentAlignment(
  keyword: string,
  page: {
    title?: string;
    wordCount?: number;
    hasComparisonTable?: boolean;
    hasFaq?: boolean;
    hasPricingSignals?: boolean;
  }
): IntentAlignmentCheck {
  const intent = classifySearchIntent(keyword);
  const recs: string[] = [];
  let score = 100;

  if (intent.primaryIntent === "commercial") {
    if (!page.hasComparisonTable) {
      score -= 25;
      recs.push("Commercial queries require a structured comparison table or pros/cons breakdown.");
    }
    if ((page.wordCount || 0) < 600) {
      score -= 20;
      recs.push("Review and comparison content typically requires at least 600–1,200 words of thorough evaluation.");
    }
  } else if (intent.primaryIntent === "informational") {
    if (!page.hasFaq) {
      score -= 15;
      recs.push("Informational guides should include a Q&A / FAQ section with FAQPage schema.");
    }
    if ((page.wordCount || 0) < 500) {
      score -= 25;
      recs.push("Informational searchers expect in-depth answers; increase word count beyond 500 words.");
    }
  } else if (intent.primaryIntent === "transactional") {
    if (!page.hasPricingSignals) {
      score -= 30;
      recs.push("Transactional searchers expect clear pricing tables, CTA buttons, or free trial access.");
    }
  }

  score = Math.max(10, score);
  return {
    aligned: score >= 70,
    score,
    recommendations: recs,
  };
}
