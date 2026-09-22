/**
 * Reputation module: verify candidate backlink/mention sources and score them
 * under model 1.1. Ported from BeyondSEO (MIT, Beyond Tahir).
 */

export {
  host,
  publisherKey,
  verifySource,
  checkSources,
  sourceRows,
  targetLinks,
  mentionEvidence,
} from "./verify.js";
export { sourceScore, assess, reassess } from "./score.js";
export { reputationMarkdown, reputationCsv } from "./report.js";
export type {
  Verification,
  MentionStatus,
  Relevance,
  Relationship,
  Context,
  DiscoveryMeta,
  SourceRow,
  TargetLink,
  BrandMention,
  Representation,
  VerificationResult,
  CheckSourcesResult,
  ScoreDimension,
  SourceAssessment,
  ScoreStatus,
  Confidence,
  EvidenceAdjustment,
  ReputationCoverage,
  ReputationResult,
  VerifyOptions,
  AssessOptions,
} from "./types.js";
