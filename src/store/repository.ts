/**
 * Repository — typed query layer over the SQLite store.
 */
import { DatabaseSync } from "node:sqlite";
import {
  AuditIssue,
  CrawlResult,
  IssueSummary,
  PageAuditResult,
  RecommendationDoc,
} from "../types.js";
import type { CompetitorComparison } from "../competitors/compare.js";
import type { PublishingPlan } from "../publishing/types.js";
import type { ReputationResult } from "../reputation/types.js";
import { buildIssueSummary } from "../checks/summary.js";

type Row = Record<string, any>;

export function saveCrawl(db: DatabaseSync, result: CrawlResult): void {
  const tx = db.exec.bind(db);
  db.prepare(
    `INSERT OR REPLACE INTO crawls
      (id, target_url, domain_name, project, strategy, status, started_at, finished_at,
       total_urls, total_errors, total_warnings, total_notices, average_aeo_score,
       max_depth, passed, robots_accessible, sitemap_accessible, sitemap_url_count, options_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    result.id,
    result.targetUrl,
    result.domainName ?? null,
    result.project ?? null,
    result.strategy,
    result.status,
    result.startedAt,
    result.finishedAt ?? null,
    result.totalUrlsCrawled,
    result.totalErrors,
    result.totalWarnings,
    result.totalNotices,
    result.averageAeoScore,
    result.maxDepthReached,
    result.passed ? 1 : 0,
    result.robotsAccessible ? 1 : 0,
    result.sitemapAccessible ? 1 : 0,
    result.sitemapUrlCount,
    JSON.stringify(result.options)
  );

  tx("BEGIN");
  try {
    const insertPage = db.prepare(
      `INSERT OR REPLACE INTO pages
        (crawl_id, url, normalized_url, final_url, status, response_time_ms, ttfb_ms, depth,
         rendered, canonical, canonical_matches, title, description, h1_text, word_count,
         h1_count, h2_count, incoming_links, outgoing_links, external_links, is_orphan,
         internal_link_score, is_indexable, aeo_score, schema_types)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const p of result.pages) {
      insertPage.run(
        result.id,
        p.url,
        p.normalizedUrl,
        p.finalUrl,
        p.status,
        p.responseTimeMs,
        p.ttfbMs ?? null,
        p.depth,
        p.rendered ? 1 : 0,
        p.canonical ?? null,
        p.canonicalMatches ? 1 : 0,
        p.title ?? null,
        p.description ?? null,
        p.h1Text ?? null,
        p.wordCount,
        p.h1Count,
        p.h2Count,
        p.incomingInternalLinks.length,
        p.outgoingInternalLinks.length,
        p.externalLinks.length,
        p.isOrphan ? 1 : 0,
        p.internalLinkScore,
        p.isIndexable ? 1 : 0,
        p.aeo.score,
        JSON.stringify(p.schema.typesFound)
      );
    }

    const insertIssue = db.prepare(
      `INSERT INTO issues (crawl_id, page_url, issue_id, name, severity, category, message, details_json)
       VALUES (?,?,?,?,?,?,?,?)`
    );
    for (const p of result.pages) {
      for (const i of p.auditIssues) {
        insertIssue.run(
          result.id,
          p.url,
          i.id,
          i.name,
          i.severity,
          i.category,
          i.message,
          i.details ? JSON.stringify(i.details) : null
        );
      }
    }

    const insertLink = db.prepare(
      `INSERT INTO links (crawl_id, source, target, anchor_text, nofollow, is_internal, target_status, is_broken, is_redirect)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    for (const l of result.links) {
      insertLink.run(
        result.id,
        l.source,
        l.target,
        l.anchorText || null,
        l.nofollow ? 1 : 0,
        l.isInternal ? 1 : 0,
        l.targetStatus,
        l.isBroken ? 1 : 0,
        l.isRedirect ? 1 : 0
      );
    }

    const insertSitemap = db.prepare(
      `INSERT OR IGNORE INTO sitemap_urls (crawl_id, url, lastmod, source) VALUES (?,?,?,?)`
    );
    for (const s of result.sitemapEntries) {
      insertSitemap.run(result.id, s.url, s.lastmod ?? null, s.source);
    }

    const insertRec = db.prepare(
      `INSERT OR REPLACE INTO recommendations
        (crawl_id, issue_id, name, severity, category, affected_pages, change, priority, effort, recommendation, markdown)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const r of result.recommendations) {
      insertRec.run(
        result.id,
        r.issueId,
        r.name,
        r.severity,
        r.category,
        r.affectedPages,
        r.change,
        r.priority,
        r.effort,
        r.recommendation,
        r.markdown
      );
    }
    tx("COMMIT");
  } catch (err) {
    tx("ROLLBACK");
    throw err;
  }
}

