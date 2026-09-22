/**
 * Reputation score, model 1.1.
 *
 * Faithful port of BeyondSEO `src/beyondseo/reputation.py` (`source_score`,
 * `assess`). Conservative by design:
 *
 * - Unknown rubric dimensions earn no supported points; they only widen the
 *   sensitivity range. An observed link with no review is 40 supported points
 *   with a possible range of 40-100, never a strong-authority verdict.
 * - The headline uses the *weakest measured evidence factor*, so checking only
 *   a favourable subset of sources cannot imply complete evidence.
 * - Low-confidence headlines are capped at 49/100. No conclusive link checks
 *   withholds the headline entirely.
 *
 * Deterministic: a pure function of verification evidence and review judgments.
 */

import { host, publisherKey } from "./verify.js";
import { normalizeUrl } from "../crawl/queue.js";
import type {
  AssessOptions,
  CheckSourcesResult,
  Confidence,
  DiscoveryMeta,
  Relationship,
  Relevance,
  Context,
  ReputationResult,
  ScoreStatus,
  SourceAssessment,
  TargetLink,
  VerificationResult,
} from "./types.js";

const MODEL_VERSION = "1.1";
const LOW_CONFIDENCE_CEILING = 49.0;
const RELEVANCE: Record<string, number> = { high: 25, medium: 15, low: 5 };
const RELATIONSHIP: Record<string, number> = {
  independent: 20,
  third_party_profile: 10,
  affiliated: 5,
  owned: 0,
};
const CONTEXT: Record<string, number> = { editorial: 15, directory: 10, user_generated: 5, owned: 0 };

export interface SourceScoreInput {
  source_url: string;
  final_url: string | null;
  verification?: VerificationResult["verification"];
  target_links: TargetLink[];
  brand_mentions: unknown[];
  mention_status?: string;
  missing_content_candidate?: boolean;
  error?: string;
  representation?: string;
  discovery?: DiscoveryMeta;
}

function isReviewed(meta: DiscoveryMeta): boolean {
  return Boolean(
    String(meta.reviewed_by ?? "").trim() &&
      String(meta.reviewed_at ?? "").trim() &&
      String(meta.review_evidence ?? "").trim(),
  );
}

/** Normalize a related-host value: accept a bare hostname or a full URL. */
function normalizeRelatedHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

/** Score one source under the model-1.1 rubric. */
export function sourceScore(
  row: SourceScoreInput,
  target: string,
  relatedHosts: readonly string[] = [],
): SourceAssessment {
  const finalUrl = row.final_url ?? row.source_url;
  const finalHost = host(finalUrl);
  const targetHost = host(target);
  const sameSite = finalHost === targetHost || finalHost.endsWith(`.${targetHost}`);

  const verifiedTargetLinks = row.target_links.filter((link) => host(link.url) === targetHost);
  let observedLink = row.verification === "link_observed" && verifiedTargetLinks.length > 0;
  const observedMention =
    row.brand_mentions.length > 0 && row.mention_status === "observed_in_page";
  observedLink = observedLink && !sameSite;

  const eligible =
    (observedLink || observedMention) && !row.missing_content_candidate && !sameSite;

  // Judgments require an attributable review note; unknown is an interval,
  // never silently a bad quality verdict.
  const meta = row.discovery ?? {};
  const reviewed = isReviewed(meta);
  let relationship: Relationship = reviewed ? ((meta.relationship as Relationship) ?? "unknown") : "unknown";
  const related = [
    targetHost,
    ...relatedHosts.map(normalizeRelatedHost).filter((h) => h.length > 0),
  ];
  if (related.some((h) => finalHost === h || finalHost.endsWith(`.${h}`))) {
    relationship = "owned";
  }
  const relevance: Relevance = reviewed ? ((meta.relevance as Relevance) ?? "unknown") : "unknown";
  const context: Context = reviewed ? ((meta.context as Context) ?? "unknown") : "unknown";

  const rels = new Set<string>();
  for (const link of verifiedTargetLinks) for (const r of link.rel) rels.add(r.toLowerCase());
  const sponsored =
    rels.has("sponsored") || ["true", "yes"].includes(String(meta.paid ?? "").toLowerCase());

  const points: Record<string, [number | null, number]> = {
    observed_evidence: [observedLink ? 40 : observedMention ? 25 : 0, 40],
    topic_relevance: [RELEVANCE[relevance] ?? null, 25],
    relationship: [RELATIONSHIP[relationship] ?? null, 20],
    context: [CONTEXT[context] ?? null, 15],
  };
  if (sponsored) {
    points.relationship = [0, 20];
    relationship = "sponsored";
  }

  const known = Object.values(points).filter((p) => p[0] !== null) as [number, number][];
  const low = known.reduce((sum, p) => sum + p[0], 0);
  const unknownMaxima = Object.values(points)
    .filter((p) => p[0] === null)
    .reduce((sum, p) => sum + p[1], 0);
  const high = low + unknownMaxima;
  const assessed = known.reduce((sum, p) => sum + p[1], 0);

  return {
    source_url: row.source_url,
    final_url: row.final_url,
    publisher_group: publisherKey(finalUrl),
    eligible_evidence: eligible,
    excluded_reason: sameSite ? "same_site_source" : "",
    observed_link: observedLink,
    observed_mention: observedMention && !sameSite,
    quality_estimate: eligible ? round((low + high) / 2) : null,
    supported_quality_points: eligible ? low : null,
    quality_range: eligible ? [low, high] : null,
    assessed_weight_percent: eligible ? assessed : 0,
    relationship,
    context,
    relevance,
    independent_editorial_evidence:
      eligible && relationship === "independent" && context === "editorial" && !sponsored,
    independence_unknown:
      eligible &&
      (relationship === "unknown" || relationship === "independent") &&
      (context === "unknown" || context === "editorial") &&
      !(relationship === "independent" && context === "editorial"),
    dimensions: Object.fromEntries(
      Object.entries(points).map(([k, [v, m]]) => [
        k,
        { points: v, maximum: m, status: v === null ? "unknown" : "assessed" },
      ]),
    ),
    review_attribution: {
      reviewed_by: meta.reviewed_by,
      reviewed_at: meta.reviewed_at,
      review_evidence: meta.review_evidence,
    },
    verification: row.verification ?? null,
    representation: (row.representation as SourceAssessment["representation"]) ?? "not_captured",
    target_links: verifiedTargetLinks,
    brand_mentions: row.brand_mentions as SourceAssessment["brand_mentions"],
    discovery: meta,
    access_error: row.error ?? "",
  };
}

