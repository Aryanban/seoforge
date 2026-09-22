/**
 * AEO (Answer Engine Optimization) checks — AI-answer extractability scoring.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

export function aeoChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { meta, pageUrl, html, thresholds } = ctx;

  if (!html) return { issues };

  const aeo = meta.aeo;
  const minScore = thresholds?.minAeoScore ?? 70;

  if (aeo.score < minScore) {
    issues.push({
      id: "low_aeo_score",
      name: "Low AEO (Answer Engine Optimization) score",
      severity: "Warning",
      category: "AEO",
      message: `AEO score is ${aeo.score}/100 (threshold: ${minScore}). The page is poorly optimized for extraction by AI answer engines.`,
      url: pageUrl,
      details: {
        score: aeo.score,
        h1Count: aeo.h1Count,
        h2Count: aeo.h2Count,
        hasInvertedPyramidSnippet: aeo.hasInvertedPyramidSnippet,
        tableCount: aeo.tableCount,
        hasFaqSchema: aeo.hasFaqSchema,
        recommendations: aeo.recommendations,
      },
    });
  }

  if (!aeo.hasInvertedPyramidSnippet) {
    issues.push({
      id: "aeo_no_definition_snippet",
      name: "Missing direct-answer paragraph",
      severity: "Notice",
      category: "AEO",
      message:
        "No 40–55 word declarative definition paragraph detected directly after an H1/H2. AI engines extract these as featured-answer snippets.",
      url: pageUrl,
    });
  }

  return { issues };
}
