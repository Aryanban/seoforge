/**
 * Content checks — word count / thin content.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

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

  return { issues };
}
