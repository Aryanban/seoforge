/**
 * Competitor gap analysis.
 *
 * Inspired by BeyondSEO's competitor-research playbooks (competitor matrix,
 * content-gap and authority-gap analysis), but implemented natively on
 * SEOForge's own crawl evidence: instead of scraped SERPs, it compares the
 * metrics SEOForge already measures (AEO, issue counts, schema coverage,
 * internal-link strength, content depth) across crawl results.
 *
 * Deterministic: a pure function of CrawlResult objects. Comparable sites must
 * be crawled with a similar budget — the report always discloses the budget so
 * an uneven sample cannot masquerade as a ranking verdict.
 */

import type { CrawlResult, IssueSummary, PageAuditResult } from "../types.js";

/** A single comparable metric row in the gap matrix. */
export interface CompetitorMetric {
  key: string;
  label: string;
  /** "higher" is better, or "lower" is better. */
  direction: "higher" | "lower";
  baseline: number | null;
  competitors: (number | null)[];
  unit: string;
  /** Short explanation of what the number does and does not prove. */
  note: string;
}

/** One prioritized gap between the baseline site and a competitor. */
export interface CompetitorGap {
  metric: string;
  label: string;
  competitor: string;
  competitorValue: number | null;
  baselineValue: number | null;
  /** Positive = baseline is behind by this much. */
  shortfall: number | null;
  severity: "Warning" | "Notice";
  recommendation: string;
}

export interface CompetitorComparison {
  baselineUrl: string;
  baselineCrawlId: string;
  competitorUrls: string[];
  competitorCrawlIds: string[];
  baselineBudget: number;
  competitorBudgets: number[];
  budgetComparable: boolean;
  metrics: CompetitorMetric[];
  gaps: CompetitorGap[];
  /** Metrics where the baseline leads every competitor. */
  strengths: string[];
  summary: string;
  limitations: string[];
}

function avg(values: number[]): number | null {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length === 0) return null;
  return usable.reduce((sum, v) => sum + v, 0) / usable.length;
}

function pagesOf(crawl: CrawlResult): PageAuditResult[] {
  return (crawl.pages ?? []).filter((p) => p.status > 0);
}

/** Schema.org coverage: share of crawled pages carrying at least one JSON-LD type. */
function schemaCoverage(crawl: CrawlResult): number | null {
  const pages = pagesOf(crawl);
  if (pages.length === 0) return null;
  return (pages.filter((p) => (p.schema?.typesFound?.length ?? 0) > 0).length / pages.length) * 100;
}

/** Share of crawled pages that are indexable and not blocked by robots. */
function indexableRate(crawl: CrawlResult): number | null {
  const pages = pagesOf(crawl);
  if (pages.length === 0) return null;
  return (pages.filter((p) => p.isIndexable && !p.blockedByRobots).length / pages.length) * 100;
}

/** Share of pages served over HTTPS. */
function httpsRate(crawl: CrawlResult): number | null {
  const pages = pagesOf(crawl);
  if (pages.length === 0) return null;
  return (pages.filter((p) => p.finalUrl?.startsWith("https://") ?? p.url.startsWith("https://")).length / pages.length) * 100;
}

function avgWordCount(crawl: CrawlResult): number | null {
  return avg(pagesOf(crawl).map((p) => p.wordCount ?? 0));
}

function brokenLinkCount(crawl: CrawlResult): number {
  return (crawl.links ?? []).filter((l) => l.isBroken).length;
}

function avgTitleLength(crawl: CrawlResult): number | null {
  return avg(pagesOf(crawl).map((p) => p.titleLength ?? 0));
}

function avgDescriptionLength(crawl: CrawlResult): number | null {
  return avg(pagesOf(crawl).map((p) => p.descriptionLength ?? 0));
}

function avgInternalLinkScore(crawl: CrawlResult): number | null {
  return avg(pagesOf(crawl).map((p) => p.internalLinkScore ?? 0));
}

function issueCount(summaries: IssueSummary[], severity: string): number {
  return summaries.filter((s) => s.severity === severity).reduce((sum, s) => sum + s.affectedPages, 0);
}

