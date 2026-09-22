/**
 * Reputation report export: markdown summary + per-source CSV.
 *
 * Ported from BeyondSEO `src/beyondseo/reputation.py` (`export_assessment`).
 * The report always shows score, range, confidence and coverage together, and
 * keeps observed links, mentions-without-links and unreadable candidates
 * visually distinct.
 */

import type { ReputationResult, SourceAssessment } from "./types.js";

const REPUTATION_CSV_FIELDS: readonly (keyof SourceAssessment)[] = [
  "source_url",
  "final_url",
  "publisher_group",
  "verification",
  "observed_link",
  "observed_mention",
  "quality_estimate",
  "supported_quality_points",
  "quality_range",
  "assessed_weight_percent",
  "relationship",
  "context",
  "relevance",
  "representation",
  "access_error",
  "target_links",
] as const;

function csvCell(value: unknown): string {
  let s: string;
  if (Array.isArray(value)) s = value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(" ; ");
  else if (value === null || value === undefined) s = "";
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Render the per-source CSV companion to a reputation report. */
export function reputationCsv(result: ReputationResult): string {
  const header = REPUTATION_CSV_FIELDS.join(",");
  const rows = result.sources.map((source) =>
    REPUTATION_CSV_FIELDS.map((field) => csvCell(source[field])).join(","),
  );
  return [header, ...rows].join("\r\n") + "\r\n";
}

/**
 * Render a reputation report as markdown. The headline is never shown without
 * its confidence, range and coverage context.
 */
export function reputationMarkdown(result: ReputationResult): string {
  const score = result.score === null ? "withheld" : `${result.score}`;
  const range = result.score_range === null ? "withheld" : `[${result.score_range.join(", ")}]`;
  const lines = [
    "# SEOForge Reputation Score",
    "",
    "**Conservative score for the evidence we could establish.**",
    "",
    `Evidence-supported score: ${score} / 100 — ${result.score_status}.`,
    `Sensitivity range: ${range}; confidence: ${result.confidence}.`,
    "",
    result.range_meaning,
    "",
    `Observed links: ${result.observed_link_pages} source pages. Observed brand mentions: ${result.observed_mention_pages} pages (may overlap links).`,
    `Checked ${result.coverage.sources_checked} sources: ${result.coverage.conclusive_link_checks} conclusive link checks; ${result.coverage.partial_or_unverified_link_checks} incomplete or unverified. Positive evidence was captured on ${result.coverage.sources_with_positive_evidence} pages, including any partial captures.`,
    `Known source candidates: ${result.coverage.known_source_candidates}; not yet checked: ${result.coverage.sources_unchecked}. Unchecked known candidates remain in the verification-coverage denominator.`,
    `Requested search pages: ${result.coverage.requested_search_pages}; recorded pages: ${result.coverage.recorded_search_pages.length}. Requested pages are not treated as completed searches.`,
    "",
    result.total_backlinks_note,
    "",
    "## How the score is calculated",
    "",
    result.formula,
    "",
    `Evidence factor: ${result.evidence_adjustment.factor}; confidence ceiling: ${result.evidence_adjustment.confidence_ceiling}/100. Limits: ${result.evidence_adjustment.limiting_factors.join(", ") || "none within the recorded sample"}.`,
    "",
    `Diagnostic sample quality before evidence adjustment: ${result.sample_quality_estimate}, range ${result.sample_quality_range}. This is not the headline score or an overall site rating.`,
    "",
    "## Strongest observed backlink pages",
    "",
  ];
  lines.push(
    ...result.top_backlinks.map(
      (r) =>
        `- ${r.source_url} — supported source-quality points ${r.supported_quality_points}/100; possible rubric range ${r.quality_range}; ${r.relationship}; ${r.representation}.`,
    ),
  );
  if (result.top_backlinks.length === 0) {
    lines.push("No direct backlinks were established in this sample.");
  }
  lines.push("", "## Mentions without an observed link", "");
  lines.push(
    ...result.top_mentions_without_links.map(
      (r) => `- ${r.source_url} — mention observed in captured content; no direct link captured.`,
    ),
  );
  lines.push(
    "",
    "## Practical next steps",
    "",
    "- Resolve unread sources before interpreting their absence.",
    "- Review unknown relevance, relationship and publication context with dated evidence.",
    "- Improve factual profiles and seek genuine project references; prioritize useful independent proof.",
    "- Compare future snapshots using the same discovery method and query/locale; changed sampling can change the score.",
    "",
    "## Limits",
    "",
    ...result.limitations.map((s) => `- ${s}`),
  );
  return lines.join("\n") + "\n";
}