/**
 * Assess a full verification sample: group by publisher, rank, and compute the
 * supported score, evidence adjustment, confidence and coverage. Ports `assess`.
 */
export function assess(
  verification: CheckSourcesResult,
  options: AssessOptions = {},
): ReputationResult {
  const relatedHosts = options.relatedHosts ?? [];
  const requestedSearchPages = options.requestedSearchPages ?? 5;
  if (!(requestedSearchPages >= 1 && requestedSearchPages <= 20)) {
    throw new Error("Search-page budget must be between 1 and 20.");
  }

  // Imported evidence may repeat a source. Repetition must not improve coverage.
  const unique = new Map<string, VerificationResult>();
  for (const row of verification.results) {
    const key = normalizeUrl(row.source_url) || row.source_url;
    if (!unique.has(key)) unique.set(key, row);
  }
  const duplicates = verification.results.length - unique.size;
  const deduped: CheckSourcesResult = {
    ...verification,
    results: [...unique.values()],
  };

  const scored = deduped.results.map((r) =>
    sourceScore(
      {
        source_url: r.source_url,
        final_url: r.final_url,
        verification: r.verification,
        target_links: r.target_links,
        brand_mentions: r.brand_mentions,
        mention_status: r.mention_status,
        missing_content_candidate: r.missing_content_candidate,
        error: r.error,
        representation: r.representation,
        discovery: r.discovery,
      },
      verification.target,
      relatedHosts,
    ),
  );

  // Group by publisher, keeping the strongest source per group.
  const groups = new Map<string, SourceAssessment>();
  for (const row of scored) {
    if (!row.eligible_evidence) continue;
    const key = row.publisher_group;
    if (!groups.has(key) || (row.quality_estimate ?? 0) > (groups.get(key)!.quality_estimate ?? 0)) {
      groups.set(key, row);
    }
  }
  const ranked = [...groups.values()].sort(byQualityThenUrl);
  const top = ranked.slice(0, 5);

  const readable = deduped.results.filter((r) =>
    ["link_observed", "no_link_in_captured_content"].includes(r.verification),
  ).length;

  const searchPages = new Set<string>();
  for (const row of scored) {
    const observations = [row.discovery, ...(row.discovery.provenance ?? [])];
    for (const observation of observations) {
      if (!observation || typeof observation !== "object") continue;
      const engine = String(observation.engine ?? observation.provider ?? "");
      const query = String(observation.query ?? "");
      const page = String(observation.search_page ?? "");
      const date = String(observation.observed_at ?? observation.captured_at ?? "");
      if (engine && query && page && date) {
        searchPages.add(`${engine}\u0000${query}\u0000${page}`);
      }
    }
  }

  const independentlyReviewed = ranked.filter((r) => r.independent_editorial_evidence).length;
  const unknownIndependence = ranked.filter((r) => r.independence_unknown).length;

  const breadth = 25 * Math.min(groups.size / 5, 1);
  const independentLow = 15 * Math.min(independentlyReviewed / 3, 1);
  const independentHigh = 15 * Math.min((independentlyReviewed + unknownIndependence) / 3, 1);

  let estimate: number | null;
  let scoreRange: [number, number] | null;
  if (top.length > 0) {
    const low =
      (0.6 * top.reduce((sum, r) => sum + (r.quality_range?.[0] ?? 0), 0)) / top.length +
      breadth +
      independentLow;
    const high =
      (0.6 * top.reduce((sum, r) => sum + (r.quality_range?.[1] ?? 0), 0)) / top.length +
      breadth +
      independentHigh;
    scoreRange = [round(low), round(high)];
    estimate = round((low + high) / 2);
  } else if (readable > 0) {
    estimate = 0.0;
    scoreRange = [0.0, 0.0];
  } else {
    estimate = null;
    scoreRange = null;
  }

  const checked = scored.length;
  const captureFraction = checked > 0 ? readable / checked : 0;
  const supplied = verification.sources_supplied ?? checked;
  const remaining = verification.sources_remaining ?? 0;
  const candidateCount = Math.max(
    checked,
    typeof supplied === "number" ? supplied : checked,
    checked + (typeof remaining === "number" && remaining > 0 ? remaining : 0),
  );
  const verificationFraction = candidateCount > 0 ? readable / candidateCount : 0;
  const reviewedWeight =
    top.length > 0 ? top.reduce((sum, r) => sum + r.assessed_weight_percent, 0) / top.length : 0;
  const searchCoverage =
    searchPages.size > 0 ? Math.min(searchPages.size / requestedSearchPages, 1) : null;

  const factors: Record<string, number | null> = {
    conclusive_link_checks: round(verificationFraction, 6),
    reviewed_source_dimensions: round(reviewedWeight / 100, 6),
    publisher_breadth: round(Math.min(groups.size / 5, 1), 6),
    search_page_coverage: searchCoverage === null ? null : round(searchCoverage, 6),
  };
  const support = Math.min(...Object.values(factors).filter((v): v is number => v !== null));

  let confidence: Confidence;
  if (
    groups.size >= 5 &&
    verificationFraction >= 0.8 &&
    reviewedWeight >= 80 &&
    searchCoverage === 1
  ) {
    confidence = "moderate within this sample";
  } else {
    confidence = "low";
  }
  const ceiling = confidence === "moderate within this sample" ? 100.0 : LOW_CONFIDENCE_CEILING;

  const sampleEstimate = estimate;
  const sampleRange = scoreRange;
  let status: ScoreStatus;
  if (sampleRange === null || readable === 0) {
    estimate = null;
    scoreRange = null;
    confidence = "insufficient conclusive evidence";
    status = "withheld";
  } else {
    // Unknown quality earns no headline points. Missing evidence reduces
    // supported assurance without declaring unread sources poor quality.
    estimate = round(Math.min(sampleRange[0] * support, ceiling));
    scoreRange = [estimate, round(Math.min(sampleRange[1] * support, ceiling))];
    status = confidence === "low" ? "provisional" : "assessed_within_sample";
  }

  return {
    name: "SEOForge Reputation Score",
    model_version: MODEL_VERSION,
    target: verification.target,
    brand: verification.brand,
    checked_at: verification.checked_at,
    assessment_type: "evidence-supported_sample_score",
    score: estimate,
    score_range: scoreRange,
    score_status: status,
    confidence,
    sample_quality_estimate: sampleEstimate,
    sample_quality_range: sampleRange,
    range_meaning:
      "The headline uses supported lower-bound points after evidence adjustment, not the midpoint. The range varies unassessed rubric dimensions at the same coverage and ceiling; it is not a statistical confidence interval or an estimate of unseen web evidence.",
    evidence_adjustment: {
      factor: round(support, 6),
      factors,
      confidence_ceiling: ceiling,
      limiting_factors: Object.entries(factors)
        .filter(([, v]) => v === null || v < 1)
        .map(([k]) => k),
      policy:
        "Use the weakest measured evidence factor. Unknown search coverage keeps confidence low. Low-confidence headlines are capped at 49/100 for every site; no conclusive checks withholds the headline.",
    },
    coverage: {
      sources_checked: checked,
      known_source_candidates: candidateCount,
      sources_unchecked: candidateCount - checked,
      duplicate_source_rows_ignored: duplicates,
      conclusive_link_checks: readable,
      conclusive_link_check_fraction: round(captureFraction, 3),
      partial_or_unverified_link_checks: checked - readable,
      sources_with_positive_evidence: scored.filter((r) => r.eligible_evidence).length,
      requested_search_pages: requestedSearchPages,
      recorded_search_pages: [...searchPages].map((key) => {
        const [engine, query, page] = key.split("\u0000");
        return { engine, query, page };
      }),
      search_page_count_is_imported_provenance: true,
      unique_publisher_groups_with_evidence: groups.size,
      assessed_weight_of_selected_sources_percent: round(reviewedWeight, 1),
    },
    observed_link_pages: scored.filter((r) => r.observed_link).length,
    observed_mention_pages: scored.filter((r) => r.observed_mention).length,
    independent_editorial_publisher_groups: independentlyReviewed,
    estimated_total_backlinks: null,
    total_backlinks_note:
      "No defensible whole-web total can be extrapolated from a ranked search sample. Counts below cover observed sources only.",
    formula:
      "Supported sample points = 60% mean lower-bound source quality of the strongest five publisher groups + up to 25 points for five groups + up to 15 for three reviewed independent editorial groups. Headline = supported sample points × weakest evidence factor, capped at 49 when confidence is low.",
    components: {
      breadth_points: round(breadth, 1),
      independent_proof_points_range: [round(independentLow, 1), round(independentHigh, 1)],
    },
    top_backlinks: scored.filter((r) => r.observed_link).sort(byEvidenceThenUrl).slice(0, 10),
    top_mentions_without_links: scored
      .filter((r) => r.observed_mention && !r.observed_link)
      .sort(byEvidenceThenUrl)
      .slice(0, 10),
    sources: scored,
    limitations: [
      "Search snippets are discovery hints, not verified backlinks.",
      "Search results are a biased and incomplete sample; position is not used as source authority.",
      "Unknown dimensions remain unknown and widen the range.",
      "The score measures supported evidence under a conservative rubric. Missing access reduces assurance; it does not prove a site's reputation is poor.",
      "The same rules apply to every brand. Search sampling and reviewer judgments can still be biased; this is not a statistically unbiased ranking model.",
      "Related/owned sources do not count as independent editorial proof.",
      "nofollow, ugc and sponsored values are recorded; none proves how an engine values the link.",
      "Host/platform grouping is conservative and not a complete ownership or registrable-domain database.",
      "The score does not measure sentiment, customer satisfaction, site traffic or future search ranking.",
      "An incomplete link check may still contain an observed mention. Positive evidence is retained; incomplete capture cannot establish link absence.",
    ],
    evidence_source: "verification",
    reused_evidence: false,
  };
}

/** Re-assess already-captured evidence without another network request. */
export function reassess(
  verification: CheckSourcesResult,
  options: AssessOptions = {},
): ReputationResult {
  const result = assess(verification, options);
  result.evidence_source = "verification/backlinks.json";
  result.reused_evidence = true;
  return result;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Rank by descending diagnostic quality, then ascending URL (Python sort key). */
function byQualityThenUrl(a: SourceAssessment, b: SourceAssessment): number {
  const diff = (b.quality_estimate ?? 0) - (a.quality_estimate ?? 0);
  if (diff !== 0) return diff;
  if (a.source_url < b.source_url) return -1;
  if (a.source_url > b.source_url) return 1;
  return 0;
}

/** Rank by descending supported points, then assessed weight, then ascending URL. */
function byEvidenceThenUrl(a: SourceAssessment, b: SourceAssessment): number {
  const byPoints = (b.supported_quality_points ?? 0) - (a.supported_quality_points ?? 0);
  if (byPoints !== 0) return byPoints;
  const byWeight = b.assessed_weight_percent - a.assessed_weight_percent;
  if (byWeight !== 0) return byWeight;
  if (a.source_url < b.source_url) return -1;
  if (a.source_url > b.source_url) return 1;
  return 0;
}
