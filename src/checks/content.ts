/**
 * Content checks — word count, thin content, readability, and keyword stuffing.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";
import { analyzeContent } from "../content-analyzer.js";

const THIN_CONTENT_WORDS = 250;

export function contentChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { meta, pageUrl, status, html } = ctx;

  if (!html || status === 0 || status >= 300) return { issues };

  const minWords = ctx.thresholds?.minWordCount ?? THIN_CONTENT_WORDS;

  if (meta.wordCount < minWords) {
    const severity = meta.wordCount < 100 ? "Warning" : "Notice";
    issues.push({
      id: "low_word_count",
      name: "Low word count",
      severity,
      category: "Content",
      message: `Page body text has only ${meta.wordCount} words (minimum threshold is ${minWords} words for search indexing).`,
      url: pageUrl,
      details: { wordCount: meta.wordCount, threshold: minWords },
    });
  }

  // Deep content analysis: readability and keyword stuffing
  if (meta.wordCount >= 150) {
    try {
      const analysis = analyzeContent(html, { url: pageUrl });

      // Keyword stuffing detection
      const allNgrams = [
        ...analysis.keywords.unigrams,
        ...analysis.keywords.bigrams,
        ...analysis.keywords.trigrams,
      ];
      const stuffingKw = allNgrams.find((k) => k.isStuffing && k.count >= 5);
      if (stuffingKw) {
        issues.push({
          id: "keyword_stuffing",
          name: "Keyword stuffing detected",
          severity: "Warning",
          category: "Content",
          message: `Phrase "${stuffingKw.phrase}" appears ${stuffingKw.count} times (${stuffingKw.density}% density). Google Helpful Content guidelines penalize keyword stuffing.`,
          url: pageUrl,
          details: { phrase: stuffingKw.phrase, count: stuffingKw.count, density: stuffingKw.density },
        });
      }

      // Very difficult readability
      if (analysis.readability.fleschReadingEase < 30) {
        issues.push({
          id: "difficult_readability",
          name: "Difficult readability score",
          severity: "Notice",
          category: "Content",
          message: `Flesch Reading Ease score is ${analysis.readability.fleschReadingEase} (College Graduate level). Simplify vocabulary and shorten sentences toward a 60+ score for better user engagement.`,
          url: pageUrl,
          details: {
            fleschReadingEase: analysis.readability.fleschReadingEase,
            gradeLevel: analysis.readability.fleschKincaidGrade,
            readingLevel: analysis.readability.readingLevel,
          },
        });
      }
    } catch {
      // Content analysis is non-fatal
    }
  }

  return { issues };
}