const METRIC_NOTES: Record<string, string> = {
  aeo: "AEO score measures answer-readiness signals on the crawled pages only; it is not an AI-citation prediction.",
  errors: "Errors block indexing or access on the crawled sample; a smaller budget can hide problems elsewhere.",
  warnings: "Warnings weaken rankings; compare only against sites crawled with a similar budget.",
  wordCount: "Depth is not quality; thin-but-useful pages can outrank long ones. Use as a directional signal.",
  schema: "Schema presence is not the same as schema correctness; check for validation errors separately.",
  indexable: "Indexability of the crawled sample; pages not crawled are not covered.",
  broken: "Broken links found from the crawled sample; a whole-site total needs a full crawl.",
  https: "HTTPS availability across the crawled sample.",
  titleLength: "Average title length in characters; 50-60 is a common target, not a rule.",
  descLength: "Average meta description length; 120-160 characters is a common target.",
  internalLinkScore: "Internal-link strength from SEOForge's PageRank-style pass; higher means better-connected pages.",
};

/**
 * Compare a baseline crawl against competitor crawls. All inputs must be
 * completed crawls of the sites in question.
 */
export function compareCompetitors(
  baseline: CrawlResult,
  competitors: CrawlResult[],
): CompetitorComparison {
  if (!competitors || competitors.length === 0) {
    throw new Error("Provide at least one competitor crawl result to compare against.");
  }
  if (competitors.length > 5) {
    throw new Error("Compare at most five competitors so the sample stays evidence-matched.");
  }

  const baselinePages = pagesOf(baseline).length;
  const baselineBudget = baseline.options?.limit ?? baseline.totalUrlsCrawled ?? baselinePages;
  const competitorBudgets = competitors.map(
    (c) => c.options?.limit ?? c.totalUrlsCrawled ?? pagesOf(c).length,
  );
  // Budgets are treated as comparable when they are within 25% of each other.
  const minBudget = Math.min(baselineBudget, ...competitorBudgets);
  const maxBudget = Math.max(baselineBudget, ...competitorBudgets);
  const budgetComparable = maxBudget === 0 || minBudget / maxBudget >= 0.75;

  const round = (v: number | null): number | null =>
    v === null ? null : Math.round(v * 10) / 10;

  const metricDefs: Array<{
    key: string;
    label: string;
    direction: "higher" | "lower";
    unit: string;
    compute: (c: CrawlResult) => number | null;
  }> = [
    { key: "aeo", label: "Average AEO score", direction: "higher", unit: "/100", compute: (c) => c.averageAeoScore ?? null },
    { key: "errors", label: "Errors (affected pages)", direction: "lower", unit: " pages", compute: (c) => issueCount(c.issuesSummary ?? [], "Error") },
    { key: "warnings", label: "Warnings (affected pages)", direction: "lower", unit: " pages", compute: (c) => issueCount(c.issuesSummary ?? [], "Warning") },
    { key: "wordCount", label: "Average word count", direction: "higher", unit: " words", compute: avgWordCount },
    { key: "schema", label: "Schema.org coverage", direction: "higher", unit: "%", compute: schemaCoverage },
    { key: "indexable", label: "Indexable pages", direction: "higher", unit: "%", compute: indexableRate },
    { key: "https", label: "HTTPS pages", direction: "higher", unit: "%", compute: httpsRate },
    { key: "broken", label: "Broken links", direction: "lower", unit: " links", compute: brokenLinkCount },
    { key: "titleLength", label: "Average title length", direction: "higher", unit: " chars", compute: avgTitleLength },
    { key: "descLength", label: "Average meta description length", direction: "higher", unit: " chars", compute: avgDescriptionLength },
    { key: "internalLinkScore", label: "Average internal-link score", direction: "higher", unit: "/100", compute: avgInternalLinkScore },
  ];

  const metrics: CompetitorMetric[] = metricDefs.map((def) => {
    const baselineValue = round(def.compute(baseline));
    return {
      key: def.key,
      label: def.label,
      direction: def.direction,
      baseline: baselineValue,
      competitors: competitors.map((c) => round(def.compute(c))),
      unit: def.unit,
      note: METRIC_NOTES[def.key] ?? "",
    };
  });

  const competitorUrl = (c: CrawlResult): string => c.domainName ?? c.targetUrl;
  const gaps: CompetitorGap[] = [];
  const strengths: string[] = [];
  for (const metric of metrics) {
    const baselineValue = metric.baseline;
    if (baselineValue === null) continue;
    let worstShortfall: number | null = null;
    let worstCompetitor: CompetitorComparison["competitorUrls"][number] | null = null;
    let worstValue: number | null = null;
    let baselineLeadsAll = true;
    metric.competitors.forEach((value, i) => {
      if (value === null) {
        baselineLeadsAll = false;
        return;
      }
      if (metric.direction === "higher") {
        if (value > baselineValue) {
          const shortfall = value - baselineValue;
          if (worstShortfall === null || shortfall > worstShortfall) {
            worstShortfall = shortfall;
            worstCompetitor = competitorUrl(competitors[i]);
            worstValue = value;
          }
        }
        if (value >= baselineValue) baselineLeadsAll = false;
      } else {
        if (value < baselineValue) {
          const shortfall = baselineValue - value;
          if (worstShortfall === null || shortfall > worstShortfall) {
            worstShortfall = shortfall;
            worstCompetitor = competitorUrl(competitors[i]);
            worstValue = value;
          }
        }
        if (value <= baselineValue) baselineLeadsAll = false;
      }
    });
    if (baselineLeadsAll) strengths.push(metric.label);
    if (worstShortfall !== null && worstCompetitor !== null) {
      gaps.push({
        metric: metric.key,
        label: metric.label,
        competitor: worstCompetitor,
        competitorValue: worstValue,
        baselineValue: metric.baseline,
        shortfall: round(worstShortfall),
        severity: metric.key === "aeo" || metric.key === "errors" ? "Warning" : "Notice",
        recommendation: gapRecommendation(metric.key, metric.direction),
      });
    }
  }

  gaps.sort((a, b) => (a.severity === "Warning" ? -1 : 1) - (b.severity === "Warning" ? -1 : 1));

  return {
    baselineUrl: competitorUrl(baseline),
    baselineCrawlId: baseline.id,
    competitorUrls: competitors.map(competitorUrl),
    competitorCrawlIds: competitors.map((c) => c.id),
    baselineBudget,
    competitorBudgets,
    budgetComparable,
    metrics,
    gaps,
    strengths,
    summary: buildSummary(baseline, gaps.length, strengths.length, budgetComparable),
    limitations: [
      "Comparison covers only the pages each crawl actually visited; uncrawled pages are not covered.",
      budgetComparable
        ? `Crawl budgets are comparable (baseline ${baselineBudget}, competitors ${competitorBudgets.join(", ")}).`
        : `Crawl budgets are NOT comparable (baseline ${baselineBudget}, competitors ${competitorBudgets.join(", ")}); treat differences as sampling artifacts, not performance gaps.`,
      "Metrics are measured signals from a crawl, not search rankings, traffic or AI-citation counts.",
      "A gap is an opportunity to investigate, not proof that copying a competitor will rank.",
      "The same rules apply to the baseline and every competitor; do not declare a numerical winner on uneven evidence.",
    ],
  };
}

