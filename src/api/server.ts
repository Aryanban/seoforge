/**
 * Local REST API server — exposes the crawl engine, issue store, and reports
 * to the web dashboard, and doubles as a programmatic interface for any HTTP
 * client (not just MCP agents). Binds to loopback only by default.
 */
import fs from "fs/promises";
import path from "path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  CrawlOptions,
  CrawlProgress,
  CrawlResult,
  SeoForgeConfig,
} from "../types.js";
import { Crawler, crawlSite } from "../crawl/crawler.js";
import { openStore, closeStore, migrateLegacySnapshots } from "../store/db.js";
import * as repo from "../store/repository.js";
import { loadConfig } from "../config.js";
import { generateCrawlMarkdown } from "../report/markdown.js";
import { toCsv, CsvKind } from "../report/csv.js";
import { generateHtmlReport } from "../report/html.js";
import { auditSinglePage } from "../audit-page.js";
import {
  loadSources,
  catalogSize,
  buildPlan,
  planMarkdown,
  type PostingProfile,
} from "../publishing/index.js";
import {
  checkSources,
  assess,
  reputationMarkdown,
  type SourceRow,
} from "../reputation/index.js";
import { compareCompetitors, comparisonMarkdown } from "../competitors/index.js";
import {
  discover,
  discoveryMarkdown,
  sourcesCsv,
  candidatesToRows,
  hostAttempts,
  type HostRecord,
  type NativeProvider,
  type SavedSearch,
  type SearchQuery,
} from "../discovery/index.js";
import { analyzeContent } from "../content-analyzer.js";
import {
  generateArticleSchema,
  generateFaqSchema,
  generateLocalBusinessSchema,
  generateBreadcrumbSchema,
  generateRecommendedSchemas,
  formatSchemaScript,
} from "../schema-generator.js";
import { findInternalLinkOpportunities } from "../link-opportunities.js";
import { analyzeAnchorProfile } from "../anchor-analyzer.js";
import { compareCrawls, formatCrawlDiffMarkdown } from "../analysis/crawl-diff.js";
import { analyzeLogs } from "../analysis/log-parser.js";
import { detectCannibalization } from "../analysis/cannibalization.js";
import { extractCustomFields, CustomExtractorRule } from "../analysis/custom-extractor.js";
import { scoreContent } from "../analysis/live-content-scorer.js";
import { generateCodePatch } from "../analysis/code-patcher.js";
import { evaluateCiGate } from "../analysis/ci-gate.js";
import { analyzeLinkIntersect } from "../analysis/link-intersect.js";
import { analyzeContentGap } from "../analysis/content-gap.js";
import { testRobotsPath, auditRobotsAiCompliance } from "../analysis/robots-simulator.js";
import { analyzeRedirectChain, generateDirectRedirectCode } from "../analysis/redirect-tracer.js";
import { analyzePageSpeedLab } from "../analysis/pagespeed-lab.js";
import { fetchPage } from "../crawl/fetcher.js";
import {
  classifySearchIntent,
  estimateKeywordDifficulty,
  generateKeywordVariations,
  auditSearchIntentAlignment,
} from "../keyword-intelligence.js";
import {
  timesfmForecast,
  forecastCrawlTrend,
  formatTimesfmMarkdown,
} from "../forecasting/index.js";

interface RunningJob {
  crawler: Crawler;
  crawlId: string;
  targetUrl: string;
  startedAt: string;
  lastProgress?: CrawlProgress;
  result?: CrawlResult;
  subscribers: Set<(data: string) => void>;
}

const jobs = new Map<string, RunningJob>();
const completed = new Map<string, CrawlResult>();
const MAX_COMPLETED = 20;

function getJob(crawlId: string): RunningJob | undefined {
  return jobs.get(crawlId);
}

function rememberResult(crawlId: string, result: CrawlResult): void {
  completed.set(crawlId, result);
  if (completed.size > MAX_COMPLETED) {
    const first = completed.keys().next().value;
    if (first) completed.delete(first);
  }
}

export interface ServerOptions {
  port?: number;
  host?: string;
  open?: boolean;
  configPath?: string;
  baseDir?: string;
}

