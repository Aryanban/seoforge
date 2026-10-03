/**
 * Content, Keyword & Readability Analyzer for SEOForge.
 *
 * Implements Ahrefs / Surfer SEO / Clearscope-grade on-page content optimization:
 * - Flesch Reading Ease & Flesch-Kincaid Grade Level calculations.
 * - N-gram (1-word, 2-word, 3-word) keyword frequency & density analysis.
 * - Keyword stuffing detection (>3.5% density).
 * - Target keyword on-page placement audit (URL, Title, H1, Meta, First 100 words, Image Alts).
 * - Complete heading outline tree with hierarchy validation.
 */
import * as cheerio from "cheerio";

export const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
  "but", "by", "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
  "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "get",
  "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's",
  "her", "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i",
  "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself",
  "just", "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of",
  "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over",
  "own", "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so",
  "some", "such", "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
  "then", "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this",
  "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd",
  "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's", "where",
  "where's", "which", "while", "who", "who's", "whom", "why", "why's", "will", "with", "won't",
  "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself",
  "yourselves"
]);

export interface ReadabilityMetrics {
  wordCount: number;
  sentenceCount: number;
  syllableCount: number;
  avgWordsPerSentence: number;
  avgSyllablesPerWord: number;
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  readingLevel: string;
  readingTimeMinutes: number;
}

export interface KeywordNgram {
  phrase: string;
  count: number;
  density: number; // percentage (e.g. 2.14)
  isStuffing: boolean; // density > 3.5% with count >= 4
}

export interface TargetKeywordAudit {
  keyword: string;
  inUrl: boolean;
  inTitle: boolean;
  inH1: boolean;
  inDescription: boolean;
  inFirst100Words: boolean;
  inImageAlts: boolean;
  count: number;
  density: number;
  status: "optimal" | "under_optimized" | "over_optimized";
  recommendations: string[];
}

export interface HeadingItem {
  level: number;
  text: string;
  id?: string;
}

export interface ContentAnalysisResult {
  readability: ReadabilityMetrics;
  keywords: {
    unigrams: KeywordNgram[];
    bigrams: KeywordNgram[];
    trigrams: KeywordNgram[];
  };
  headings: {
    items: HeadingItem[];
    hasSkippedLevels: boolean;
    h1Count: number;
    h2Count: number;
    h3Count: number;
  };
  targetKeywordAudit?: TargetKeywordAudit;
  first100Words: string;
}

/**
 * Counts syllables in an English word using phonetic heuristic rules.
 */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;

  // Remove common non-vocal endings
  let cleaned = w.replace(/(?:[^laeiouy]|ed|es|e)$/, "");
  if (!cleaned) cleaned = w;

  // Match all contiguous vowel groups
  const matches = cleaned.match(/[aeiouy]+/g);
  return matches ? Math.max(1, matches.length) : 1;
}

/**
 * Computes Flesch Reading Ease and Flesch-Kincaid Grade Level.
 */
