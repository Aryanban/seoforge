/**
 * Real-Time Content Scorer — SurferSEO & Semrush SEO Writing Assistant parity.
 * Evaluates live drafting content for:
 *  - Primary & secondary keyword placement, density, and prominence
 *  - Readability (Flesch Reading Ease & grade)
 *  - Heading hierarchy (H1 -> H2 -> H3)
 *  - AEO Answer Engine Optimization (direct answer snippet, structured lists)
 *  - Word count against competitive benchmark
 */

export interface ContentScoreInput {
  title?: string;
  body: string; // Markdown or plain text
  primaryKeyword: string;
  secondaryKeywords?: string[];
  targetWordCount?: number;
}

export interface KeywordMetric {
  keyword: string;
  count: number;
  density: number; // percentage (e.g. 1.5%)
  foundInTitle: boolean;
  foundInH1: boolean;
  foundInIntro: boolean; // First 100 words
  foundInHeadings: boolean;
  status: "Under-optimized" | "Optimal" | "Over-optimized";
}

export interface ReadabilityMetrics {
  fleschReadingEase: number; // 0-100
  readingGradeLevel: string; // e.g. "8th Grade (Plain English)"
  wordCount: number;
  sentenceCount: number;
  avgWordsPerSentence: number;
}

export interface ContentScoreReport {
  overallScore: number; // 0-100
  primaryKeywordMetric: KeywordMetric;
  secondaryKeywordMetrics: KeywordMetric[];
  readability: ReadabilityMetrics;
  structure: {
    h1Count: number;
    h2Count: number;
    h3Count: number;
    hasProperHierarchy: boolean;
    hasBulletList: boolean;
    hasTable: boolean;
  };
  aeoAnswerReady: boolean;
  recommendations: Array<{ priority: "High" | "Medium" | "Low"; text: string }>;
}

