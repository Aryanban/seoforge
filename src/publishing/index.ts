/**
 * Publishing / backlink-source module: catalog browsing and tailored
 * publishing-prospect plans. Ported from BeyondSEO (MIT, Beyond Tahir).
 */

export { loadSources, catalogSize, catalogMarkdown, cell } from "./sources.js";
export {
  validateProfile,
  writingOutline,
  publicationRole,
  buildPlan,
  planMarkdown,
  planCsv,
  PLAN_CSV_FIELDS,
} from "./plan.js";
export { POSTING_SITES } from "./posting-sites.data.js";
export type {
  PostingSite,
  SourceKind,
  ReviewStatus,
  CostStatus,
  Readiness,
  ProfilePage,
  PostingProfile,
  ExcludedSource,
  ExclusionReason,
  PublishingTask,
  PublishingPlan,
  SourceFilter,
} from "./types.js";
