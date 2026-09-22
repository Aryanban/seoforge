/**
 * Publishing / backlink-source catalog types.
 *
 * Ported from BeyondSEO (`playbooks/backlink-system/posting-sites.json`,
 * `scripts/backlink_sources.py`) — MIT, Muhammad Tahir Ashraf (Beyond Tahir).
 * The catalog is a static data asset: DR values are unverified sheet provenance
 * and are never used to rank a shortlist.
 */

export type SourceKind =
  | "article"
  | "article_directory"
  | "answer"
  | "community"
  | "community_submission"
  | "professional_community"
  | "curation"
  | "editorial_article"
  | "newsletter"
  | "owned_blog"
  | "owned_resource"
  | "code_resource"
  | "social_article"
  | "software_demo"
  | "unclassified";

/** Review status describes how much of the posting route is documented. */
export type ReviewStatus =
  | "guidance_reviewed"
  | "unreviewed"
  | "closed"
  | "temporarily_unavailable"
  | "not_a_publication";

/** Free-term status of a site's publishing route. */
export type CostStatus =
  | "free_basic"
  | "conditional_free"
  | "free_recheck"
  | "sheet_claim_only"
  | "unknown";

/** Planning readiness slot; "start" sources are proposed first. */
export type Readiness =
  | "start"
  | "supporting"
  | "alternative"
  | "exclude"
  | "research_first";

export interface PostingSite {
  id: string;
  name: string;
  source_rows: string[];
  source_urls: string[];
  /** Raw DR values copied from the source sheet — unverified, sometimes conflicting. */
  sheet_dr_values: number[];
  sheet_dr_conflict: boolean;
  sheet_link_labels: string[];
  website_url: string;
  posting_url: string;
  kind: SourceKind;
  topics: string[];
  regions: string[];
  /** Eligibility prerequisites the profile's `assets` must cover. */
  requirements: string[];
  cost_status: CostStatus;
  review_status: ReviewStatus;
  /** ISO date the documented guidance was last checked. */
  reviewed_at: string | null;
  review_sources: string[];
  how_to_post: string[];
  link_guidance: string;
  eligibility: string;
  fit_note: string;
  /** Angle template; `{topic}`, `{Topic}`, `{audience}`, `{business}` are interpolated. */
  article_angle: string;
  readiness: Readiness;
  example_url_only: boolean;
  current_da: number | null;
  current_dr: number | null;
  observed_link_rel: string[] | null;
  indexing_status: string;
  /** Host family this site belongs to (present on ~28 platform entries). */
  platform_family?: string;
}

/** A target page on the user's own site that a published contribution can link to. */
export interface ProfilePage {
  url: string;
  topic: string;
  status?: "existing" | "planned" | "provided";
}

/**
 * Business profile that drives a tailored shortlist.
 * Mirrors BeyondSEO `examples/posting-profile.json`.
 */
export interface PostingProfile {
  business: string;
  website: string;
  audience: string;
  topics: string[];
  markets?: string[];
  assets?: string[];
  posts_per_week?: number;
  start_date?: string;
  evidence_basis?: string;
  pages: ProfilePage[];
}

export type ExclusionReason =
  | ReviewStatus
  | "posting_route_not_documented"
  | "free_terms_not_established"
  | "guidance_needs_refresh"
  | "topic_mismatch"
  | "market_eligibility_unconfirmed"
  | "required_asset_or_eligibility_missing";

export interface ExcludedSource {
  site: string;
  reason: ExclusionReason;
}

/** A single proposed publishing task in a generated plan. */
export interface PublishingTask {
  position: number;
  site_id: string;
  website: string;
  posting_url: string;
  format: SourceKind;
  priority: Readiness;
  why_this_site: string;
  suggested_title_or_action: string;
  target_page: string;
  target_page_status: "existing" | "planned" | "provided";
  outline: string[];
  anchor_guidance: string;
  how_to_post: string[];
  link_guidance: string;
  eligibility: string;
  cost_status: CostStatus;
  sheet_dr_values_unverified: number[];
  sheet_dr_conflict: boolean;
  current_da: number | null;
  current_dr: number | null;
  publication_role: string;
  authority_assessment: string;
  guidance_checked_on: string | null;
  guidance_sources: string[];
  suggested_week: number;
  suggested_date: string;
  timing_basis: string;
  status: string;
  before_posting: string[];
  after_posting: string[];
}

export interface PublishingPlan {
  business: string;
  website: string;
  profile_basis: string;
  created_on: string;
  requested_sources: number;
  selected_sources: number;
  shortfall: number;
  catalog_sites_considered: number;
  excluded_summary: Record<string, number>;
  excluded: ExcludedSource[];
  tasks: PublishingTask[];
  interpretation: string;
  preparation_week: string;
}

export interface SourceFilter {
  platform?: string;
  category?: string;
  kind?: string;
  status?: string;
}
