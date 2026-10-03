/**
 * Discovery layer: bounded search leads shared by reputation and competitor
 * research.
 *
 * Ported from BeyondSEO (MIT, Muhammad Tahir Ashraf) — `src/beyondseo/discovery.py`
 * and the `search_plan` / `import_search_html` parts of `src/beyondseo/reputation.py`.
 *
 * Host tools execute in the host, not inside SEOForge. Their recorded responses
 * use the same attempt contract as native providers; no search result verifies
 * a page. Everything produced here is an **unverified lead** until the native
 * crawler checks the page.
 */

export { discover, consolidate, hostAttempts } from "./discover.js";
export { parseSearch } from "./parse.js";
export { failureDetail, challengeSignal } from "./diagnostics.js";
export { RequestBudget } from "./budget.js";
export { NativeSearch, budgetedFetch } from "./native.js";
export { searchPlan, writeSearchPlan, importSearchHtml } from "./plan.js";
export {
  discoveryMarkdown,
  searchPlanMarkdown,
  searchImportMarkdown,
  sourcesCsv,
  candidatesToRows,
} from "./report.js";
export { discoveryHost, normalizeCandidateUrl } from "./url.js";
export type {
  AttemptStatus,
  DiscoveryCandidate,
  DiscoveryResult,
  DiscoverOptions,
  FailureDetail,
  HostRecord,
  NativeProvider,
  Provenance,
  SavedProvider,
  SavedSearch,
  SearchAttempt,
  SearchImportResult,
  SearchPlanResult,
  SearchQuery,
  SearchResultRow,
} from "./types.js";
export { isSuccessStatus, SUCCESS_STATUSES } from "./types.js";