export function createServer(options: ServerOptions = {}): Hono {
  const app = new Hono();
  const baseDir = options.baseDir || process.cwd();
  const db = openStore(path.join(baseDir, "reports", "seoforge.db"));

  migrateLegacySnapshots(baseDir).catch(() => {});

  /* ---------------------------------------------------------------- */
  /* Health + config                                                  */
  /* ---------------------------------------------------------------- */

  app.get("/api/health", (c) =>
    c.json({
      status: "ok",
      version: "2.0.0",
      running: jobs.size,
      completed: completed.size,
    })
  );

  app.get("/api/config", async (c) => {
    try {
      const config = await loadConfig(options.configPath);
      return c.json(config);
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.put("/api/config", async (c) => {
    try {
      const body = (await c.req.json()) as SeoForgeConfig;
      const configPath = path.resolve(baseDir, options.configPath || "seoforge.config.json");
      await fs.writeFile(configPath, JSON.stringify(body, null, 2), "utf-8");
      return c.json({ saved: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Crawl lifecycle                                                  */
  /* ---------------------------------------------------------------- */

  app.post("/api/crawl", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        url?: string;
        domain?: string;
        options?: CrawlOptions;
      };

      let targetUrl = body.url;
      let project: string | undefined;
      let domainName: string | undefined;
      let paths: string[] | undefined;
      let expectedEntities: string[] | undefined;
      let thresholds: any;

      if (!targetUrl) {
        const config = await loadConfig(options.configPath);
        const match = body.domain
          ? config.domains.find(
              (d) =>
                d.name.toLowerCase().includes(body.domain!.toLowerCase()) ||
                d.url.toLowerCase().includes(body.domain!.toLowerCase())
            )
          : config.domains[0];
        if (!match) return c.json({ error: "No domain configured" }, 400);
        targetUrl = match.url;
        project = config.project;
        domainName = match.name;
        paths = match.paths;
        expectedEntities = match.expectedEntities;
        thresholds = config.thresholds;
      }

      const opts: any = { ...(body.options || {}) };
      if (paths) opts.paths = paths;
      if (expectedEntities) opts.expectedEntities = expectedEntities;
      if (thresholds) opts.thresholds = thresholds;

      const crawler = new Crawler();
      const crawlId = `crawl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const job: RunningJob = {
        crawler,
        crawlId,
        targetUrl: targetUrl!,
        startedAt: new Date().toISOString(),
        subscribers: new Set(),
      };
      jobs.set(crawlId, job);

      crawler.on("progress", (progress: CrawlProgress) => {
        job.lastProgress = progress;
        broadcast(job, { type: "progress", ...progress });
      });
      crawler.on("page", (page) => broadcast(job, { type: "page", url: page.url, status: page.status }));
      crawler.on("issue", (issue) => broadcast(job, { type: "issue", issue }));

      const previousCounts = repo.getPreviousIssueCounts(db, targetUrl!);
      crawler.setPreviousIssueCounts(previousCounts);

      // Run asynchronously; notify SSE subscribers and persist on completion.
      crawler.crawl(targetUrl!, opts).then((result) => {
        const full: CrawlResult = {
          ...result,
          id: crawlId,
          project,
          domainName,
        };
        rememberResult(crawlId, full);
        try {
          repo.saveCrawl(db, full);
        } catch (err) {
          console.error("Failed to persist crawl:", err);
        }
        job.result = full;
        broadcast(job, { type: "done", crawlId, result: summarize(full) });
        setTimeout(() => {
          jobs.delete(crawlId);
          job.subscribers.clear();
        }, 60000);
      });

      return c.json({ crawlId, targetUrl, options: opts, status: "running" });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/crawl/:id/stop", (c) => {
    const job = getJob(c.req.param("id"));
    if (!job) return c.json({ error: "Crawl not found or already finished" }, 404);
    job.crawler.stop();
    return c.json({ stopped: true, crawlId: job.crawlId });
  });

  app.get("/api/crawl/:id/progress", (c) => {
    const job = getJob(c.req.param("id"));
    if (job) return c.json(job.lastProgress || { crawlId: job.crawlId, status: "running" });
    return c.json({ error: "Crawl not found" }, 404);
  });

  // Server-sent events: live crawl progress for the dashboard.
  app.get("/api/crawl/:id/stream", (c) =>
    streamSSE(c, async (stream) => {
      const crawlId = c.req.param("id");
      const job = getJob(crawlId);

      const send = (data: string) => {
        stream.writeSSE({ event: "progress", data }).catch(() => {});
      };

      if (!job) {
        const stored = completed.get(crawlId);
        if (stored) {
          await stream.writeSSE({ event: "done", data: JSON.stringify(summarize(stored)) });
        } else {
          await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "Crawl not found" }) });
        }
        return;
      }

      job.subscribers.add(send);
      if (job.lastProgress) await stream.writeSSE({ event: "progress", data: JSON.stringify(job.lastProgress) });

      // Keep connection open using event-driven notification rather than spin-polling
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          job.subscribers.delete(send);
          resolve();
        };
        job.crawler.once("done", cleanup);
        c.req.raw.signal.addEventListener("abort", cleanup, { once: true });
        if (job.result !== undefined || !jobs.has(crawlId)) cleanup();
      });
    })
  );

  /* ---------------------------------------------------------------- */
  /* Queries                                                          */
  /* ---------------------------------------------------------------- */

  app.get("/api/crawls", (c) => {
    const limit = parseInt(c.req.query("limit") || "25", 10);
    const targetUrl = c.req.query("url");
    return c.json(repo.listCrawls(db, limit, targetUrl));
  });

  app.get("/api/crawl/:id", (c) => {
    const crawlId = c.req.param("id");
    const inMemory = completed.get(crawlId) || jobs.get(crawlId)?.result;
    if (inMemory) return c.json(summarize(inMemory));
    const stored = repo.getCrawl(db, crawlId);
    if (!stored) return c.json({ error: "Crawl not found" }, 404);
    return c.json(summarize(stored));
  });

  app.get("/api/crawl/:id/issues", (c) => {
    const crawlId = c.req.param("id");
    return c.json(
      repo.getIssues(db, crawlId, {
        severity: c.req.query("severity"),
        category: c.req.query("category"),
        search: c.req.query("search"),
        page: c.req.query("page") ? parseInt(c.req.query("page")!, 10) : undefined,
        pageSize: c.req.query("pageSize") ? parseInt(c.req.query("pageSize")!, 10) : undefined,
      })
    );
  });

  app.get("/api/crawl/:id/issue-urls", (c) => {
    const crawlId = c.req.param("id");
    const name = c.req.query("name");
    if (!name) return c.json({ error: "name query param required" }, 400);
    return c.json(repo.getIssueUrls(db, crawlId, name));
  });

  app.get("/api/crawl/:id/pages", (c) => {
    const crawlId = c.req.param("id");
    return c.json(
      repo.getPages(db, crawlId, {
        search: c.req.query("search"),
        status: c.req.query("status"),
        isOrphan: c.req.query("orphan") === "1",
        minAeo: c.req.query("minAeo") ? parseInt(c.req.query("minAeo")!, 10) : undefined,
        page: c.req.query("page") ? parseInt(c.req.query("page")!, 10) : undefined,
        pageSize: c.req.query("pageSize") ? parseInt(c.req.query("pageSize")!, 10) : undefined,
      })
    );
  });

  app.get("/api/crawl/:id/links", (c) => {
    const crawlId = c.req.param("id");
    return c.json(
      repo.getLinks(db, crawlId, {
        kind: c.req.query("kind") as any,
        search: c.req.query("search"),
        page: c.req.query("page") ? parseInt(c.req.query("page")!, 10) : undefined,
        pageSize: c.req.query("pageSize") ? parseInt(c.req.query("pageSize")!, 10) : undefined,
      })
    );
  });

  app.get("/api/crawl/:id/link-opportunities", (c) => {
    const crawlId = c.req.param("id");
    const full = completed.get(crawlId) || jobs.get(crawlId)?.result || repo.getFullCrawl(db, crawlId);
    if (!full) return c.json({ error: "Crawl not found" }, 404);
    const pages = full.pages || [];
    const links = full.links || [];
    const minScore = c.req.query("minScore") ? parseInt(c.req.query("minScore")!, 10) : 20;
    const opportunities = findInternalLinkOpportunities(pages, links, { minScore });
    return c.json({ total: opportunities.length, opportunities });
  });

  app.get("/api/crawl/:id/anchor-profile", (c) => {
    const crawlId = c.req.param("id");
    const full = completed.get(crawlId) || jobs.get(crawlId)?.result || repo.getFullCrawl(db, crawlId);
    if (!full) return c.json({ error: "Crawl not found" }, 404);
    const links = full.links || [];
    const brandName = c.req.query("brandName") || full.domainName || full.project;
    const report = analyzeAnchorProfile(links, { brandName });
    return c.json(report);
  });

  app.get("/api/crawl/:id/recommendations", (c) => {
    return c.json(repo.getRecommendations(db, c.req.param("id")));
  });

  app.get("/api/crawl/:id/sitemap", (c) => {
    return c.json(repo.getSitemapUrls(db, c.req.param("id"), 500));
  });

  app.get("/api/crawl/:id/trend", (c) => {
    const base = completed.get(c.req.param("id")) || repo.getCrawl(db, c.req.param("id"));
    if (!base) return c.json([]);
    return c.json(repo.getTrend(db, base.targetUrl));
  });

  app.get("/api/crawl/:id/forecast", (c) => {
    const base = completed.get(c.req.param("id")) || repo.getCrawl(db, c.req.param("id"));
    if (!base) return c.json({ error: "Crawl not found" }, 404);
    const metric = (c.req.query("metric") as any) || "aeo";
    const horizon = parseInt(c.req.query("horizon") || "7", 10) || 7;
    const freq = (c.req.query("freq") as any) || "crawl";
    try {
      const forecast = forecastCrawlTrend(db, base.targetUrl, metric, { horizon, freq });
      return c.json(forecast);
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  app.post("/api/forecast", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.series || !Array.isArray(body.series)) {
      return c.json({ error: "Missing required 'series' array in body" }, 400);
    }
    const horizon = parseInt(body.horizon || "7", 10) || 7;
    const freq = body.freq || "daily";
    try {
      const forecast = timesfmForecast(body.series, {
        horizon,
        freq,
        metricName: body.metric || "Time Series",
      });
      return c.json(forecast);
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Exports                                                          */
  /* ---------------------------------------------------------------- */

  app.get("/api/crawl/:id/export/:kind", (c) => {
    const crawlId = c.req.param("id");
    const kind = c.req.param("kind") as CsvKind | "md" | "html";
    let result = completed.get(crawlId);
    if (!result) {
      const full = repo.getFullCrawl(db, crawlId);
      if (full) {
        result = full;
        rememberResult(crawlId, full);
      }
    }
    if (!result) return c.json({ error: "Crawl not found" }, 404);

    if (kind === "md") {
      return c.body(generateCrawlMarkdown(result), 200, { "Content-Type": "text/markdown; charset=utf-8" });
    }
    if (kind === "html") {
      return c.html(generateHtmlReport(result));
    }
    if (["pages", "issues", "links", "recommendations"].includes(kind)) {
      return c.body(toCsv(result, kind as CsvKind), 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="seoforge-${kind}.csv"`,
      });
    }
    return c.json({ error: "Unknown export kind" }, 400);
  });

  /* ---------------------------------------------------------------- */
  /* Single-page inspect                                              */
  /* ---------------------------------------------------------------- */

  app.post("/api/inspect", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        url: string;
        render?: boolean;
        expectedEntities?: string[];
        canonicalPolicy?: "strict" | "spa";
        targetKeyword?: string;
      };
      if (!body.url) return c.json({ error: "url is required" }, 400);
      const result = await auditSinglePage(body.url, {
        render: body.render,
        expectedEntities: body.expectedEntities,
        canonicalPolicy: body.canonicalPolicy,
        targetKeyword: body.targetKeyword,
      });
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/tools/content-analyze", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        html?: string;
        url?: string;
        targetKeyword?: string;
      };
      if (!body.html && !body.url) {
        return c.json({ error: "Either html or url is required" }, 400);
      }
      let html = body.html || "";
      if (!html && body.url) {
        const { page } = await auditSinglePage(body.url);
        // If audit fetched HTML, analyze it
        const res = analyzeContent(html || "", { url: body.url, targetKeyword: body.targetKeyword });
        return c.json({ url: body.url, analysis: res });
      }
      const analysis = analyzeContent(html, { url: body.url, targetKeyword: body.targetKeyword });
      return c.json({ analysis });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/tools/schema-generate", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        type: "Article" | "FAQPage" | "LocalBusiness" | "BreadcrumbList";
        data: any;
      };
      let schema: object;
      if (body.type === "Article") {
        schema = generateArticleSchema(body.data);
      } else if (body.type === "FAQPage") {
        schema = generateFaqSchema(body.data.items || []);
      } else if (body.type === "LocalBusiness") {
        schema = generateLocalBusinessSchema(body.data);
      } else if (body.type === "BreadcrumbList") {
        schema = generateBreadcrumbSchema(body.data.url, body.data.homeName);
      } else {
        return c.json({ error: `Unsupported schema type: ${body.type}` }, 400);
      }
      return c.json({
        schema,
        scriptTag: formatSchemaScript(schema),
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/tools/keyword-intelligence", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        keyword?: string;
        pageContext?: any;
      };
      if (!body.keyword || !body.keyword.trim()) {
        return c.json({ error: "keyword field is required" }, 400);
      }
      const kw = body.keyword.trim();
      const intent = classifySearchIntent(kw);
      const difficulty = estimateKeywordDifficulty(kw);
      const variations = generateKeywordVariations(kw);
      const alignment = body.pageContext
        ? auditSearchIntentAlignment(kw, body.pageContext)
        : undefined;

      return c.json({
        keyword: kw,
        intent,
        difficulty,
        variations,
        alignment,
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Publishing catalog + plans (ported from BeyondSEO)               */
  /* ---------------------------------------------------------------- */

  app.get("/api/publish/catalog", (c) => {
    const rows = loadSources({
      category: c.req.query("category") || undefined,
      kind: c.req.query("kind") || undefined,
      status: c.req.query("status") || undefined,
    });
    const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : rows.length;
    return c.json({ total: catalogSize(), matching: rows.length, entries: rows.slice(0, limit) });
  });

  app.post("/api/publish/plan", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as PostingProfile & { limit?: number };
      const plan = buildPlan(body, loadSources(), { limit: body.limit ?? 15 });
      const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      repo.savePublishingPlan(db, plan, id);
      return c.json({ planId: id, plan, markdown: planMarkdown(plan) });
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.get("/api/publish/plans", (c) => {
    const website = c.req.query("website") || undefined;
    return c.json({ plans: repo.listPublishingPlans(db, 25, website) });
  });

  app.get("/api/publish/plans/:id", (c) => {
    const plan = repo.getPublishingPlan(db, c.req.param("id"));
    if (!plan) return c.json({ error: "Plan not found" }, 404);
    return c.json({ plan, markdown: planMarkdown(plan) });
  });

  /* ---------------------------------------------------------------- */
  /* Reputation assessment (model 1.1)                                */
  /* ---------------------------------------------------------------- */

  app.post("/api/reputation", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        target_url: string;
        brand: string;
        sources: string[];
        aliases?: string[];
        related_hosts?: string[];
        limit?: number;
        search_pages?: number;
        render?: boolean;
      };
      if (!body.target_url || !body.brand) return c.json({ error: "target_url and brand are required" }, 400);
      if (!body.sources || body.sources.length === 0) return c.json({ error: "sources[] is required" }, 400);
      const rows: SourceRow[] = body.sources.map((url) => ({ URL: url }));
      const verification = await checkSources(rows, body.target_url, {
        limit: body.limit ?? 30,
        render: !!body.render,
        brand: body.brand,
        aliases: body.aliases ?? [],
      });
      const result = assess(verification, {
        relatedHosts: body.related_hosts ?? [],
        requestedSearchPages: body.search_pages ?? 5,
      });
      const id = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      result.evidence_source = id;
      repo.saveReputationAssessment(db, result, id);
      return c.json({ assessmentId: id, result, markdown: reputationMarkdown(result) });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/reputation", (c) => {
    const targetUrl = c.req.query("target") || undefined;
    return c.json({ assessments: repo.listReputationAssessments(db, 25, targetUrl) });
  });

  app.get("/api/reputation/:id", (c) => {
    const result = repo.getReputationAssessment(db, c.req.param("id"));
    if (!result) return c.json({ error: "Assessment not found" }, 404);
    return c.json({ result, markdown: reputationMarkdown(result) });
  });

  /* ---------------------------------------------------------------- */
  /* Competitor comparison                                            */
  /* ---------------------------------------------------------------- */

  app.post("/api/competitors/compare", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        crawl_id?: string;
        competitor_crawl_ids?: string[];
        target_url?: string;
        competitor_urls?: string[];
        limit?: number;
      };
      let baseline: CrawlResult | null = null;
      const competitors: CrawlResult[] = [];
      if (body.target_url) {
        if (!body.competitor_urls?.length) return c.json({ error: "competitor_urls is required with target_url" }, 400);
        if (body.competitor_urls.length > 5) return c.json({ error: "Compare at most five competitors" }, 400);
        const budget = body.limit ?? 50;
        baseline = await crawlSite(body.target_url, { limit: budget, maxDepth: 3, respectRobots: true });
        for (const u of body.competitor_urls) {
          competitors.push(await crawlSite(u, { limit: budget, maxDepth: 3, respectRobots: true }));
        }
      } else {
        const ids = body.competitor_crawl_ids ?? [];
        if (ids.length === 0) return c.json({ error: "competitor_crawl_ids or target_url+competitor_urls is required" }, 400);
        if (ids.length > 5) return c.json({ error: "Compare at most five competitors" }, 400);
        if (body.crawl_id) baseline = repo.getFullCrawl(db, body.crawl_id);
        else {
          const latest = repo.listCrawls(db, 1)[0];
          if (latest) baseline = repo.getFullCrawl(db, latest.id);
        }
        if (!baseline) return c.json({ error: "Baseline crawl not found" }, 404);
        for (const id of ids) {
          const found = repo.getFullCrawl(db, id);
          if (!found) return c.json({ error: `Competitor crawl '${id}' not found` }, 404);
          competitors.push(found);
        }
      }
      const comparison = compareCompetitors(baseline as CrawlResult, competitors);
      const id = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      repo.saveCompetitorComparison(db, comparison, id);
      return c.json({ comparisonId: id, comparison, markdown: comparisonMarkdown(comparison) });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/competitors", (c) => {
    const baselineUrl = c.req.query("baseline") || undefined;
    return c.json({ comparisons: repo.listCompetitorComparisons(db, 25, baselineUrl) });
  });

  app.get("/api/competitors/:id", (c) => {
    const comparison = repo.getCompetitorComparison(db, c.req.param("id"));
    if (!comparison) return c.json({ error: "Comparison not found" }, 404);
    return c.json({ comparison, markdown: comparisonMarkdown(comparison) });
  });

  /* ---------------------------------------------------------------- */
  /* Discovery (search leads)                                         */
  /* ---------------------------------------------------------------- */

  app.post("/api/discover", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        target_url: string;
        queries?: SearchQuery[];
        providers?: NativeProvider[];
        candidates?: string[];
        saved_searches?: SavedSearch[];
        host_records?: HostRecord[];
        offline?: boolean;
        max_requests?: number;
        max_queries?: number;
        max_candidates?: number;
        timeout_seconds?: number;
        seconds?: number;
        out_dir?: string;
      };
      if (!body.target_url) return c.json({ error: "target_url is required" }, 400);
      if (
        !(body.queries?.length || body.candidates?.length || body.saved_searches?.length || body.host_records?.length)
      ) {
        return c.json({ error: "Provide queries[], candidates[], saved_searches[] or host_records[]" }, 400);
      }
      const outDir = body.out_dir ?? path.join(baseDir, "reports", "discovery");
      const result = await discover(body.queries ?? [], outDir, {
        target: body.target_url,
        providers: body.providers,
        hostRecords: body.host_records?.length ? hostAttempts(body.host_records) : [],
        candidates: body.candidates ?? [],
        saved: body.saved_searches ?? [],
        offline: !!body.offline,
        maxRequests: body.max_requests,
        maxQueries: body.max_queries,
        maxCandidates: body.max_candidates,
        timeoutMs: body.timeout_seconds ? body.timeout_seconds * 1000 : undefined,
        seconds: body.seconds,
      });
      await fs.writeFile(
        path.join(outDir, "sources.csv"),
        sourcesCsv(candidatesToRows(result.candidates)),
      );
      await fs.writeFile(path.join(outDir, "discovery.md"), discoveryMarkdown(result));
      const id = `disc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      repo.saveDiscoveryRun(db, result, id);
      return c.json({
        discoveryId: id,
        result,
        markdown: discoveryMarkdown(result),
        sources_csv: path.join(outDir, "sources.csv"),
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/discover", (c) => {
    const targetUrl = c.req.query("target") || undefined;
    return c.json({ runs: repo.listDiscoveryRuns(db, 25, targetUrl) });
  });

  app.get("/api/discover/:id", (c) => {
    const result = repo.getDiscoveryRun(db, c.req.param("id"));
    if (!result) return c.json({ error: "Discovery run not found" }, 404);
    return c.json({ result, markdown: discoveryMarkdown(result) });
  });


  /* ---------------------------------------------------------------- */
  /* Competitive Superpower Endpoints (Diff, Logs, Cannibalization,  */
  /* Live Content Scorer, Codebase Patcher, CI Gate)                 */
  /* ---------------------------------------------------------------- */

  app.post("/api/diff", async (c) => {
    try {
      const body = await c.req.json();
      const baseId = body.baseCrawlId;
      const targetId = body.targetCrawlId;
      if (!baseId || !targetId) return c.json({ error: "baseCrawlId and targetCrawlId are required" }, 400);
      const base = completed.get(baseId) || repo.getFullCrawl(db, baseId);
      const target = completed.get(targetId) || repo.getFullCrawl(db, targetId);
      if (!base) return c.json({ error: `Base crawl '${baseId}' not found` }, 404);
      if (!target) return c.json({ error: `Target crawl '${targetId}' not found` }, 404);
      const diff = compareCrawls(base, target);
      return c.json({ diff, markdown: formatCrawlDiffMarkdown(diff) });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/logs/audit", async (c) => {
    try {
      const body = await c.req.json();
      const logContent = body.logContent;
      if (!logContent) return c.json({ error: "logContent is required" }, 400);
      let knownPages: Array<{ url: string; status: number; isIndexable: boolean }> | undefined;
      if (body.crawlId) {
        const crawl = completed.get(body.crawlId) || repo.getFullCrawl(db, body.crawlId);
        if (crawl) knownPages = crawl.pages.map((p) => ({ url: p.url, status: p.status, isIndexable: p.isIndexable }));
      }
      const report = analyzeLogs(logContent, { knownPages });
      return c.json(report);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/crawls/:id/cannibalization", (c) => {
    const crawlId = c.req.param("id");
    const crawl = completed.get(crawlId) || repo.getFullCrawl(db, crawlId);
    if (!crawl) return c.json({ error: "Crawl not found" }, 404);
    const report = detectCannibalization(crawl.pages);
    return c.json(report);
  });

  app.post("/api/content/score", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.body || !body.primaryKeyword) {
        return c.json({ error: "body and primaryKeyword are required" }, 400);
      }
      const report = scoreContent({
        body: body.body,
        primaryKeyword: body.primaryKeyword,
        title: body.title,
        secondaryKeywords: body.secondaryKeywords,
        targetWordCount: body.targetWordCount,
      });
      return c.json(report);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/codebase/patch", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.sourceCode || !body.issueId || !body.fixData) {
        return c.json({ error: "sourceCode, issueId, and fixData are required" }, 400);
      }
      const patch = generateCodePatch({
        sourceCode: body.sourceCode,
        issueId: body.issueId,
        filePath: body.filePath,
        fixData: body.fixData,
      });
      return c.json(patch);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/link-intersect", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.targetDomain || !body.competitors) {
        return c.json({ error: "targetDomain and competitors are required" }, 400);
      }
      const report = analyzeLinkIntersect({
        targetDomain: body.targetDomain,
        targetBacklinks: body.targetBacklinks,
        competitors: body.competitors,
        minCompetitorOverlap: body.minCompetitorOverlap,
      });
      return c.json(report);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/content-gap", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.baselineCrawlId || !body.competitorCrawlIds) {
        return c.json({ error: "baselineCrawlId and competitorCrawlIds are required" }, 400);
      }
      const base = completed.get(body.baselineCrawlId) || repo.getFullCrawl(db, body.baselineCrawlId);
      if (!base) return c.json({ error: "Baseline crawl not found" }, 404);

      const comps: CrawlResult[] = [];
      for (const cid of body.competitorCrawlIds) {
        const crawl = completed.get(cid) || repo.getFullCrawl(db, cid);
        if (crawl) comps.push(crawl);
      }
      if (comps.length === 0) return c.json({ error: "No competitor crawls found" }, 404);

      const report = analyzeContentGap(base, comps);
      return c.json(report);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/robots/test", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.robotsTxt) return c.json({ error: "robotsTxt is required" }, 400);
      if (body.path) {
        const res = testRobotsPath(body.robotsTxt, body.path, body.userAgent || "Googlebot");
        return c.json(res);
      }
      const samplePaths = body.samplePaths || ["/", "/blog", "/pricing", "/api", "/docs"];
      const audit = auditRobotsAiCompliance(body.robotsTxt, samplePaths);
      return c.json(audit);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/redirects/trace", async (c) => {
    try {
      const body = await c.req.json();
      let hops = body.hops || [];
      if (hops.length === 0 && body.url) {
        const fetched = await fetchPage(body.url, { followRedirects: true, maxRedirects: 10 });
        hops = fetched.redirectChain.map((u: string, idx: number) => ({
          url: u,
          status: idx === 0 && fetched.redirectStatusCode ? fetched.redirectStatusCode : idx === fetched.redirectChain.length - 1 ? fetched.status : 301,
        }));
      }
      const analysis = analyzeRedirectChain(hops);
      const code = generateDirectRedirectCode(analysis.initialUrl, analysis.finalUrl, body.framework || "nextjs");
      return c.json({ ...analysis, directRewriteSnippet: code });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/pagespeed/lab", async (c) => {
    try {
      const body = await c.req.json();
      let html = body.html || "";
      let ttfb = body.ttfbMs;
      if (!html && body.url) {
        const fetched = await fetchPage(body.url);
        html = fetched.html;
        ttfb = ttfb ?? fetched.ttfbMs;
      }
      const report = analyzePageSpeedLab({
        url: body.url || "",
        html,
        ttfbMs: ttfb,
      });
      return c.json(report);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/ci/gate", async (c) => {
    try {
      const body = await c.req.json();
      let crawl: CrawlResult | null = null;
      if (body.crawlId) {
        crawl = completed.get(body.crawlId) || repo.getFullCrawl(db, body.crawlId);
      } else {
        const latest = repo.listCrawls(db, 1)[0];
        if (latest) crawl = completed.get(latest.id) || repo.getFullCrawl(db, latest.id);
      }
      if (!crawl) return c.json({ error: "Crawl not found" }, 404);
      const gate = evaluateCiGate(crawl, {
        maxErrors: body.maxErrors,
        maxWarnings: body.maxWarnings,
        minAeoScore: body.minAeoScore,
      });
      return c.json(gate);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  /* ---------------------------------------------------------------- */
  /* Static dashboard (built web client)                              */
  /* ---------------------------------------------------------------- */
  app.use("/*", serveStatic({ root: path.relative(baseDir, path.join(baseDir, "dist", "web")) || "./" }));

  // Fallback index for SPA routes
  app.get("*", async (c) => {
    const indexPath = path.join(baseDir, "dist", "web", "index.html");
    try {
      const html = await fs.readFile(indexPath, "utf-8");
      return c.html(html);
    } catch {
      return c.body(
        "SEOForge dashboard not built. Run: npm run build:web\n\nAPI is live — see /api/health",
        200,
        { "Content-Type": "text/plain" }
      );
    }
  });

  return app;
}

export async function startServer(options: ServerOptions = {}): Promise<{ port: number; hostname: string }> {
  const port = options.port ?? 5173;
  const hostname = options.host ?? "127.0.0.1";
  const app = createServer(options);

  return new Promise((resolve, reject) => {
    serve({ fetch: app.fetch, port, hostname }, (info) => {
      const boundHost = (info as any).hostname || hostname;
      const url = `http://${boundHost}:${info.port}`;
      console.log(`\n⚡ SEOForge 2.0 dashboard →  ${url}\n`);
      if (options.open !== false) {
        import("open")
          .then((mod) => mod.default(url))
          .catch(() => {
            /* open is an optional package */
          });
      }
      resolve({ port: info.port, hostname: boundHost });
    }).on("error", reject);
  });
}

/* ------------------------------------------------------------------ */

function summarize(result: CrawlResult) {
  return {
    id: result.id,
    targetUrl: result.targetUrl,
    domainName: result.domainName,
    project: result.project,
    strategy: result.strategy,
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    totalUrlsCrawled: result.totalUrlsCrawled,
    maxDepthReached: result.maxDepthReached,
    totalErrors: result.totalErrors,
    totalWarnings: result.totalWarnings,
    totalNotices: result.totalNotices,
    totalIssues: result.totalIssues,
    averageAeoScore: result.averageAeoScore,
    robotsAccessible: result.robotsAccessible,
    sitemapAccessible: result.sitemapAccessible,
    sitemapUrlCount: result.sitemapUrlCount,
    llmsTxtAccessible: result.llmsTxtAccessible,
    llmsFullTxtAccessible: result.llmsFullTxtAccessible,
    passed: result.passed,
    issueCount: result.issuesSummary.length,
    recommendationCount: result.recommendations.length,
    linkCount: result.links.length,
  };
}

function broadcast(job: RunningJob, payload: any): void {
  const data = JSON.stringify(payload);
  for (const send of job.subscribers) {
    try {
      send(data);
    } catch {
      job.subscribers.delete(send);
    }
  }
}

export { closeStore };