export function getCrawl(db: DatabaseSync, crawlId: string): CrawlResult | null {
  const row = db.prepare("SELECT * FROM crawls WHERE id = ?").get(crawlId) as Row | undefined;
  if (!row) return null;
  return rowToCrawl(row);
}

export function listCrawls(db: DatabaseSync, limit = 25, targetUrl?: string): CrawlResult[] {
  const rows = targetUrl
    ? (db.prepare("SELECT * FROM crawls WHERE target_url = ? ORDER BY started_at DESC LIMIT ?").all(targetUrl, limit) as Row[])
    : (db.prepare("SELECT * FROM crawls ORDER BY started_at DESC LIMIT ?").all(limit) as Row[]);
  return rows.map(rowToCrawl);
}

function rowToCrawl(row: Row): CrawlResult {
  return {
    id: row.id,
    targetUrl: row.target_url,
    domainName: row.domain_name ?? undefined,
    project: row.project ?? undefined,
    strategy: row.strategy,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    status: row.status,
    options: safeParse(row.options_json, {}),
    robotsAccessible: !!row.robots_accessible,
    sitemapAccessible: !!row.sitemap_accessible,
    sitemapUrlCount: row.sitemap_url_count ?? 0,
    pages: [],
    links: [],
    sitemapEntries: [],
    issuesSummary: [],
    recommendations: [],
    totalErrors: row.total_errors ?? 0,
    totalWarnings: row.total_warnings ?? 0,
    totalNotices: row.total_notices ?? 0,
    totalIssues: (row.total_errors ?? 0) + (row.total_warnings ?? 0) + (row.total_notices ?? 0),
    averageAeoScore: row.average_aeo_score ?? 0,
    totalUrlsCrawled: row.total_urls ?? 0,
    maxDepthReached: row.max_depth ?? 0,
    passed: !!row.passed,
  };
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Read queries                                                        */
/* ------------------------------------------------------------------ */

export interface IssueFilter {
  severity?: string;
  category?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function getIssues(db: DatabaseSync, crawlId: string, filter: IssueFilter = {}): { rows: IssueSummary[]; total: number } {
  const where: string[] = ["i.crawl_id = ?"];
  const params: any[] = [crawlId];
  if (filter.severity && filter.severity !== "all") {
    where.push("i.severity = ?");
    params.push(filter.severity);
  }
  if (filter.category && filter.category !== "all") {
    where.push("i.category = ?");
    params.push(filter.category);
  }
  if (filter.search) {
    where.push("(i.name LIKE ? OR i.message LIKE ? OR i.page_url LIKE ?)");
    params.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`);
  }

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM issues i WHERE ${where.join(" AND ")}`)
    .get(...params) as Row;
  const total = totalRow?.c ?? 0;

  const rows = db
    .prepare(
      `SELECT i.issue_id AS id, i.name AS name, i.severity AS severity, i.category AS category,
              COUNT(DISTINCT i.page_url) AS affectedPages, r.recommendation AS recommendation
       FROM issues i
       LEFT JOIN recommendations r ON r.crawl_id = i.crawl_id AND r.issue_id = i.issue_id
       WHERE ${where.join(" AND ")}
       GROUP BY i.name
       ORDER BY CASE i.severity WHEN 'Error' THEN 3 WHEN 'Warning' THEN 2 ELSE 1 END DESC, affectedPages DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as Row[];

  const summaries: IssueSummary[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    severity: r.severity,
    category: r.category,
    affectedPages: r.affectedPages,
    change: 0,
    affectedUrls: [],
    recommendation: r.recommendation ?? "",
  }));

  return { rows: summaries, total };
}

export function getIssueUrls(db: DatabaseSync, crawlId: string, issueName: string, limit = 100): string[] {
  const rows = db
    .prepare("SELECT DISTINCT page_url FROM issues WHERE crawl_id = ? AND name = ? LIMIT ?")
    .all(crawlId, issueName, limit) as Row[];
  return rows.map((r) => r.page_url as string);
}

export interface PageFilter {
  search?: string;
  status?: string;
  minAeo?: number;
  isOrphan?: boolean;
  page?: number;
  pageSize?: number;
}

export function getPages(db: DatabaseSync, crawlId: string, filter: PageFilter = {}): { rows: PageAuditResult[]; total: number } {
  const where: string[] = ["crawl_id = ?"];
  const params: any[] = [crawlId];
  if (filter.search) {
    where.push("(url LIKE ? OR title LIKE ? OR h1_text LIKE ? OR description LIKE ?)");
    params.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`);
  }
  if (filter.status && filter.status !== "all") {
    if (filter.status === "ok") where.push("status = 200");
    else if (filter.status === "redirect") where.push("status >= 300 AND status < 400");
    else if (filter.status === "broken") where.push("status >= 400");
    else where.push("status = ?");
  }
  if (filter.minAeo !== undefined) {
    where.push("aeo_score < ?");
    params.push(filter.minAeo);
  }
  if (filter.isOrphan) {
    where.push("is_orphan = 1");
  }

  const page = Math.max(1, filter.page ?? 1);
  // Clamped for safety, but high enough that getFullCrawl (which passes a
  // large pageSize) reconstructs the *whole* crawl instead of silently
  // truncating at 500 pages — otherwise exports/issue counts are wrong for
  // any site larger than 500 pages.
  const pageSize = Math.min(50_000, Math.max(1, filter.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM pages WHERE ${where.join(" AND ")}`).get(...params) as Row;
  const total = totalRow?.c ?? 0;

  const rows = db
    .prepare(`SELECT * FROM pages WHERE ${where.join(" AND ")} ORDER BY depth, url LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as Row[];

  const pages: PageAuditResult[] = rows.map((r) => ({
    url: r.url,
    normalizedUrl: r.normalized_url,
    finalUrl: r.final_url ?? r.url,
    status: r.status ?? 0,
    responseTimeMs: r.response_time_ms ?? 0,
    ttfbMs: r.ttfb_ms ?? undefined,
    depth: r.depth ?? 0,
    rendered: !!r.rendered,
    canonical: r.canonical ?? undefined,
    canonicalMatches: !!r.canonical_matches,
    title: r.title ?? undefined,
    description: r.description ?? undefined,
    wordCount: r.word_count ?? 0,
    h1Count: r.h1_count ?? 0,
    h1Text: r.h1_text ?? undefined,
    h2Count: r.h2_count ?? 0,
    incomingInternalLinks: [],
    outgoingInternalLinks: [],
    externalLinks: [],
    images: [],
    hreflang: [],
    isOrphan: !!r.is_orphan,
    internalLinkScore: r.internal_link_score ?? 0,
    isRedirect: false,
    isHttpToHttpsRedirect: false,
    isIndexable: !!r.is_indexable,
    blockedByRobots: false,
    openGraph: { incomplete: false, missingKeys: [] },
    twitterCard: { incomplete: false },
    schema: {
      hasJsonLd: true,
      typesFound: safeParse(r.schema_types, []),
      missingExpected: [],
      googleRichResultsErrors: [],
      schemaOrgErrors: [],
      errors: [],
      rawGraphCount: 0,
    },
    aeo: {
      score: r.aeo_score ?? 0,
      h1Count: r.h1_count ?? 0,
      h2Count: r.h2_count ?? 0,
      hasInvertedPyramidSnippet: false,
      tableCount: 0,
      hasFaqSchema: false,
      recommendations: [],
    },
    issues: [],
    auditIssues: [],
  }));

  return { rows: pages, total };
}

export interface LinkFilter {
  kind?: "internal" | "external" | "broken";
  search?: string;
  page?: number;
  pageSize?: number;
}

export function getLinks(db: DatabaseSync, crawlId: string, filter: LinkFilter = {}) {
  const where: string[] = ["crawl_id = ?"];
  const params: any[] = [crawlId];
  if (filter.kind === "internal") where.push("is_internal = 1");
  if (filter.kind === "external") where.push("is_internal = 0");
  if (filter.kind === "broken") where.push("is_broken = 1");
  if (filter.search) {
    where.push("(source LIKE ? OR target LIKE ? OR anchor_text LIKE ?)");
    params.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`);
  }

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50_000, Math.max(1, filter.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM links WHERE ${where.join(" AND ")}`).get(...params) as Row;
  const total = totalRow?.c ?? 0;
  const rows = db
    .prepare(`SELECT * FROM links WHERE ${where.join(" AND ")} ORDER BY is_broken DESC, target LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as Row[];

  return {
    rows: rows.map((r) => ({
      crawlId: r.crawl_id,
      source: r.source,
      target: r.target,
      anchorText: r.anchor_text ?? "",
      nofollow: !!r.nofollow,
      isInternal: !!r.is_internal,
      targetStatus: r.target_status ?? 0,
      isBroken: !!r.is_broken,
      isRedirect: !!r.is_redirect,
      redirectChain: [] as string[],
    })),
    total,
  };
}

export function getRecommendations(db: DatabaseSync, crawlId: string): RecommendationDoc[] {
  const rows = db
    .prepare("SELECT * FROM recommendations WHERE crawl_id = ? ORDER BY priority, affected_pages DESC")
    .all(crawlId) as Row[];
  return rows.map((r) => ({
    id: r.issue_id,
    issueId: r.issue_id,
    name: r.name,
    severity: r.severity,
    category: r.category,
    affectedPages: r.affected_pages ?? 0,
    change: r.change ?? 0,
    priority: r.priority ?? "Low",
    effort: r.effort ?? "S",
    recommendation: r.recommendation ?? "",
    markdown: r.markdown ?? "",
  }));
}

export function getSitemapUrls(db: DatabaseSync, crawlId: string, limit = 200) {
  const rows = db
    .prepare("SELECT * FROM sitemap_urls WHERE crawl_id = ? LIMIT ?")
    .all(crawlId, limit) as Row[];
  return rows.map((r) => ({
    url: r.url,
    lastmod: r.lastmod ?? undefined,
    source: r.source ?? "",
  }));
}

/**
 * Previous crawl's issue-name → count map, used for change deltas.
 */
export function getPreviousIssueCounts(db: DatabaseSync, targetUrl: string): Record<string, number> {
  const prev = db
    .prepare("SELECT id FROM crawls WHERE target_url = ? AND status = 'completed' ORDER BY started_at DESC LIMIT 1, 1")
    .get(targetUrl) as Row | undefined;

  if (!prev) return {};

  const rows = db
    .prepare("SELECT name, COUNT(DISTINCT page_url) AS c FROM issues WHERE crawl_id = ? GROUP BY name")
    .all(prev.id) as Row[];
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.name] = r.c;
  return counts;
}

/**
 * Health trend across completed crawls for a target.
 */
export function getTrend(db: DatabaseSync, targetUrl: string, limit = 30) {
  const rows = db
    .prepare(
      `SELECT id, started_at, total_urls, total_errors, total_warnings, total_notices, average_aeo_score
       FROM crawls WHERE target_url = ? AND status = 'completed'
       ORDER BY started_at ASC LIMIT ?`
    )
    .all(targetUrl, limit) as Row[];
  return rows.map((r) => ({
    crawlId: r.id,
    date: r.started_at,
    urls: r.total_urls ?? 0,
    errors: r.total_errors ?? 0,
    warnings: r.total_warnings ?? 0,
    notices: r.total_notices ?? 0,
    aeo: r.average_aeo_score ?? 0,
  }));
}

export function listAuditIssues(db: DatabaseSync, crawlId: string): AuditIssue[] {
  const rows = db.prepare("SELECT * FROM issues WHERE crawl_id = ?").all(crawlId) as Row[];
  return rows.map((r) => ({
    id: r.issue_id,
    name: r.name,
    severity: r.severity,
    category: r.category,
    message: r.message,
    url: r.page_url,
    details: safeParse(r.details_json, undefined),
  }));
}

/**
 * Rebuild a complete CrawlResult from the store (used by exports after a
 * server restart, when the in-memory copy is gone).
 */
export function getFullCrawl(db: DatabaseSync, crawlId: string): CrawlResult | null {
  const base = getCrawl(db, crawlId);
  if (!base) return null;

  const { rows: pages } = getPages(db, crawlId, { pageSize: 5000 });
  const allIssues = listAuditIssues(db, crawlId);
  const issuesByUrl = new Map<string, AuditIssue[]>();
  for (const i of allIssues) {
    const list = issuesByUrl.get(i.url) || [];
    list.push(i);
    issuesByUrl.set(i.url, list);
  }
  for (const p of pages) {
    const pi = issuesByUrl.get(p.url) || [];
    p.auditIssues = pi;
    p.issues = pi.map((i) => `[${i.severity}] ${i.name}`);
  }

  const { rows: links } = getLinks(db, crawlId, { pageSize: 20000 });
  const recommendations = getRecommendations(db, crawlId);
  const sitemaps = getSitemapUrls(db, crawlId, 5000);

  return {
    ...base,
    pages,
    links,
    sitemapEntries: sitemaps.map((s) => ({ url: s.url, lastmod: s.lastmod, source: s.source })),
    recommendations,
    issuesSummary: buildIssueSummary(pages),
  };
}

// ---------------------------------------------------------------------------
// Reputation assessments (model 1.1)
// ---------------------------------------------------------------------------

export function saveReputationAssessment(
  db: DatabaseSync,
  result: ReputationResult,
  id: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO reputation_assessments
      (id, target_url, brand, score, score_status, confidence, sources_checked,
       evidence_source, result_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    result.target,
    result.brand ?? null,
    result.score,
    result.score_status,
    result.confidence,
    result.coverage.sources_checked,
    result.evidence_source,
    JSON.stringify(result),
    result.checked_at,
  );
  db.prepare(`DELETE FROM reputation_sources WHERE assessment_id = ?`).run(id);
  const stmt = db.prepare(
    `INSERT INTO reputation_sources
      (assessment_id, source_url, publisher_group, verification, observed_link,
       observed_mention, quality_estimate, supported_quality_points, relationship,
       context, relevance, access_error)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const s of result.sources) {
    stmt.run(
      id,
      s.source_url,
      s.publisher_group ?? null,
      s.verification ?? null,
      s.observed_link ? 1 : 0,
      s.observed_mention ? 1 : 0,
      s.quality_estimate,
      s.supported_quality_points,
      s.relationship,
      s.context,
      s.relevance,
      s.access_error,
    );
  }
}

export function getReputationAssessment(
  db: DatabaseSync,
  id: string,
): ReputationResult | null {
  const row = db
    .prepare(`SELECT result_json FROM reputation_assessments WHERE id = ?`)
    .get(id) as Row | undefined;
  if (!row?.result_json) return null;
  try {
    return JSON.parse(row.result_json) as ReputationResult;
  } catch {
    return null;
  }
}

export function listReputationAssessments(
  db: DatabaseSync,
  limit = 25,
  targetUrl?: string,
): Array<{
  id: string;
  target: string;
  brand: string;
  score: number | null;
  scoreStatus: string;
  confidence: string;
  sourcesChecked: number;
  createdAt: string;
}> {
  const sql = targetUrl
    ? `SELECT id, target_url, brand, score, score_status, confidence, sources_checked, created_at
       FROM reputation_assessments WHERE target_url = ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT id, target_url, brand, score, score_status, confidence, sources_checked, created_at
       FROM reputation_assessments ORDER BY created_at DESC LIMIT ?`;
  const rows = (
    targetUrl
      ? (db.prepare(sql).all(targetUrl, limit) as Row[])
      : (db.prepare(sql).all(limit) as Row[])
  );
  return rows.map((r) => ({
    id: r.id,
    target: r.target_url,
    brand: r.brand ?? "",
    score: r.score,
    scoreStatus: r.score_status,
    confidence: r.confidence,
    sourcesChecked: r.sources_checked,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Competitor comparisons
// ---------------------------------------------------------------------------

export function saveCompetitorComparison(
  db: DatabaseSync,
  comparison: CompetitorComparison,
  id: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO competitor_comparisons
      (id, baseline_url, baseline_crawl_id, competitor_urls_json, result_json, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(
    id,
    comparison.baselineUrl,
    comparison.baselineCrawlId ?? null,
    JSON.stringify(comparison.competitorUrls),
    JSON.stringify(comparison),
    new Date().toISOString(),
  );
}

export function getCompetitorComparison(
  db: DatabaseSync,
  id: string,
): CompetitorComparison | null {
  const row = db
    .prepare(`SELECT result_json FROM competitor_comparisons WHERE id = ?`)
    .get(id) as Row | undefined;
  if (!row?.result_json) return null;
  try {
    return JSON.parse(row.result_json) as CompetitorComparison;
  } catch {
    return null;
  }
}

export function listCompetitorComparisons(
  db: DatabaseSync,
  limit = 25,
  baselineUrl?: string,
): Array<{ id: string; baselineUrl: string; competitorUrls: string[]; createdAt: string }> {
  const sql = baselineUrl
    ? `SELECT id, baseline_url, competitor_urls_json, created_at FROM competitor_comparisons
       WHERE baseline_url = ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT id, baseline_url, competitor_urls_json, created_at FROM competitor_comparisons
       ORDER BY created_at DESC LIMIT ?`;
  const rows = (
    baselineUrl
      ? (db.prepare(sql).all(baselineUrl, limit) as Row[])
      : (db.prepare(sql).all(limit) as Row[])
  );
  return rows.map((r) => ({
    id: r.id,
    baselineUrl: r.baseline_url,
    competitorUrls: tryParse(r.competitor_urls_json, []) as string[],
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Publishing plans
// ---------------------------------------------------------------------------

export function savePublishingPlan(db: DatabaseSync, plan: PublishingPlan, id: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO publishing_plans
      (id, business, website, selected_sources, requested_sources, result_json, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    id,
    plan.business,
    plan.website,
    plan.selected_sources,
    plan.requested_sources,
    JSON.stringify(plan),
    plan.created_on,
  );
}

export function getPublishingPlan(db: DatabaseSync, id: string): PublishingPlan | null {
  const row = db
    .prepare(`SELECT result_json FROM publishing_plans WHERE id = ?`)
    .get(id) as Row | undefined;
  if (!row?.result_json) return null;
  try {
    return JSON.parse(row.result_json) as PublishingPlan;
  } catch {
    return null;
  }
}

export function listPublishingPlans(
  db: DatabaseSync,
  limit = 25,
  website?: string,
): Array<{ id: string; business: string; website: string; selectedSources: number; createdAt: string }> {
  const sql = website
    ? `SELECT id, business, website, selected_sources, created_at FROM publishing_plans
       WHERE website = ? ORDER BY created_at DESC LIMIT ?`
    : `SELECT id, business, website, selected_sources, created_at FROM publishing_plans
       ORDER BY created_at DESC LIMIT ?`;
  const rows = website
    ? (db.prepare(sql).all(website, limit) as Row[])
    : (db.prepare(sql).all(limit) as Row[]);
  return rows.map((r) => ({
    id: r.id,
    business: r.business,
    website: r.website,
    selectedSources: r.selected_sources,
    createdAt: r.created_at,
  }));
}

function tryParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