export function calculateReadability(text: string): ReadabilityMetrics {
  const clean = text.trim();
  if (!clean) {
    return {
      wordCount: 0,
      sentenceCount: 0,
      syllableCount: 0,
      avgWordsPerSentence: 0,
      avgSyllablesPerWord: 0,
      fleschReadingEase: 0,
      fleschKincaidGrade: 0,
      readingLevel: "No content",
      readingTimeMinutes: 0,
    };
  }

  // Sentences split by punctuation
  const sentences = clean.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(1, sentences.length);

  // Words
  const words = clean.split(/\s+/).map((w) => w.replace(/[^a-zA-Z0-9'-]/g, "")).filter(Boolean);
  const wordCount = Math.max(1, words.length);

  let syllableCount = 0;
  for (const w of words) {
    syllableCount += countSyllables(w);
  }

  const avgWordsPerSentence = wordCount / sentenceCount;
  const avgSyllablesPerWord = syllableCount / wordCount;

  // Flesch Reading Ease: 206.835 - 1.015(ASL) - 84.6(ASW)
  const rawEase = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;
  const fleschReadingEase = Math.round(Math.min(100, Math.max(0, rawEase)) * 10) / 10;

  // Flesch-Kincaid Grade Level: 0.39(ASL) + 11.8(ASW) - 15.59
  const rawGrade = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;
  const fleschKincaidGrade = Math.round(Math.max(0, rawGrade) * 10) / 10;

  let readingLevel = "Standard (8th & 9th grade)";
  if (fleschReadingEase >= 90) readingLevel = "5th grade (Very Easy)";
  else if (fleschReadingEase >= 80) readingLevel = "6th grade (Easy)";
  else if (fleschReadingEase >= 70) readingLevel = "7th grade (Fairly Easy)";
  else if (fleschReadingEase >= 60) readingLevel = "8th & 9th grade (Plain English - Recommended)";
  else if (fleschReadingEase >= 50) readingLevel = "10th to 12th grade (Fairly Difficult)";
  else if (fleschReadingEase >= 30) readingLevel = "College level (Difficult)";
  else readingLevel = "College Graduate (Very Confusing)";

  const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

  return {
    wordCount,
    sentenceCount,
    syllableCount,
    avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
    avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 10) / 10,
    fleschReadingEase,
    fleschKincaidGrade,
    readingLevel,
    readingTimeMinutes,
  };
}

/**
 * Extracts top n-grams from body text with stop word filtering and frequency calculation.
 */
export function extractNgrams(text: string, n: number, minOccurrences: number = 2): KeywordNgram[] {
  const cleanTokens = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !/^\d+$/.test(t));

  const totalWords = cleanTokens.length;
  if (totalWords < n) return [];

  const counts = new Map<string, number>();

  for (let i = 0; i <= totalWords - n; i++) {
    const slice = cleanTokens.slice(i, i + n);
    // Ignore if all tokens are stop words
    if (slice.every((w) => STOP_WORDS.has(w))) continue;
    // For n > 1, don't start or end with a stop word
    if (n > 1 && (STOP_WORDS.has(slice[0]) || STOP_WORDS.has(slice[slice.length - 1]))) continue;

    const phrase = slice.join(" ");
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
  }

  const results: KeywordNgram[] = [];
  for (const [phrase, count] of counts.entries()) {
    if (count >= minOccurrences) {
      const density = Math.round(((count * n) / totalWords) * 10000) / 100;
      results.push({
        phrase,
        count,
        density,
        isStuffing: density > 3.5 && count >= 4,
      });
    }
  }

  // Sort descending by count, then density
  return results.sort((a, b) => b.count - a.count || b.density - a.density).slice(0, 12);
}

/**
 * Audits on-page placement of a target keyword across primary HTML signals.
 */
export function auditTargetKeyword(
  keyword: string,
  context: {
    bodyText: string;
    title?: string;
    h1?: string;
    description?: string;
    url?: string;
    imgAlts?: string[];
  }
): TargetKeywordAudit {
  const kw = keyword.toLowerCase().trim();
  const kwWords = kw.split(/\s+/).filter(Boolean);
  const bodyLower = context.bodyText.toLowerCase();

  // URL check
  const urlLower = (context.url || "").toLowerCase();
  const inUrl = kwWords.every((w) => urlLower.includes(w));

  // Title check
  const titleLower = (context.title || "").toLowerCase();
  const inTitle = titleLower.includes(kw);

  // H1 check
  const h1Lower = (context.h1 || "").toLowerCase();
  const inH1 = h1Lower.includes(kw);

  // Meta description check
  const descLower = (context.description || "").toLowerCase();
  const inDescription = descLower.includes(kw);

  // First 100 words check
  const first100 = bodyLower.split(/\s+/).slice(0, 100).join(" ");
  const inFirst100Words = first100.includes(kw);

  // Image alts check
  const alts = (context.imgAlts || []).map((a) => a.toLowerCase());
  const inImageAlts = alts.some((a) => a.includes(kw));

  // Count & density in body
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "gi");
  const matches = bodyLower.match(regex);
  const count = matches ? matches.length : 0;

  const totalWords = Math.max(1, bodyLower.split(/\s+/).filter(Boolean).length);
  const density = Math.round(((count * kwWords.length) / totalWords) * 10000) / 100;

  let status: "optimal" | "under_optimized" | "over_optimized" = "optimal";
  if (density > 3.5 && count >= 5) status = "over_optimized";
  else if (density < 0.6 || count === 0) status = "under_optimized";

  const recommendations: string[] = [];
  if (!inTitle) recommendations.push(`Include target keyword "${keyword}" in the <title> tag near the beginning.`);
  if (!inH1) recommendations.push(`Include target keyword "${keyword}" in your primary <h1> heading.`);
  if (!inDescription) recommendations.push(`Mention target keyword "${keyword}" naturally in the meta description.`);
  if (!inFirst100Words) recommendations.push(`Add "${keyword}" within the first 100 words of page content to confirm immediate intent.`);
  if (!inUrl) recommendations.push(`Incorporate "${kw.replace(/\s+/g, "-")}" in the page URL slug.`);
  if (!inImageAlts && (context.imgAlts?.length ?? 0) > 0) recommendations.push(`Include "${keyword}" in at least one image alt attribute.`);
  if (status === "over_optimized") recommendations.push(`Keyword density is ${density}%. Reduce repetitions to prevent Google keyword-stuffing penalties.`);

  return {
    keyword,
    inUrl,
    inTitle,
    inH1,
    inDescription,
    inFirst100Words,
    inImageAlts,
    count,
    density,
    status,
    recommendations,
  };
}