function gapRecommendation(key: string, direction: "higher" | "lower"): string {
  const leadsHigher = direction === "higher";
  switch (key) {
    case "aeo":
      return "Strengthen answer-readiness on the flagged pages: lead with a direct answer paragraph, add FAQ schema, and front-load the key facts. Re-crawl to confirm the score moves.";
    case "errors":
      return "Fix the indexing/access errors first: broken links, redirects, noindex and non-200 pages block the rest of the work from compounding.";
    case "warnings":
      return "Work through the warning groupings with the largest affected-page counts; these are usually a shared template, so one fix resolves many pages.";
    case "wordCount":
      return "Investigate whether the competitor's pages answer questions yours don't; add genuinely useful depth rather than padding word counts.";
    case "schema":
      return "Add validated schema.org JSON-LD for the page type on pages that lack it, then re-check for rich-results errors.";
    case "indexable":
      return "Find pages blocked by robots or noindex that should be indexed, and remove the blocking signal where it is unintended.";
    case "https":
      return "Serve every crawled page over HTTPS and redirect the HTTP versions.";
    case "broken":
      return "Fix or remove the broken internal and external links found from the crawled sample.";
    case "titleLength":
      return leadsHigher ? "Lengthen under-short titles so they carry the target intent within ~60 characters." : "Shorten over-long titles so they are not truncated in results.";
    case "descLength":
      return leadsHigher ? "Add meta descriptions to pages missing them and lengthen very short ones toward ~150 characters." : "Shorten meta descriptions that exceed ~160 characters so they are not cut off.";
    case "internalLinkScore":
      return "Strengthen internal linking to important pages: add contextual links from high-traffic pages and reduce orphaned pages.";
    default:
      return "Investigate the underlying pages behind this metric and close the gap, then re-crawl to verify.";
  }
}

