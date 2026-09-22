/**
 * Reputation assessment types.
 *
 * Ported from BeyondSEO `src/beyondseo/reputation.py` (model 1.1) and
 * `src/beyondseo/backlinks.py`. The model is deliberately conservative: an
 * unverified URL is a candidate to check, never a backlink "probably done".
 */

export type Verification =
  | "link_observed"
  | "no_link_in_captured_content"
  | "unverified_access";

export type MentionStatus = "observed_in_page" | "not_observed_in_capture" | "unverified";

/** Review judgment on a discovered source. Blank means unknown. */
export type Relevance = "high" | "medium" | "low" | "unknown";
export type Relationship =
  | "independent"
  | "third_party_profile"
  | "affiliated"
  | "owned"
  | "sponsored"
  | "unknown";
export type Context = "editorial" | "directory" | "user_generated" | "owned" | "unknown";

/** Discovery provenance for a source row (operator-supplied). */
export interface DiscoveryMeta {
  engine?: string;
  query?: string;
  search_page?: number | string;
  result_order?: number | string;
  observed_at?: string;
  source_snapshot?: string;
  relevance?: Relevance;
  relationship?: Relationship;
  context?: Context;
  reviewed_by?: string;
  reviewed_at?: string;
  review_evidence?: string;
  paid?: string | boolean;
  provenance?: DiscoveryMeta[];
  [key: string]: unknown;
}

/** Input row: a candidate source URL plus its provenance. */
export interface SourceRow {
  URL: string;
  discovery?: DiscoveryMeta;
  [key: string]: unknown;
}

/** A link found on a source page pointing at the target host. */
export interface TargetLink {
  url: string;
  anchor: string;
  rel: string[];
}

/** A brand name found in the captured text of a source page. */
export interface BrandMention {
  name: string;
  excerpt: string;
}

export type Representation = "raw_html" | "rendered_dom" | "not_captured";

/** Result of verifying one source page. */
export interface VerificationResult {
  source_url: string;
  final_url: string | null;
  status: number;
  checked_at: string;
  verification: Verification;
  representation: Representation;
  coverage_limited: boolean;
  target_links: TargetLink[];
  brand_mentions: BrandMention[];
  mention_status: MentionStatus;
  error: string;
  title: string;
  main_excerpt: string;
  discovery: DiscoveryMeta;
  missing_content_candidate: boolean;
}

/** Output of `checkSources`: raw verification evidence before scoring. */
export interface CheckSourcesResult {
  target: string;
  brand: string;
  checked_at: string;
  sources_supplied: number;
  sources_checked: number;
  sources_remaining: number;
  observed_link_pages: number;
  observed_mention_pages: number;
  unverified_pages: number;
  results: VerificationResult[];
  note: string;
}

/** One dimension of the source-quality rubric. */
export interface ScoreDimension {
  points: number | null;
  maximum: number;
  status: "unknown" | "assessed";
}

/** Scored view of a single verified source. */
export interface SourceAssessment {
  source_url: string;
  final_url: string | null;
  publisher_group: string;
  eligible_evidence: boolean;
  excluded_reason: string;
  observed_link: boolean;
  observed_mention: boolean;
  quality_estimate: number | null;
  supported_quality_points: number | null;
  quality_range: [number, number] | null;
  assessed_weight_percent: number;
  relationship: Relationship;
  context: Context;
  relevance: Relevance;
  independent_editorial_evidence: boolean;
  independence_unknown: boolean;
  dimensions: Record<string, ScoreDimension>;
  review_attribution: { reviewed_by?: string; reviewed_at?: string; review_evidence?: string };
  verification: Verification | null;
  representation: Representation;
  target_links: TargetLink[];
  brand_mentions: BrandMention[];
  discovery: DiscoveryMeta;
  access_error: string;
}

export type ScoreStatus = "withheld" | "provisional" | "assessed_within_sample";
export type Confidence =
  | "low"
  | "moderate within this sample"
  | "insufficient conclusive evidence";

export interface EvidenceAdjustment {
  factor: number;
  factors: Record<string, number | null>;
  confidence_ceiling: number;
  limiting_factors: string[];
  policy: string;
}

export interface ReputationCoverage {
  sources_checked: number;
  known_source_candidates: number;
  sources_unchecked: number;
  duplicate_source_rows_ignored: number;
  conclusive_link_checks: number;
  conclusive_link_check_fraction: number;
  partial_or_unverified_link_checks: number;
  sources_with_positive_evidence: number;
  requested_search_pages: number;
  recorded_search_pages: { engine: string; query: string; page: string }[];
  search_page_count_is_imported_provenance: boolean;
  unique_publisher_groups_with_evidence: number;
  assessed_weight_of_selected_sources_percent: number;
}

/** Full model-1.1 reputation assessment. */
export interface ReputationResult {
  name: string;
  model_version: string;
  target: string;
  brand: string;
  checked_at: string;
  assessment_type: string;
  score: number | null;
  score_range: [number, number] | null;
  score_status: ScoreStatus;
  confidence: Confidence;
  sample_quality_estimate: number | null;
  sample_quality_range: [number, number] | null;
  range_meaning: string;
  evidence_adjustment: EvidenceAdjustment;
  coverage: ReputationCoverage;
  observed_link_pages: number;
  observed_mention_pages: number;
  independent_editorial_publisher_groups: number;
  estimated_total_backlinks: null;
  total_backlinks_note: string;
  formula: string;
  components: { breadth_points: number; independent_proof_points_range: [number, number] };
  top_backlinks: SourceAssessment[];
  top_mentions_without_links: SourceAssessment[];
  sources: SourceAssessment[];
  limitations: string[];
  evidence_source: string;
  reused_evidence: boolean;
}

export interface VerifyOptions {
  limit?: number;
  render?: boolean;
  brand?: string;
  aliases?: string[];
  /** Hosts treated as owned/related; they never count as independent proof. */
  relatedHosts?: string[];
  timeoutMs?: number;
}

export interface AssessOptions {
  relatedHosts?: string[];
  requestedSearchPages?: number;
}