/**
 * Extracts visible body text excluding scripts, styles, noscript, and nav elements.
 */
export function extractCleanBodyText($: cheerio.CheerioAPI): string {
  const clone = cheerio.load($.html());
  clone("script, style, noscript, svg, nav, footer, iframe, header").remove();
  return clone("body").text().replace(/\s+/g, " ").trim();
}

/**
 * Analyzes full on-page HTML content for readability, n-grams, headings, and target keyword.
 */
export function analyzeContent(
  html: string,
  options: {
    targetKeyword?: string;
    url?: string;
  } = {}
): ContentAnalysisResult {
  const $ = cheerio.load(html || "<html><body></body></html>");
  const bodyText = extractCleanBodyText($);

  const title = $("title").first().text().trim();
  const description = $('meta[name="description" i]').attr("content")?.trim();
  const h1 = $("h1").first().text().trim();

  // First 100 words preview
  const first100Words = bodyText.split(/\s+/).slice(0, 100).join(" ");

  // Readability
  const readability = calculateReadability(bodyText);

  // N-grams
  const unigrams = extractNgrams(bodyText, 1, 2);
  const bigrams = extractNgrams(bodyText, 2, 2);
  const trigrams = extractNgrams(bodyText, 3, 2);

  // Heading outline
  const headingItems: HeadingItem[] = [];
  let lastLevel = 0;
  let hasSkippedLevels = false;
  let h1Count = 0;
  let h2Count = 0;
  let h3Count = 0;

  $(":header").each((_, el) => {
    const tagName = (el.tagName || (el as any).name || "").toLowerCase();
    const level = parseInt(tagName.replace("h", ""), 10);
    if (!level) return;

    if (level === 1) h1Count++;
    else if (level === 2) h2Count++;
    else if (level === 3) h3Count++;

    if (lastLevel > 0 && level > lastLevel + 1) {
      hasSkippedLevels = true;
    }
    lastLevel = level;

    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) {
      headingItems.push({
        level,
        text,
        id: $(el).attr("id"),
      });
    }
  });

  // Images for alt tags
  const imgAlts: string[] = [];
  $("img[alt]").each((_, el) => {
    const alt = $(el).attr("alt")?.trim();
    if (alt) imgAlts.push(alt);
  });

  // Target keyword audit: use explicit keyword, top recurring phrase, or H1
  const targetKw =
    options.targetKeyword?.trim() ||
    (bigrams.length > 0 ? bigrams[0].phrase : undefined) ||
    (h1.length > 3 && h1.length < 50 ? h1 : undefined);
  let targetKeywordAudit: TargetKeywordAudit | undefined;
  if (targetKw) {
    targetKeywordAudit = auditTargetKeyword(targetKw, {
      bodyText,
      title,
      h1,
      description,
      url: options.url,
      imgAlts,
    });
  }

  return {
    readability,
    keywords: {
      unigrams,
      bigrams,
      trigrams,
    },
    headings: {
      items: headingItems,
      hasSkippedLevels,
      h1Count,
      h2Count,
      h3Count,
    },
    targetKeywordAudit,
    first100Words,
  };
}
