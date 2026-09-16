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
  };
}

export interface SchemaValidationResult {
  hasJsonLd: boolean;
  typesFound: string[];
  missingExpected: string[];
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
  openGraph: {
    title?: string;
    description?: string;
    type?: string;
  };
  schema: SchemaValidationResult;
  aeo: AeoScoreResult;
  issues: string[];
}

export interface DomainAuditResult {
  domain: DomainConfig;
  robotsAccessible: boolean;
  sitemapAccessible: boolean;
  sitemapUrlCount: number;
  llmsTxtAccessible?: boolean;
  llmsFullTxtAccessible?: boolean;
  sampledUrlsCount?: number;
  pages: PageAuditResult[];
  averageAeoScore: number;
  passed: boolean;
}

export interface OverallAuditReport {
  timestamp: string;
  project: string;
  domainsAudited: number;
  totalUrlsChecked: number;
  averageAeoScore: number;
  criticalIssues: string[];
  results: DomainAuditResult[];
}

