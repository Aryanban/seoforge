export type IssueSeverity = "Error" | "Warning" | "Notice";

export interface AuditIssue {
  id: string;
  name: string;
  severity: IssueSeverity;
  message: string;
  url: string;
  details?: Record<string, any>;
}

export interface IssueSummary {
  id: string;
  name: string;
  severity: IssueSeverity;
  affectedPages: number;
  change: number; // e.g. -1, +1, 0
  affectedUrls: string[];
  recommendation: string;
}

export interface DomainConfig {
  name: string;
  url: string;
  sitemap?: string;
  robots?: string;
  llmsTxt?: string;
  llmsFullTxt?: string;
  sampleSitemap?: number;
  canonicalPolicy?: "strict" | "spa";
  priority?: "high" | "medium" | "low";
  expectedEntities?: string[];
  paths?: string[];
}

export interface SeoForgeConfig {
  project: string;
  indexnow?: {
    key: string;
    keyLocation: string;
  };
  domains: DomainConfig[];
  thresholds?: {
    maxResponseTimeMs?: number;
    minAeoScore?: number;
    requireCanonical?: boolean;
    requireSchema?: boolean;
    minWordCount?: number;
  };
}

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

export interface PageAuditResult {
  url: string;
  status: number;
  responseTimeMs: number;
  canonical?: string;
  canonicalMatches: boolean;
  isSpaCanonicalValid?: boolean;
  title?: string;
  description?: string;
  wordCount: number;
  h1Count: number;
  h1Text?: string;
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
  incomingInternalLinks: string[];
  outgoingInternalLinks: string[];
  externalLinks: string[];
  isOrphan: boolean;
  redirectChain?: string[];
  isRedirect: boolean;
  isHttpToHttpsRedirect: boolean;
  schema: SchemaValidationResult;
  aeo: AeoScoreResult;
  issues: string[]; // Formatted issue messages for backward compatibility
  auditIssues: AuditIssue[]; // Structured Ahrefs-style issues
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
