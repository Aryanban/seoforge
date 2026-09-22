/**
 * Backwards-compatibility shim — v1 entry point still works against 2.0.
 * `crawlDomain` now runs a config-scoped full-site crawl for the domain.
 */
export { Crawler, crawlSite } from "./crawl/crawler.js";
export { auditSinglePage as crawlPage } from "./audit-page.js";

import { crawlSite } from "./crawl/crawler.js";
import { DomainConfig, DomainAuditResult, PageAuditResult, CrawlResult } from "./types.js";

/**
 * v1 API: crawl a single configured domain and return a DomainAuditResult.
 */
export async function crawlDomain(
  domain: DomainConfig,
  options?: { sampleSitemap?: number; canonicalPolicy?: "strict" | "spa" }
): Promise<DomainAuditResult> {
  const sample = options?.sampleSitemap ?? domain.sampleSitemap;
  const result: CrawlResult = await crawlSite(domain.url, {
    strategy: "config",
    paths: domain.paths,
    sampleSitemap: sample,
    canonicalPolicy: options?.canonicalPolicy ?? domain.canonicalPolicy,
    expectedEntities: domain.expectedEntities,
    sitemapOverride: domain.sitemap,
    limit: Math.max(50, (domain.paths?.length || 1) + (sample || 0) + 25),
  });

  const pages: PageAuditResult[] = result.pages.map((p) => ({ ...p }));
  return {
    domain,
    crawlDate: result.startedAt,
    previousCrawlDate: undefined,
    robotsAccessible: result.robotsAccessible,
    sitemapAccessible: result.sitemapAccessible,
    sitemapUrlCount: result.sitemapUrlCount,
    llmsTxtAccessible: result.llmsTxtAccessible,
    llmsFullTxtAccessible: result.llmsFullTxtAccessible,
    sampledUrlsCount: result.totalUrlsCrawled - (domain.paths?.length || 1),
    pages,
    issuesSummary: result.issuesSummary,
    totalErrors: result.totalErrors,
    totalWarnings: result.totalWarnings,
    totalNotices: result.totalNotices,
    totalIssues: result.totalIssues,
    averageAeoScore: result.averageAeoScore,
    passed: result.passed,
  };
}