export function scoreContent(input: ContentScoreInput): ContentScoreReport {
  const targetWordCount = input.targetWordCount || 1000;
  const rawBody = input.body || "";
  const title = input.title || "";

  // Extract headings from markdown or text
  const h1Matches = rawBody.match(/^#\s+(.+)$/gm) || [];
  const h2Matches = rawBody.match(/^##\s+(.+)$/gm) || [];
  const h3Matches = rawBody.match(/^###\s+(.+)$/gm) || [];

  const h1Texts = h1Matches.map((h) => h.replace(/^#\s+/, "").trim());
  const h2Texts = h2Matches.map((h) => h.replace(/^##\s+/, "").trim());
  const allHeadings = [...h1Texts, ...h2Texts, ...h3Matches.map((h) => h.replace(/^###\s+/, "").trim())];

  // Tokenize words
  const words = rawBody
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const wordCount = words.length;

  // Sentences (split by ., !, ?)
  const sentences = rawBody
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const sentenceCount = Math.max(1, sentences.length);

  // Readability - Flesch Reading Ease approximation
  // syllables estimate: count vowel groups
  let syllableCount = 0;
  for (const word of words) {
    const clean = word.toLowerCase().replace(/e$/, "");
    const vowels = clean.match(/[aeiouy]{1,2}/g);
    syllableCount += vowels ? vowels.length : 1;
  }
  const avgWordsPerSentence = Math.round((wordCount / sentenceCount) * 10) / 10;
  const avgSyllablesPerWord = wordCount > 0 ? syllableCount / wordCount : 1;

  // Flesch Reading Ease Formula = 206.835 - (1.015 * ASL) - (84.6 * ASW)
  let flesch = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;
  flesch = Math.max(0, Math.min(100, Math.round(flesch)));

  let readingGradeLevel = "College Level (Difficult)";
  if (flesch >= 80) readingGradeLevel = "6th Grade (Very Easy)";
  else if (flesch >= 70) readingGradeLevel = "7th Grade (Fairly Easy)";
  else if (flesch >= 60) readingGradeLevel = "8th-9th Grade (Plain English)";
  else if (flesch >= 50) readingGradeLevel = "10th-12th Grade (Fairly Difficult)";

  // Keyword Analysis Helper
  const analyzeKw = (kw: string): KeywordMetric => {
    const cleanKw = kw.trim().toLowerCase();
    if (!cleanKw) {
      return {
        keyword: kw,
        count: 0,
        density: 0,
        foundInTitle: false,
        foundInH1: false,
        foundInIntro: false,
        foundInHeadings: false,
        status: "Under-optimized",
      };
    }

    const re = new RegExp(`\\b${cleanKw.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "gi");
    const count = (rawBody.match(re) || []).length;
    const density = wordCount > 0 ? Math.round(((count * cleanKw.split(/\s+/).length) / wordCount) * 1000) / 10 : 0;

    const foundInTitle = title.toLowerCase().includes(cleanKw);
    const foundInH1 = h1Texts.some((h) => h.toLowerCase().includes(cleanKw));
    const first100Words = words.slice(0, 100).join(" ");
    const foundInIntro = first100Words.includes(cleanKw);
    const foundInHeadings = allHeadings.some((h) => h.toLowerCase().includes(cleanKw));

    let status: "Under-optimized" | "Optimal" | "Over-optimized" = "Optimal";
    if (density < 0.5 || count === 0) status = "Under-optimized";
    else if (density > 2.8) status = "Over-optimized";

    return {
      keyword: kw,
      count,
      density,
      foundInTitle,
      foundInH1,
      foundInIntro,
      foundInHeadings,
      status,
    };
  };

  const primaryMetric = analyzeKw(input.primaryKeyword);
  const secondaryMetrics = (input.secondaryKeywords || []).map(analyzeKw);

  // AEO check: looks for direct definition / concise paragraph after an H2 question
  let aeoAnswerReady = false;
  const questionH2 = h2Texts.some((h) => /\b(what|how|why|which|can|does|is|are)\b/i.test(h) || h.endsWith("?"));
  const hasInvertedPyramid = sentences.some((s) => s.split(/\s+/).length >= 25 && s.split(/\s+/).length <= 60);
  if (questionH2 && hasInvertedPyramid) aeoAnswerReady = true;

  // Structural checks
  const hasBulletList = /^(\s*[-*]|\s*\d+\.)\s+.+/m.test(rawBody);
  const hasTable = /\|(.+)\|/.test(rawBody);
  const h1Count = h1Matches.length;
  const h2Count = h2Matches.length;
  const h3Count = h3Matches.length;
  const hasProperHierarchy = h1Count === 1 && (h3Count === 0 || h2Count > 0);

  // Scoring weights:
  // - Primary keyword optimization: 35 pts
  // - Secondary keyword coverage: 15 pts
  // - Word count benchmark: 20 pts
  // - Heading structure & Readability: 20 pts
  // - AEO & formatting: 10 pts
  let score = 0;

  // Primary KW (35 max)
  if (primaryMetric.foundInTitle) score += 8;
  if (primaryMetric.foundInH1) score += 8;
  if (primaryMetric.foundInIntro) score += 7;
  if (primaryMetric.foundInHeadings) score += 4;
  if (primaryMetric.status === "Optimal") score += 8;
  else if (primaryMetric.count > 0 && primaryMetric.status !== "Over-optimized") score += 4;

  // Secondary KW (15 max)
  if (secondaryMetrics.length > 0) {
    const matchedCount = secondaryMetrics.filter((m) => m.count > 0).length;
    score += Math.round((matchedCount / secondaryMetrics.length) * 15);
  } else {
    score += 15; // default full credit if no secondary specified
  }

  // Word count (20 max)
  const lengthRatio = wordCount / targetWordCount;
  if (lengthRatio >= 0.9) score += 20;
  else score += Math.round(lengthRatio * 20);

  // Headings & Readability (20 max)
  if (hasProperHierarchy) score += 10;
  else if (h1Count === 0) score += 0;
  else score += 5;

  if (flesch >= 50 && flesch <= 80) score += 10;
  else score += 5;

  // AEO and rich format (10 max)
  if (aeoAnswerReady) score += 5;
  if (hasBulletList || hasTable) score += 5;

  score = Math.min(100, Math.max(0, score));

  // Actionable recommendations
  const recommendations: Array<{ priority: "High" | "Medium" | "Low"; text: string }> = [];

  if (!primaryMetric.foundInTitle) {
    recommendations.push({ priority: "High", text: `Include your primary keyword "${input.primaryKeyword}" inside the page <title>.` });
  }
  if (!primaryMetric.foundInH1) {
    recommendations.push({ priority: "High", text: `Include your primary keyword "${input.primaryKeyword}" inside the main H1 heading.` });
  }
  if (!primaryMetric.foundInIntro) {
    recommendations.push({ priority: "High", text: `Mention "${input.primaryKeyword}" within the first 100 words (inverted pyramid introduction).` });
  }
  if (primaryMetric.status === "Under-optimized") {
    recommendations.push({ priority: "Medium", text: `Primary keyword density is low (${primaryMetric.density}%). Aim for 1.0% to 2.2%.` });
  } else if (primaryMetric.status === "Over-optimized") {
    recommendations.push({ priority: "High", text: `Warning: Keyword density is high (${primaryMetric.density}%). Reduce repetition to avoid search engine stuffing penalties.` });
  }

  if (h1Count !== 1) {
    recommendations.push({ priority: "High", text: `Ensure your document has exactly one H1 tag (currently has ${h1Count}).` });
  }
  if (h2Count === 0) {
    recommendations.push({ priority: "Medium", text: "Add subheadings (H2) to break your content into scannable topical sections." });
  }
  if (wordCount < targetWordCount) {
    recommendations.push({ priority: "Medium", text: `Word count (${wordCount} words) is below target (${targetWordCount} words). Add depth to under-covered subtopics.` });
  }
  if (!hasBulletList && !hasTable) {
    recommendations.push({ priority: "Low", text: "Add a structured comparison table or bulleted list to boost LLM citations and AEO extraction." });
  }
  if (!aeoAnswerReady) {
    recommendations.push({ priority: "Low", text: "Add a question-based H2 heading followed immediately by a concise 40-55 word direct answer paragraph for Google AI Overviews." });
  }

  return {
    overallScore: score,
    primaryKeywordMetric: primaryMetric,
    secondaryKeywordMetrics: secondaryMetrics,
    readability: {
      fleschReadingEase: flesch,
      readingGradeLevel,
      wordCount,
      sentenceCount,
      avgWordsPerSentence,
    },
    structure: {
      h1Count,
      h2Count,
      h3Count,
      hasProperHierarchy,
      hasBulletList,
      hasTable,
    },
    aeoAnswerReady,
    recommendations,
  };
}
