/**
 * SEOForge 2.0 — Core type system
 * Full-site crawler + Ahrefs/Screaming Frog-grade audit + AEO engine.
 */

export type IssueSeverity = "Error" | "Warning" | "Notice";

export type IssueCategory =
  | "Indexability"
  | "Meta"
  | "Headings"
  | "Content"
  | "Links"
  | "Images"
  | "Sitemap"
  | "Robots"
  | "Performance"
  | "StructuredData"
  | "AEO"
  | "Technical";

export interface AuditIssue {
  id: string;
  name: string;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  url: string;
  details?: Record<string, unknown>;
}

export interface IssueSummary {
  id: string;
  name: string;
  severity: IssueSeverity;
  category: IssueCategory;
  affectedPages: number;
  change: number; // e.g. -1, +1, 0 vs previous crawl
  affectedUrls: string[];
  recommendation: string;
}

export interface RecommendationDoc {
  id: string;
  issueId: string;
  name: string;
  severity: IssueSeverity;
  category: IssueCategory;
  affectedPages: number;
  change: number;
  priority: "Critical" | "High" | "Medium" | "Low";
  effort: "S" | "M" | "L";
  recommendation: string;
  markdown: string; // full AI-style fix doc
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export type CrawlStrategy = "discover" | "sitemap" | "config";
export type CanonicalPolicy = "strict" | "spa";

export interface CrawlOptions {
  maxDepth?: number;
  concurrency?: number;
  limit?: number; // crawl budget (max pages)
  render?: boolean; // optional Playwright render mode
  strategy?: CrawlStrategy;
  sampleSitemap?: number;
  canonicalPolicy?: CanonicalPolicy;
  respectRobots?: boolean;
  maxRequestsPerSecond?: number;
  excludePatterns?: string[];
  checkExternalLinks?: boolean;
  externalLinkTimeoutMs?: number;
  timeoutMs?: number;
  followSitemap?: boolean;
  // SEOForge 2.0 driver fields (passed through to the check engine)
  expectedEntities?: string[];
  thresholds?: Thresholds;
  paths?: string[];
  sitemapOverride?: string;
  seedUrls?: string[];
}

export interface Thresholds {
  maxResponseTimeMs?: number;
  minAeoScore?: number;
  minWordCount?: number;
  requireCanonical?: boolean;
  requireSchema?: boolean;
}

export interface DomainConfig {
  name: string;
  url: string;
  sitemap?: string;
  robots?: string;
  llmsTxt?: string;
  llmsFullTxt?: string;
  sampleSitemap?: number;
  canonicalPolicy?: CanonicalPolicy;
  priority?: "high" | "medium" | "low";
  expectedEntities?: string[];
  paths?: string[];
  // SEOForge 2.0 additions
  render?: boolean;
  crawlStrategy?: CrawlStrategy;
  maxDepth?: number;
  excludePatterns?: string[];
  checkExternalLinks?: boolean;
}

export interface SeoForgeConfig {
  project: string;
  indexnow?: {
    key: string;
    keyLocation?: string;
  };
  domains: DomainConfig[];
  thresholds?: {
    maxResponseTimeMs?: number;
    minAeoScore?: number;
    minWordCount?: number;
    requireCanonical?: boolean;
    requireSchema?: boolean;
  };
  crawl?: CrawlOptions;
  server?: {
    port?: number;
    host?: string;
    open?: boolean;
  };
}

/* ------------------------------------------------------------------ */
/* Crawl primitives                                                    */
/* ------------------------------------------------------------------ */

export type CrawlStatus = "running" | "completed" | "failed" | "stopped";

export interface CrawlProgress {
  crawlId: string;
  status: CrawlStatus;
  crawled: number;
  discovered: number;
  depth: number;
  currentUrl?: string;
  errors: number;
  warnings: number;
  notices: number;
  pagesPerSecond: number;
  startedAt: string;
  finishedAt?: string;
  message?: string;
}

export interface PageData {
  url: string;
  finalUrl: string;
  normalizedUrl: string;
  status: number;
  responseTimeMs: number;
  ttfbMs?: number;
  depth: number;
  isRedirect: boolean;
  redirectChain: string[];
  isHttpToHttpsRedirect: boolean;
  html: string;
  rendered: boolean;
  headers: Record<string, string>;
  contentType?: string;
  contentLengthBytes?: number;
  errorMessage?: string;
}

export interface LinkInfo {
  source: string; // page the link was found on (absolute URL)
  target: string; // resolved absolute target
  rawHref: string;
  anchorText: string;
  rel: string;
  nofollow: boolean;
  isInternal: boolean;
  element: "a" | "img" | "link" | "iframe";
}

export interface ImageInfo {
  page: string;
  url: string;
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  hasDimensions: boolean;
  inLink?: boolean; // image wrapped in <a> without anchor text
}

export interface ExternalLinkCheck {
  url: string;
  status: number;
  isBroken: boolean;
  isRedirect: boolean;
  checked: boolean;
}

export interface SitemapEntry {
  url: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  source: string; // sitemap file it came from
}

/* ------------------------------------------------------------------ */
/* Audit results                                                       */
/* ------------------------------------------------------------------ */

export interface SchemaValidationResult {
  hasJsonLd: boolean;
  typesFound: string[];
  missingExpected: string[];
  googleRichResultsErrors: string[];
  schemaOrgErrors: string[];
  errors: string[];
  rawGraphCount: number;
}

export interface AeoScoreResult {
  score: number; // 0 - 100
  h1Count: number;
  h2Count: number;
  hasInvertedPyramidSnippet: boolean;
  definitionSnippet?: string;
  tableCount: number;
  hasFaqSchema: boolean;
  recommendations: string[];
}

export interface CoreWebVitals {
  lcp?: number;
  cls?: number;
  inp?: number;
  fcp?: number;
  ttfb?: number;
  domContentLoaded?: number;
  resourceCount?: number;
  transferBytes?: number;
}

export interface PageAuditResult {
  url: string;
  normalizedUrl: string;
  finalUrl: string;
  status: number;
  responseTimeMs: number;
  ttfbMs?: number;
  depth: number;
  rendered: boolean;
  canonical?: string;
  canonicalMatches: boolean;
  isSpaCanonicalValid?: boolean;
  title?: string;
  titleLength?: number;
  description?: string;
  descriptionLength?: number;
  wordCount: number;
  h1Count: number;
  h1Text?: string;
  h2Count: number;
  h1InNoscriptOnly?: boolean;
  openGraph: {
    title?: string;
    description?: string;
    image?: string;
    url?: string;
    type?: string;
    incomplete: boolean;
    missingKeys: string[];
  };
  twitterCard: {
    card?: string;
    title?: string;
    description?: string;
    image?: string;
    incomplete: boolean;
  };
  hreflang: string[];
  incomingInternalLinks: string[];
  outgoingInternalLinks: string[];
  externalLinks: string[];
  images: ImageInfo[];
  isOrphan: boolean;
  internalLinkScore: number;
  redirectChain?: string[];
  isRedirect: boolean;
  isHttpToHttpsRedirect: boolean;
  isIndexable: boolean;
  blockedByRobots: boolean;
  schema: SchemaValidationResult;
  aeo: AeoScoreResult;
  cwv?: CoreWebVitals;
  issues: string[]; // formatted "[Severity] name" for back-compat
  auditIssues: AuditIssue[];
}

export interface DomainAuditResult {
  domain: DomainConfig;
  crawlDate: string;
  previousCrawlDate?: string;
  robotsAccessible: boolean;
  sitemapAccessible: boolean;
  sitemapUrlCount: number;
  llmsTxtAccessible?: boolean;
  llmsFullTxtAccessible?: boolean;
  sampledUrlsCount?: number;
  pages: PageAuditResult[];
  issuesSummary: IssueSummary[];
  totalErrors: number;
  totalWarnings: number;
  totalNotices: number;
  totalIssues: number;
  averageAeoScore: number;
  passed: boolean;
}

export interface OverallAuditReport {
  timestamp: string;
  project: string;
  domainsAudited: number;
  totalUrlsChecked: number;
  totalErrors: number;
  totalWarnings: number;
  totalNotices: number;
  totalIssues: number;
  averageAeoScore: number;
  criticalIssues: string[];
  issuesSummary: IssueSummary[];
  results: DomainAuditResult[];
}

/* ------------------------------------------------------------------ */
/* Crawl result (2.0)                                                  */
/* ------------------------------------------------------------------ */

export interface LinkRecord {
  crawlId: string;
  source: string;
  target: string;
  anchorText: string;
  nofollow: boolean;
  isInternal: boolean;
  targetStatus: number;
  isBroken: boolean;
  isRedirect: boolean;
  redirectChain: string[];
}

export interface CrawlResult {
  id: string;
  targetUrl: string;
  domainName?: string;
  project?: string;
  strategy: CrawlStrategy;
  startedAt: string;
  finishedAt?: string;
  status: CrawlStatus;
  options: CrawlOptions;
  robotsAccessible: boolean;
  sitemapAccessible: boolean;
  sitemapUrlCount: number;
  llmsTxtAccessible?: boolean;
  llmsFullTxtAccessible?: boolean;
  pages: PageAuditResult[];
  links: LinkRecord[];
  sitemapEntries: SitemapEntry[];
  issuesSummary: IssueSummary[];
  recommendations: RecommendationDoc[];
  totalErrors: number;
  totalWarnings: number;
  totalNotices: number;
  totalIssues: number;
  averageAeoScore: number;
  totalUrlsCrawled: number;
  maxDepthReached: number;
  passed: boolean;
}

/* ------------------------------------------------------------------ */
/* Snapshots (legacy JSON, migrated to SQLite)                         */
/* ------------------------------------------------------------------ */

export interface PageSnapshot {
  url: string;
  title?: string;
  description?: string;
  canonical?: string;
  h1Text?: string;
  wordCount: number;
  status: number;
}

export interface DomainSnapshot {
  domainUrl: string;
  crawlDate: string;
  pages: Record<string, PageSnapshot>;
  issueCounts: Record<string, number>;
}
