/**
 * Discovery layer types.
 *
 * Ported from BeyondSEO `src/beyondseo/discovery.py` (MIT, Muhammad Tahir
 * Ashraf). Discovery collects *unverified leads*: a search result or a
 * supplied URL is a candidate to check with the native crawler, never a
 * confirmed backlink, mention or authority signal.
 */

/** Native providers that fetch public search endpoints directly. */
export type NativeProvider = "duckduckgo-html" | "bing-rss";

/**
 * Saved-HTML providers. `bing`/`google` are only importable from operator
 * snapshots — SEOForge never scrapes them live, matching BeyondSEO's
 * "no unattended live Google collector" rule.
 */
export type SavedProvider = NativeProvider | "bing" | "google";

export type Provider = NativeProvider | "query_preparation" | "native" | "supplied";

/** Outcome of one search attempt. SUCCESS members count as usable responses. */
export type AttemptStatus =
  | "results"
  | "empty_results"
  | "no_relevant_results"
  | "response_received"
  | "provider_challenge"
  | "parse_failed"
  | "query_review_required"
  | "tool_unavailable"
  | "budget_exhausted"
  | "robots_restricted"
  | "robots_unavailable"
  | "environment_network_restricted"
  | "permission_denied"
  | "missing_dependency"
  | "dns_failure"
  | "tls_failure"
  | "connection_timeout"
  | "connection_failure"
  | "provider_rate_limited"
  | "http_access_denied"
  | "http_error"
  | "unknown";

export const SUCCESS_STATUSES: AttemptStatus[] = [
  "results",
  "empty_results",
  "no_relevant_results",
];

export function isSuccessStatus(status: string): boolean {
  return (SUCCESS_STATUSES as string[]).includes(status);
}

/** Classified failure evidence — the observation, never a blamed cause. */
export interface FailureDetail {
  code: AttemptStatus;
  evidence: string;
  http_status: number | null;
  cause: string;
}

/** A search request: query text plus optional market/language context. */
export interface SearchQuery {
  query: string;
  market?: string | null;
  language?: string | null;
  /** Generated seeds marked `needs_review` are never searched natively. */
  query_review_status?: string | null;
}

/** Operator-supplied snapshot of one already-captured result page. */
export interface SavedSearch {
  path: string;
  provider: SavedProvider;
  query: string;
  captured_at: string;
  market?: string | null;
  language?: string | null;
  search_page?: number | null;
}

/** A raw result row extracted from a response body. */
export interface SearchResultRow {
  url: string;
  title: string;
  snippet: string;
  result_order: number;
}

/** Provenance for one observation of a candidate URL. */
export interface Provenance {
  provider?: string | null;
  query?: string | null;
  captured_at?: string | null;
  imported_at?: string | null;
  origin?: string | null;
  status?: string | null;
  failure?: FailureDetail | null;
  coverage?: string | null;
  source_snapshot?: string | null;
  response_sha256?: string | null;
  result_order?: number;
  title?: string;
  snippet?: string;
  search_page?: number | null;
  fallback_from?: { provider: string; status: string } | null;
  requested_market?: string | null;
  requested_language?: string | null;
  attempted_at?: string | null;
  cache_hit?: boolean;
  http_status?: number | null;
  evidence?: Record<string, unknown>;
  [key: string]: unknown;
}

/** One deduplicated candidate URL with every observation that found it. */
export interface DiscoveryCandidate {
  url: string;
  verification: "unverified_lead";
  provenance: Provenance[];
}

/** One recorded search attempt (native, imported or host-recorded). */
export interface SearchAttempt {
  provider: Provider;
  query: string;
  requested_market?: string | null;
  requested_language?: string | null;
  fallback_from?: { provider: string; status: string } | null;
  attempted_at: string;
  captured_at: string;
  status: AttemptStatus;
  failure: FailureDetail | null;
  http_status?: number | null;
  results: SearchResultRow[];
  origin?: string | null;
  source_snapshot?: string | null;
  response_sha256?: string | null;
  coverage?: string | null;
  search_page?: number | null;
  actual_market?: null;
  actual_language?: null;
  accepted_leads?: number;
  cache_hit?: boolean;
  [key: string]: unknown;
}

/** Output of `discover()`. */
export interface DiscoveryResult {
  schema_version: 1;
  created_at: string;
  target: string;
  status: "leads_available" | "no_leads";
  search_available: boolean;
  queries_requested: number;
  queries_processed: number;
  queries_needing_review: number;
  attempts: SearchAttempt[];
  candidates: DiscoveryCandidate[];
  candidate_count: number;
  native_requests: number;
  request_budget: number;
  candidate_budget_reached: boolean;
  coverage_limited: boolean;
  note: string;
  host_tool_availability: "recorded" | "not_observed_by_cli";
}

export interface DiscoverOptions {
  target?: string;
  providers?: NativeProvider[];
  hostRecords?: SearchAttempt[];
  candidates?: (string | Record<string, unknown>)[];
  saved?: SavedSearch[];
  offline?: boolean;
  maxRequests?: number;
  maxQueries?: number;
  maxCandidates?: number;
  timeoutMs?: number;
  seconds?: number;
  cacheDir?: string;
  cacheTtlSeconds?: number;
  /** Write response snapshots next to the output directory. */
  snapshotDir?: string;
}

/** A query + provider pair recorded by the host's own search tool. */
export interface HostRecord {
  provider: string;
  query: string;
  captured_at: string;
  status: string;
  evidence: string;
  results?: Array<{ url: string; title?: string; snippet?: string }>;
  http_status?: number;
  stage?: string;
  market?: string | null;
  language?: string | null;
  requested_market?: string | null;
  requested_language?: string | null;
  coverage?: string;
}

export interface SearchPlanResult {
  target: string;
  brand: string;
  requested_pages: number;
  completed_pages: number;
  query: string;
  created_at: string;
  pages: Array<{ page: number; url: string; status: "planned" }>;
  note: string;
}

export interface SearchImportResult {
  input_kind: "supplied_search_html";
  engine_declared_by_operator: string;
  snapshots_imported: number;
  attempts: SearchAttempt[];
  candidate_urls: number;
  captured_at_supplied: string;
  note: string;
  candidates: DiscoveryCandidate[];
}

export const DISCOVERY_NOTE =
  "Search results and snippets are unverified leads. Verify source pages with the native " +
  "crawler. This bounded sample is not a complete backlink index, a ranking measurement, " +
  "or proof of authority. A failed search source does not require a paid tool.";
