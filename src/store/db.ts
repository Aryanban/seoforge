/**
 * SQLite persistence layer (native node:sqlite — no native build step).
 * Stores crawl runs, pages, issues, links, sitemap URLs, and recommendations
 * to power trend charts and fast filtered queries in the dashboard.
 */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { DomainSnapshot } from "../types.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS crawls (
  id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  domain_name TEXT,
  project TEXT,
  strategy TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  total_urls INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  total_warnings INTEGER DEFAULT 0,
  total_notices INTEGER DEFAULT 0,
  average_aeo_score INTEGER DEFAULT 0,
  max_depth INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  robots_accessible INTEGER,
  sitemap_accessible INTEGER,
  sitemap_url_count INTEGER DEFAULT 0,
  options_json TEXT
);

CREATE TABLE IF NOT EXISTS pages (
  crawl_id TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  final_url TEXT,
  status INTEGER,
  response_time_ms INTEGER,
  ttfb_ms INTEGER,
  depth INTEGER,
  rendered INTEGER DEFAULT 0,
  canonical TEXT,
  canonical_matches INTEGER DEFAULT 0,
  title TEXT,
  description TEXT,
  h1_text TEXT,
  word_count INTEGER DEFAULT 0,
  h1_count INTEGER DEFAULT 0,
  h2_count INTEGER DEFAULT 0,
  incoming_links INTEGER DEFAULT 0,
  outgoing_links INTEGER DEFAULT 0,
  external_links INTEGER DEFAULT 0,
  is_orphan INTEGER DEFAULT 0,
  internal_link_score INTEGER DEFAULT 0,
  is_indexable INTEGER DEFAULT 1,
  aeo_score INTEGER DEFAULT 0,
  schema_types TEXT,
  PRIMARY KEY (crawl_id, normalized_url)
);
CREATE INDEX IF NOT EXISTS idx_pages_crawl ON pages(crawl_id);

CREATE TABLE IF NOT EXISTS issues (
  crawl_id TEXT NOT NULL,
  page_url TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  name TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_issues_crawl ON issues(crawl_id);
CREATE INDEX IF NOT EXISTS idx_issues_crawl_sev ON issues(crawl_id, severity);

CREATE TABLE IF NOT EXISTS links (
  crawl_id TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  anchor_text TEXT,
  nofollow INTEGER DEFAULT 0,
  is_internal INTEGER DEFAULT 1,
  target_status INTEGER,
  is_broken INTEGER DEFAULT 0,
  is_redirect INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_links_crawl ON links(crawl_id);

CREATE TABLE IF NOT EXISTS sitemap_urls (
  crawl_id TEXT NOT NULL,
  url TEXT NOT NULL,
  lastmod TEXT,
  source TEXT
);
CREATE INDEX IF NOT EXISTS idx_sitemap_crawl ON sitemap_urls(crawl_id);

CREATE TABLE IF NOT EXISTS recommendations (
  crawl_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  name TEXT NOT NULL,
  severity TEXT,
  category TEXT,
  affected_pages INTEGER DEFAULT 0,
  change INTEGER DEFAULT 0,
  priority TEXT,
  effort TEXT,
  recommendation TEXT,
  markdown TEXT,
  PRIMARY KEY (crawl_id, issue_id)
);

CREATE TABLE IF NOT EXISTS reputation_assessments (
  id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  brand TEXT,
  score REAL,
  score_status TEXT,
  confidence TEXT,
  sources_checked INTEGER DEFAULT 0,
  evidence_source TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reputation_target ON reputation_assessments(target_url);

CREATE TABLE IF NOT EXISTS reputation_sources (
  assessment_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  publisher_group TEXT,
  verification TEXT,
  observed_link INTEGER DEFAULT 0,
  observed_mention INTEGER DEFAULT 0,
  quality_estimate REAL,
  supported_quality_points REAL,
  relationship TEXT,
  context TEXT,
  relevance TEXT,
  access_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_repsources_assessment ON reputation_sources(assessment_id);

CREATE TABLE IF NOT EXISTS competitor_comparisons (
  id TEXT PRIMARY KEY,
  baseline_url TEXT NOT NULL,
  baseline_crawl_id TEXT,
  competitor_urls_json TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_competitors_baseline ON competitor_comparisons(baseline_url);

CREATE TABLE IF NOT EXISTS publishing_plans (
  id TEXT PRIMARY KEY,
  business TEXT NOT NULL,
  website TEXT NOT NULL,
  selected_sources INTEGER DEFAULT 0,
  requested_sources INTEGER DEFAULT 0,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_website ON publishing_plans(website);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL,
  candidate_count INTEGER DEFAULT 0,
  queries_processed INTEGER DEFAULT 0,
  search_available INTEGER DEFAULT 0,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_target ON discovery_runs(target_url);
`;

export interface StoreOptions {
  dbPath?: string;
}

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export function defaultDbPath(baseDir: string = process.cwd()): string {
  return path.join(baseDir, "reports", "seoforge.db");
}

export function openStore(dbPath?: string): DatabaseSync {
  const resolved = dbPath || defaultDbPath();
  if (dbInstance && currentDbPath === resolved) return dbInstance;

  if (dbInstance) dbInstance.close();
  fs.mkdir(path.dirname(resolved), { recursive: true }).catch(() => {});
  ensureDirSync(resolved);

  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(SCHEMA_SQL);
  dbInstance = db;
  currentDbPath = resolved;
  return db;
}

function ensureDirSync(filePath: string): void {
  try {
    const dir = path.dirname(filePath);
    fsSync.mkdirSync(dir, { recursive: true });
  } catch {
    /* directory may already exist */
  }
}

export function closeStore(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    currentDbPath = null;
  }
}

/**
 * Migrate legacy flat-JSON snapshots (reports/.snapshots/*.json) into the
 * store so historical change-deltas survive the upgrade.
 */
export async function migrateLegacySnapshots(baseDir: string = process.cwd()): Promise<number> {
  const snapshotDir = path.join(baseDir, "reports", ".snapshots");
  let files: string[];
  try {
    files = await fs.readdir(snapshotDir);
  } catch {
    return 0;
  }

  const db = openStore(path.join(baseDir, "reports", "seoforge.db"));
  let migrated = 0;

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(snapshotDir, file), "utf-8");
      const snapshot = JSON.parse(raw) as DomainSnapshot;
      if (!snapshot?.pages) continue;

      const crawlId = `legacy_${file.replace(/\.json$/, "")}`;
      const existing = db.prepare("SELECT 1 FROM crawls WHERE id = ?").get(crawlId);
      if (existing) continue;

      db.prepare(
        `INSERT INTO crawls (id, target_url, strategy, status, started_at, total_urls, passed, options_json)
         VALUES (?, ?, 'config', 'completed', ?, ?, 0, '{}')`
      ).run(crawlId, snapshot.domainUrl, snapshot.crawlDate, Object.keys(snapshot.pages).length);

      const insertPage = db.prepare(
        `INSERT OR IGNORE INTO pages (crawl_id, url, normalized_url, title, description, canonical, h1_text, word_count, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const page of Object.values(snapshot.pages)) {
        insertPage.run(
          crawlId,
          page.url,
          page.url.toLowerCase(),
          page.title ?? null,
          page.description ?? null,
          page.canonical ?? null,
          page.h1Text ?? null,
          page.wordCount ?? 0,
          page.status ?? 0
        );
      }
      migrated++;
    } catch {
      /* skip unreadable snapshot */
    }
  }

  return migrated;
}
