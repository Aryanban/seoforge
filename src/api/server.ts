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

      // Keep the connection alive until the crawl finishes.
      while (jobs.has(crawlId) && job.result === undefined) {
        await new Promise((r) => setTimeout(r, 500));
      }
      job.subscribers.delete(send);
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
      };
      if (!body.url) return c.json({ error: "url is required" }, 400);
      const { page, issues } = await auditSinglePage(body.url, {
        render: body.render,
        expectedEntities: body.expectedEntities,
        canonicalPolicy: body.canonicalPolicy,
      });
      return c.json({ page, issues });
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