function buildSummary(
  baseline: CrawlResult,
  gapCount: number,
  strengthCount: number,
  budgetComparable: boolean,
): string {
  const site = baseline.domainName ?? baseline.targetUrl;
  const lines = [
    `Compared ${site} against its competitors on the evidence of the crawls supplied.`,
    `${gapCount} metric${gapCount === 1 ? "" : "s"} where a competitor leads; ${strengthCount} where ${site} leads every competitor.`,
  ];
  if (!budgetComparable) {
    lines.push(
      "The crawl budgets differ materially, so some differences are sampling artifacts rather than real performance gaps.",
    );
  }
  lines.push(
    "This is measured on-site evidence, not a ranking: use it to decide what to investigate next.",
  );
  return lines.join(" ");
}

/** Render a comparison as a markdown gap matrix plus prioritized opportunities. */
export function comparisonMarkdown(comparison: CompetitorComparison): string {
  const header = [
    "Metric",
    comparison.baselineUrl,
    ...comparison.competitorUrls,
    "Better",
  ];
  const lines = [
    `# Competitor gap analysis: ${comparison.baselineUrl}`,
    "",
    comparison.summary,
    "",
    "## Metric matrix",
    "",
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
  ];
  for (const m of comparison.metrics) {
    const fmt = (v: number | null): string =>
      v === null ? "n/a" : `${v}${pluralize(v, m.unit)}`;
    const all = [m.baseline, ...m.competitors];
    const best =
      m.direction === "higher"
        ? all.filter((v): v is number => v !== null).length > 0
          ? Math.max(...all.filter((v): v is number => v !== null))
          : null
        : all.filter((v): v is number => v !== null).length > 0
          ? Math.min(...all.filter((v): v is number => v !== null))
          : null;
    lines.push(
      `| ${m.label} | ${fmt(m.baseline)} | ${m.competitors.map(fmt).join(" | ")} | ${
        m.direction === "higher" ? "higher" : "lower"
      }${best !== null ? ` (best ${fmt(best)})` : ""} |`,
    );
  }

  if (comparison.strengths.length > 0) {
    lines.push("", "## Where the baseline leads", "", ...comparison.strengths.map((s) => `- ${s}`));
  }

  if (comparison.gaps.length > 0) {
    lines.push("", "## Prioritized gaps to investigate", "");
    comparison.gaps.forEach((gap, i) => {
      lines.push(
        `### ${i + 1}. ${gap.label} — behind ${gap.competitor}`,
        "",
        `- Baseline: ${gap.baselineValue}${unitFor(comparison, gap.metric)}`,
        `- Competitor best: ${gap.competitorValue}${unitFor(comparison, gap.metric)}`,
        `- Shortfall: ${gap.shortfall}${unitFor(comparison, gap.metric)} (${gap.severity})`,
        "",
        gap.recommendation,
        "",
      );
    });
  } else {
    lines.push("", "No metric gaps were found — the baseline leads or matches on every measure.", "");
  }

  lines.push("## Limits", "", ...comparison.limitations.map((s) => `- ${s}`));
  return lines.join("\n") + "\n";
}

function unitFor(comparison: CompetitorComparison, key: string): string {
  return comparison.metrics.find((m) => m.key === key)?.unit ?? "";
}

/** Singularize a unit prefix at exactly one (" pages" -> " page"). */
function pluralize(value: number, unit: string): string {
  if (Math.abs(value) === 1 && unit.startsWith(" ")) {
    const trimmed = unit.trim();
    return ` ${trimmed.endsWith("s") ? trimmed.slice(0, -1) : trimmed}`;
  }
  return unit;
}
