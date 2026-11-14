/**
 * Full-site BFS crawler — Screaming Frog–grade crawling with concurrency,
 * robots compliance, sitemap discovery, optional JS rendering, live link
 * verification, and a link-graph pass for orphan / internal-link-score analysis.
 */
import { EventEmitter } from "events";
import {
  AuditIssue,
  CrawlOptions,
  CrawlProgress,
  CrawlResult,
  CrawlStatus,
  CrawlStrategy,
  LinkRecord,
  PageAuditResult,
  SitemapEntry,
  ImageInfo,
} from "../types.js";
import { CrawlQueue, QueueItem, normalizeUrl, matchesPatterns } from "./queue.js";
import { ResolvedCrawlOptions } from "../config.js";
import { fetchRobots, isDisallowed, RobotsCheckResult } from "./robots.js";
import { parseSitemap } from "./sitemap-parser.js";
import { fetchPage } from "./fetcher.js";
import { ExtractedLinks } from "./link-extractor.js";
import { processPage, PageTask, PageTaskResult } from "./page-processor.js";
import { availableParallelism } from "node:os";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import { Piscina } from "piscina";
import { renderUrl, closeSharedBrowser } from "./renderer.js";
import { agentReachFetch, isAgentReachAvailable } from "./agent-reach.js";
import { buildIssueSummary } from "../checks/summary.js";
import { generateRecommendations } from "../ai/recommendations.js";
import { detectDuplicatesFromFeatures, DuplicateFeatures } from "../analysis/duplicates.js";
import { auditHreflangSitewide } from "../analysis/i18n.js";
import { auditAiBotPosture } from "../analysis/ai-crawlers.js";
import { validateLlmsTxt } from "../analysis/llms-txt.js";

export class Crawler extends EventEmitter {
  private stopped = false;
  private startedAt = new Date().toISOString();
  private errorCount = 0;
  private warningCount = 0;
  private noticeCount = 0;
  private pages: PageAuditResult[] = [];
  private allLinks: LinkRecord[] = [];
  private rawExtractedLinks: ExtractedLinks[] = [];
  private allImages: ImageInfo[] = [];
  /** Duplicate-detection hashes per page URL (body text is not retained). */
  private dupFeatures = new Map<string, DuplicateFeatures>();
  private robots: RobotsCheckResult | null = null;
  private sitemapEntries: SitemapEntry[] = [];
  private sitemapUrlSet = new Set<string>();
  private sitemapAccessible = false;
  private sitemapUrlCount = 0;
  private robotsAccessible = false;
  private llmsTxtAccessible?: boolean;
  private llmsFullTxtAccessible?: boolean;
  private maxDepthReached = 0;
  private llmsTxtIssues: AuditIssue[] = [];
  private aiPostureIssues: AuditIssue[] = [];
  private hreflangPairsByUrl = new Map<string, Array<{ lang: string; href: string }>>();
  private requestedCount = 0;
  /**
   * Politeness scheduler state. Each request reserves the next free slot
   * synchronously, so concurrent workers can't race past the cap. `rate` is
   * the live cap (req/s, 0 = uncapped); it is halved on 429 and grown back
   * additively on success (AIMD, as in Scrapy AutoThrottle / TCP).
   */
  private nextSlotAt = 0;
  private rate = 0;
  private rateCeiling = 0;
  private adaptive = false;
  private lastRateCutAt = 0;
  private recentStarts: number[] = [];
  private pool: Piscina | null = null;
  private taskOptions: any = {};
  private crawlId: string;
  private rootUrl = "";
  /** Crawl origin + production origin alias (staging/local audits). */
  private crawlOrigin = "";
  private productionOrigin = "";
  /**
   * Fetches currently in flight. New URLs are only discovered by a page that
   * is being fetched, so the crawl is genuinely finished only when the queue
   * is empty AND nothing is in flight. Without this, workers exit the moment
   * the queue is briefly empty (e.g. right after the seed URL is dequeued)
   * and the crawl collapses to a single worker — killing all parallelism.
   */
  private activeFetches = 0;
  /** Items claimed by a worker but not yet recorded as pages (re-queued on resume). */
  private inFlight = new Map<string, QueueItem>();
  /** Set while workers run, so a signal handler can checkpoint synchronously. */
  private active: { file: string; targetUrl: string; queue: CrawlQueue } | null = null;

  constructor(crawlId?: string) {
    super();
    this.crawlId = crawlIdId(crawlId);
  }

  /**
   * Write a checkpoint right now (synchronous, so the state is consistent).
   * For SIGTERM/SIGHUP handlers that must exit immediately. False when idle.
   */
  checkpointNow(): boolean {
    if (!this.active) return false;
    this.writeCheckpoint(this.active.file, this.active.targetUrl, this.active.queue);
    return true;
  }

  stop(): void {
    this.stopped = true;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  async crawl(targetUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
    const opts = this.resolveOptions(targetUrl, options);
    const origin = this.originOf(targetUrl);
    this.rate = this.rateCeiling = opts.maxRequestsPerSecond > 0 ? opts.maxRequestsPerSecond : 0;
    this.startedAt = new Date().toISOString();
    this.rootUrl = normalizeUrl(targetUrl);
    this.crawlOrigin = this.originOf(targetUrl);
    this.productionOrigin =
      opts.productionOrigin && opts.productionOrigin !== this.crawlOrigin ? opts.productionOrigin : "";

    this.emitProgress({
      status: "running",
      crawled: 0,
      discovered: 0,
      depth: 0,
      message: `Resolving robots.txt and sitemap for ${origin}…`,
    });

    // 1. Initial probes in parallel: robots.txt + llms.txt endpoints
    const [robotsRes, llmsProbe, llmsFullProbe, llmsRes] = await Promise.all([
      fetchRobots(`${origin}/robots.txt`),
      this.probe(`${origin}/llms.txt`),
      this.probe(`${origin}/llms-full.txt`),
      fetchPage(`${origin}/llms.txt`, { timeoutMs: 8000, method: "GET" }).catch(() => null),
    ]);
    this.robots = robotsRes;
    this.robotsAccessible = this.robots.accessible;
    this.llmsTxtAccessible = llmsProbe;
    this.llmsFullTxtAccessible = llmsFullProbe;

    if (llmsRes && llmsRes.status === 200) {
      try {
        const llmsResult = validateLlmsTxt({
          url: `${origin}/llms.txt`,
          status: llmsRes.status,
          contentType: llmsRes.contentType,
          body: llmsRes.html,
          byteSize: llmsRes.contentLengthBytes,
        });
        for (const f of llmsResult.findings) {
          this.llmsTxtIssues.push({
            id: f.id,
            name: f.name,
            severity: f.severity,
            category: "AEO",
            message: f.message,
            url: `${origin}/llms.txt`,
          });
        }
      } catch {
        /* llms.txt validation is non-fatal */
      }
    }

    // 2. sitemap.xml (explicit, from robots directive, or default)
    const sitemapUrl = this.toCrawlOrigin(
      opts.sitemapOverride ||
      this.robots.sitemaps[0] ||
      `${origin}/sitemap.xml`
    );
    if (opts.followSitemap !== false && sitemapUrl) {
      const sitemapResult = await parseSitemap(sitemapUrl, {
        limit: opts.limit ? opts.limit * 20 : 200000,
      });
      this.sitemapAccessible = sitemapResult.accessible;
      this.sitemapEntries = this.productionOrigin
        ? sitemapResult.entries.map((e) => ({ ...e, url: this.toCrawlOrigin(e.url) }))
        : sitemapResult.entries;
      this.sitemapUrlCount = sitemapResult.urlCount;
      this.sitemapUrlSet = new Set(this.sitemapEntries.map((e) => normalizeUrl(e.url)));
    }
    // 3b. AI-crawler robots posture audit (visibility-loss warnings)
    try {
      const posture = auditAiBotPosture(this.robots?.raw || "");
      for (const token of posture.blockedSearchBots) {
        this.aiPostureIssues.push({
          id: "ai_search_bot_blocked",
          name: `AI search crawler blocked: ${token}`,
          severity: "Warning",
          category: "AEO",
          message: `${token} (AI-search crawler) is disallowed by robots.txt — the site cannot be cited in that engine's AI answers. Allow it unless exclusion is deliberate.`,
          url: `${origin}/robots.txt`,
          details: { token },
        });
      }
      for (const token of posture.blockedFetchers) {
        this.aiPostureIssues.push({
          id: "ai_fetcher_blocked",
          name: `AI assistant fetcher blocked: ${token}`,
          severity: "Notice",
          category: "AEO",
          message: `${token} (user-triggered assistant fetcher) is disallowed — assistants cannot open site pages when users ask.`,
          url: `${origin}/robots.txt`,
          details: { token },
        });
      }
    } catch {
      /* posture audit is non-fatal */
    }

    // 4. Seed the queue per strategy
    const queue = new CrawlQueue(opts.maxDepth, opts.limit);
    const resumed = opts.checkpointPath ? this.loadCheckpoint(opts.checkpointPath, targetUrl, queue) : false;
    if (!resumed) this.seedQueue(queue, opts, targetUrl);

    // 5. Crawl with a worker pool
    await this.runWorkers(queue, opts, targetUrl);
    if (opts.checkpointPath) {
      // Stopped crawls stay resumable; finished ones need no checkpoint.
      if (this.stopped) this.writeCheckpoint(opts.checkpointPath, targetUrl, queue);
      else rmSync(opts.checkpointPath, { force: true });
    }

    // 6. Link verification (internal non-HTML + external)
    await this.verifyLinkTargets(opts, origin);

    // 7. Link-graph pass: incoming links, orphans, internal link score
    this.applyLinkGraph();

    // 7b. Sitewide passes: duplicates, hreflang reciprocity (need full page set)
    this.applySitewideChecks(targetUrl);

    // 8. Aggregate issues
    const issuesSummary = buildIssueSummary(this.pages, this.previousIssueCounts());
    for (const s of issuesSummary) {
      if (s.severity === "Error") this.errorCount += s.affectedPages;
      else if (s.severity === "Warning") this.warningCount += s.affectedPages;
      else this.noticeCount += s.affectedPages;
    }

    // 9. Deterministic AI recommendations
    const recommendations = generateRecommendations(issuesSummary);

    const totalErrors = this.errorCount;
    const totalWarnings = this.warningCount;
    const totalNotices = this.noticeCount;
    const averageAeoScore = this.pages.length
      ? Math.round(this.pages.reduce((a, p) => a + p.aeo.score, 0) / this.pages.length)
      : 0;

    const status: CrawlStatus = this.stopped
      ? "stopped"
      : this.pages.length === 0
      ? "failed"
      : "completed";

    const result: CrawlResult = {
      id: this.crawlId,
      targetUrl,
      project: undefined,
      strategy: opts.strategy,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      status,
      options: opts,
      robotsAccessible: this.robotsAccessible,
      sitemapAccessible: this.sitemapAccessible,
      sitemapUrlCount: this.sitemapUrlCount,
      llmsTxtAccessible: this.llmsTxtAccessible,
      llmsFullTxtAccessible: this.llmsFullTxtAccessible,
      pages: this.pages,
      links: this.allLinks,
      sitemapEntries: this.sitemapEntries,
      issuesSummary,
      recommendations,
      totalErrors,
      totalWarnings,
      totalNotices,
      totalIssues: totalErrors + totalWarnings + totalNotices,
      averageAeoScore,
      totalUrlsCrawled: this.pages.length,
      maxDepthReached: this.maxDepthReached,
      passed: this.pages.length > 0 && totalErrors === 0,
    };

    if (opts.render) {
      await closeSharedBrowser().catch(() => {});
    }

    this.emit("done", result);
    return result;
  }

  /* ------------------------------------------------------------------ */

  private resolveOptions(targetUrl: string, options: CrawlOptions): ResolvedCrawlOptions {
    const o = { ...options };
    return {
      maxDepth: o.maxDepth ?? 10,
      concurrency: o.concurrency ?? 12,
      limit: o.limit ?? 1000,
      render: o.render ?? false,
      reach: o.reach ?? false,
      strategy: (o.strategy ?? "discover") as CrawlStrategy,
      sampleSitemap: o.sampleSitemap ?? 0,
      canonicalPolicy: o.canonicalPolicy ?? "strict",
      respectRobots: o.respectRobots ?? true,
      maxRequestsPerSecond: o.maxRequestsPerSecond ?? 20,
      excludePatterns: o.excludePatterns ?? [],
      checkExternalLinks: o.checkExternalLinks ?? true,
      externalLinkTimeoutMs: o.externalLinkTimeoutMs ?? 4000,
      timeoutMs: o.timeoutMs ?? 15000,
      followSitemap: o.followSitemap ?? true,
      maxRetries: o.maxRetries ?? 2,
      pageWorkers: o.pageWorkers,
      checkpointPath: o.checkpointPath,
      sitemapOverride: o.sitemapOverride,
      expectedEntities: o.expectedEntities ?? [],
      thresholds: o.thresholds,
      paths: o.paths,
      seedUrls: o.seedUrls,
      productionOrigin: o.productionOrigin,
      customExtractors: o.customExtractors,
    };
  }

  /** Map a production-origin URL onto the crawl origin (no-op without --production-origin). */
  private toCrawlOrigin(url: string): string {
    if (!this.productionOrigin || !url.startsWith(this.productionOrigin)) return url;
    return this.crawlOrigin + url.slice(this.productionOrigin.length);
  }

  private originOf(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      return url.replace(/\/$/, "");
    }
  }

  private async probe(url: string): Promise<boolean> {
    try {
      const res = await fetchPage(url, { timeoutMs: 6000, method: "HEAD" });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  private seedQueue(queue: CrawlQueue, opts: any, targetUrl: string): void {
    const root = this.originOf(targetUrl);
    const seedEntries: Array<{ url: string; normalizedUrl: string; depth: number }> = [];

    if (Array.isArray(opts.seedUrls) && opts.seedUrls.length > 0) {
      for (const raw of opts.seedUrls) {
        const u = this.toCrawlOrigin(raw);
        seedEntries.push({ url: u, normalizedUrl: normalizeUrl(u), depth: 0 });
      }
    } else if (opts.strategy === "sitemap") {
      let entries = this.sitemapEntries;
      if (opts.sampleSitemap && opts.sampleSitemap > 0 && entries.length > opts.sampleSitemap) {
        entries = this.sampleEntries(entries, opts.sampleSitemap);
      }
      for (const e of entries) {
        seedEntries.push({ url: e.url, normalizedUrl: normalizeUrl(e.url), depth: 0 });
      }
      if (seedEntries.length === 0) {
        seedEntries.push({ url: targetUrl, normalizedUrl: normalizeUrl(targetUrl), depth: 0 });
      }
    } else {
      // discover + config both start from the target URL
      seedEntries.push({ url: targetUrl, normalizedUrl: normalizeUrl(targetUrl), depth: 0 });
      if (Array.isArray(opts.paths) && opts.paths.length > 0) {
        for (const p of opts.paths) {
          const full = `${root}${p.startsWith("/") ? p : `/${p}`}`;
          seedEntries.push({ url: full, normalizedUrl: normalizeUrl(full), depth: 0 });
        }
      }
    }

    const added = queue.enqueueMany(seedEntries);
    this.emitProgress({
      status: "running",
      crawled: 0,
      discovered: added,
      depth: 0,
      message: `Seeded ${added} URL(s) (strategy: ${opts.strategy})`,
    });
  }

  private sampleEntries(entries: SitemapEntry[], count: number): SitemapEntry[] {
    const shuffled = [...entries].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  private async runWorkers(queue: CrawlQueue, opts: any, targetUrl: string): Promise<void> {
    const workers: Promise<void>[] = [];
    const concurrency = Math.max(1, opts.concurrency);
    // Seed lists can be huge and are cloned into every worker task; checks don't need them.
    const { seedUrls: _seeds, ...taskOptions } = opts;
    this.taskOptions = taskOptions;
    this.pool = createPagePool(opts.pageWorkers);
    if (opts.checkpointPath) this.active = { file: opts.checkpointPath, targetUrl, queue };
    let lastSaved = this.pages.length;
    const timer = opts.checkpointPath
      ? setInterval(() => {
          if (this.pages.length === lastSaved) return;
          lastSaved = this.pages.length;
          try {
            this.writeCheckpoint(opts.checkpointPath, targetUrl, queue);
          } catch (err: any) {
            process.emitWarning(`SEOForge checkpoint failed: ${err?.message ?? err}`);
          }
        }, CHECKPOINT_INTERVAL_MS)
      : null;

    try {
      for (let i = 0; i < concurrency; i++) {
        workers.push(this.worker(queue, opts, targetUrl));
      }
      await Promise.all(workers);
    } finally {
      if (timer) clearInterval(timer);
      this.active = null;
      await this.pool?.destroy().catch(() => {});
      this.pool = null;
    }
  }

  private async runPageTask(task: PageTask): Promise<PageTaskResult> {
    const pool = this.pool;
    if (pool) {
      try {
        return await pool.run(task);
      } catch (err: any) {
        // A worker that can't start must not fail the crawl: fall back to inline.
        if (this.pool === pool) {
          this.pool = null;
          process.emitWarning(`SEOForge page workers disabled, processing inline: ${err?.message ?? err}`);
          pool.destroy().catch(() => {});
        }
      }
    }
    return processPage(task);
  }

  private async worker(queue: CrawlQueue, opts: any, targetUrl: string): Promise<void> {
    while (!this.stopped) {
      const item = queue.dequeue();

      // No work right now. New URLs can only be produced by a page currently
      // being fetched, so if something is in flight we wait on the event-driven
      // slot resolver instead of spin-polling.
      if (!item) {
        if (this.activeFetches === 0) return;
        await queue.waitForItem(250);
        continue;
      }
      if (queue.isBudgetExhausted && this.pages.length >= opts.limit) return;

      // Claim the item synchronously, before any await, so sibling workers
      // observe in-flight work and wait rather than exiting while the queue
      // is momentarily empty.
      this.activeFetches++;
      this.inFlight.set(item.normalizedUrl, item);
      try {
        this.maxDepthReached = Math.max(this.maxDepthReached, item.depth);

      const blockedByRobots =
        opts.respectRobots && isDisallowed(this.robots, item.url);

      // robots-blocked page — record and skip fetch
      if (blockedByRobots) {
        const blockedIssue: AuditIssue = {
          id: "blocked_by_robots",
          name: "Blocked by robots.txt",
          severity: "Warning",
          category: "Robots",
          message: `URL is disallowed by robots.txt rules for ${this.originOf(targetUrl)}.`,
          url: item.url,
          details: { source: item.source },
        };
        const blockedPage = this.placeholderPage(item.url, item.depth, blockedIssue);
        this.inFlight.delete(item.normalizedUrl);
        this.pages.push(blockedPage);
        this.emit("page", blockedPage);
        this.emit("issue", blockedIssue);
        this.emitProgress({ status: "running", crawled: this.pages.length, discovered: queue.discovered, depth: item.depth, currentUrl: item.url });
        continue;
      }

        await this.throttle(opts);

        const pageData = await this.fetchPageData(item.url, item.depth, opts);

        // Exponential retry with jitter on transient rate limits (HTTP 429 / 503 / connection drops)
        // Referenced from Apify Crawlee RequestQueue & AWS Architecture backoff standards
        const isTransient =
          (pageData.status === 429 || pageData.status === 503 || (pageData.status === 0 && !pageData.errorMessage?.includes("Abort"))) &&
          !this.stopped;
        const currentRetries = item.retryCount ?? 0;
        const maxRetries = opts.maxRetries ?? 2;

        const retryAfterSec = parseInt(pageData.headers?.["retry-after"] || "0", 10) || 0;
        // Host-wide signals: a 429 (or 503 with Retry-After) slows every worker,
        // not just this URL, so we stop feeding a server that is pushing back.
        if (pageData.status === 429 || (pageData.status === 503 && retryAfterSec > 0)) this.onRateLimited(retryAfterSec);
        else if (pageData.status > 0 && pageData.status < 500) this.onRequestOk();

        if (isTransient && currentRetries < maxRetries) {
          // With Retry-After the shared scheduler already pauses all workers.
          if (retryAfterSec <= 0) {
            const backoffMs = Math.min(8000, 1000 * Math.pow(2, currentRetries) + Math.floor(Math.random() * 500));
            await new Promise((r) => setTimeout(r, backoffMs));
          }
          queue.requeue(item);
          continue;
        }

        queue.markVisited(item.normalizedUrl);

        // Parse + checks: on a worker thread when the pool is up, else inline.
        const { page, issues, links, images, dup } = await this.runPageTask({
          url: item.url,
          depth: item.depth,
          sourceUrl: item.source,
          finalUrl: pageData.finalUrl,
          html: pageData.html,
          status: pageData.status,
          responseTimeMs: pageData.responseTimeMs,
          ttfbMs: pageData.ttfbMs,
          rendered: pageData.rendered,
          headers: pageData.headers,
          cwv: pageData.cwv,
          contentLengthBytes: pageData.contentLengthBytes,
          isRedirect: pageData.isRedirect,
          redirectChain: pageData.redirectChain,
          isHttpToHttpsRedirect: pageData.isHttpToHttpsRedirect,
          rawHtml: (pageData as any).rawHtml,
          options: this.taskOptions,
        });
        if (links.hreflang.length > 0) this.hreflangPairsByUrl.set(item.url, links.hreflang);
        if (dup) this.dupFeatures.set(page.url, dup);
      this.rawExtractedLinks.push(links);
      for (const img of images) this.allImages.push(img);

      // Enqueue discovered internal links (all strategies follow links)
      for (const target of links.internalTargets) {
        const norm = normalizeUrl(target);
        if (matchesPatterns(target, opts.excludePatterns)) continue;
        queue.enqueue(target, norm, item.depth + 1, item.url);
      }

      this.inFlight.delete(item.normalizedUrl);
      this.pages.push(page);
      for (const issue of issues) this.emit("issue", issue);
      this.emit("page", page);

      this.emitProgress({
        status: "running",
        crawled: this.pages.length,
        discovered: queue.discovered,
        depth: item.depth,
        currentUrl: item.url,
        errors: this.errorCount,
        warnings: this.warningCount,
        notices: this.noticeCount,
      });
      } finally {
        this.inFlight.delete(item.normalizedUrl);
        this.activeFetches--;
        queue.notifyWaiters();
      }
    }
  }

  private async fetchPageData(url: string, depth: number, opts: any) {
    if (opts.render) {
      // Raw fetch (headers, TTFB, redirect chain, raw HTML) runs alongside the
      // render instead of after it — one round-trip of wall time, not two.
      const [rendered, raw] = await Promise.all([
        renderUrl(url, { timeoutMs: opts.timeoutMs, blockHeavyResources: false }),
        fetchPage(url, { timeoutMs: opts.timeoutMs, method: "GET" }),
      ]);
      if (rendered.html) {
        return {
          url,
          finalUrl: rendered.finalUrl || raw.finalUrl || url,
          status: rendered.status || raw.status,
          responseTimeMs: raw.responseTimeMs,
          ttfbMs: raw.ttfbMs,
          depth,
          isRedirect: raw.redirected,
          redirectChain: raw.redirectChain,
          isHttpToHttpsRedirect: raw.requestedUrl.startsWith("http://") && (raw.finalUrl.startsWith("https://")),
          html: rendered.html,
          rawHtml: raw.html,
          rendered: true,
          headers: raw.headers,
          contentType: raw.contentType,
          contentLengthBytes: raw.contentLengthBytes,
          cwv: rendered.cwv,
          errorMessage: raw.errorMessage,
        };
      }
      // render failed → fall back to the raw fetch with the render error preserved
      return {
        url,
        finalUrl: raw.finalUrl || url,
        status: raw.status,
        responseTimeMs: raw.responseTimeMs,
        ttfbMs: raw.ttfbMs,
        depth,
        isRedirect: raw.redirected,
        redirectChain: raw.redirectChain,
        isHttpToHttpsRedirect: raw.requestedUrl.startsWith("http://") && raw.finalUrl.startsWith("https://"),
        html: raw.html,
        rendered: false,
        headers: raw.headers,
        contentType: raw.contentType,
        contentLengthBytes: raw.contentLengthBytes,
        cwv: undefined,
        errorMessage: rendered.errorMessage || raw.errorMessage,
      };
    }

    const raw = await fetchPage(url, { timeoutMs: opts.timeoutMs, method: "GET" });

    // If reach is explicitly enabled, or if standard fetch failed with 403/429 anti-bot,
    // attempt scraping via Agent Reach engine
    if (opts.reach || (opts.reach !== false && (raw.status === 403 || raw.status === 429))) {
      try {
        const reachAvailable = await isAgentReachAvailable();
        if (reachAvailable) {
          const reachResult = await agentReachFetch(url, { timeoutMs: opts.timeoutMs });
          if (reachResult.ok && reachResult.html) {
            return {
              url,
              finalUrl: reachResult.finalUrl || url,
              status: reachResult.status,
              responseTimeMs: reachResult.responseTimeMs,
              ttfbMs: reachResult.ttfbMs,
              depth,
              isRedirect: reachResult.redirected,
              redirectChain: reachResult.redirectChain,
              isHttpToHttpsRedirect: reachResult.requestedUrl.startsWith("http://") && reachResult.finalUrl.startsWith("https://"),
              html: reachResult.html,
              rendered: false,
              headers: reachResult.headers,
              contentType: reachResult.contentType,
              contentLengthBytes: reachResult.contentLengthBytes,
              cwv: undefined,
              errorMessage: undefined,
            };
          }
        }
      } catch {
        // Fall back to raw response
      }
    }

    // Trust the declared Content-Type; only sniff markup when none was sent.
    // (A non-empty CSV/JSON body is not an HTML page and must not be audited as one.)
    const ct = (raw.contentType || "").toLowerCase();
    const isHtml = ct ? /html|xhtml/.test(ct) : /^\s*</.test(raw.html);
    let html = isHtml ? raw.html : "";
    // Staging/local audits: serve the page as if it were on the production origin, so
    // canonical/hreflang/og/absolute links resolve same-site instead of host-mismatch noise.
    if (html && this.productionOrigin) html = html.split(this.productionOrigin).join(this.crawlOrigin);
    return {
      url,
      finalUrl: raw.finalUrl || url,
      status: raw.status,
      responseTimeMs: raw.responseTimeMs,
      ttfbMs: raw.ttfbMs,
      depth,
      isRedirect: raw.redirected,
      redirectChain: raw.redirectChain,
      isHttpToHttpsRedirect: raw.requestedUrl.startsWith("http://") && raw.finalUrl.startsWith("https://"),
      html,
      rendered: false,
      headers: raw.headers,
      contentType: raw.contentType,
      contentLengthBytes: raw.contentLengthBytes,
      cwv: undefined,
      errorMessage: raw.errorMessage,
    };
  }

  /**
   * Write crawl state atomically (tmp + rename). In-flight items go back in
   * front of the queue so a resumed crawl re-fetches them.
   */
  private writeCheckpoint(file: string, targetUrl: string, queue: CrawlQueue): void {
    const q = queue.snapshot();
    const pending = new Map<string, QueueItem>();
    for (const it of [...this.inFlight.values(), ...q.items]) if (!pending.has(it.normalizedUrl)) pending.set(it.normalizedUrl, it);
    const data = v8.serialize({
      v: CHECKPOINT_VERSION,
      crawlId: this.crawlId,
      targetUrl,
      startedAt: this.startedAt,
      pages: this.pages,
      rawExtractedLinks: this.rawExtractedLinks,
      allImages: this.allImages,
      dupFeatures: this.dupFeatures,
      hreflangPairsByUrl: this.hreflangPairsByUrl,
      maxDepthReached: this.maxDepthReached,
      requestedCount: this.requestedCount,
      queue: { ...q, items: [...pending.values()] },
    });
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, data);
    renameSync(`${file}.tmp`, file);
  }

  /** Restore state from a checkpoint; false when there is none. */
  private loadCheckpoint(file: string, targetUrl: string, queue: CrawlQueue): boolean {
    if (!existsSync(file)) return false;
    const c = v8.deserialize(readFileSync(file));
    if (c?.v !== CHECKPOINT_VERSION) throw new Error(`Unsupported checkpoint format in ${file}`);
    if (normalizeUrl(c.targetUrl) !== normalizeUrl(targetUrl)) {
      throw new Error(`Checkpoint ${file} belongs to ${c.targetUrl}, not ${targetUrl}`);
    }
    this.crawlId = c.crawlId;
    this.startedAt = c.startedAt;
    this.pages = c.pages;
    this.rawExtractedLinks = c.rawExtractedLinks;
    this.allImages = c.allImages;
    this.dupFeatures = c.dupFeatures;
    this.hreflangPairsByUrl = c.hreflangPairsByUrl;
    this.maxDepthReached = c.maxDepthReached;
    this.requestedCount = c.requestedCount;
    queue.restore(c.queue);
    this.emitProgress({
      status: "running",
      crawled: this.pages.length,
      discovered: queue.discovered,
      depth: this.maxDepthReached,
      message: `Resumed from checkpoint: ${this.pages.length} pages done, ${queue.size} queued`,
    });
    return true;
  }

  private async throttle(_opts: any): Promise<void> {
    this.requestedCount++;
    // robots Crawl-delay is a gap between requests to the host, not per worker.
    const crawlDelayMs = Math.min((this.robots?.crawlDelay ?? 0) * 1000, 5000);
    const interval = Math.max(this.rate > 0 ? 1000 / this.rate : 0, crawlDelayMs);
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    // A Retry-After pause pushes nextSlotAt forward even when uncapped.
    this.nextSlotAt = interval > 0 ? slot + interval : this.nextSlotAt;
    this.recentStarts.push(slot);
    while (this.recentStarts.length && this.recentStarts[0] < slot - 2000) this.recentStarts.shift();
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  }

  /**
   * Multiplicative decrease on 429 / 503+Retry-After, at most one cut per
   * second: drop to 0.85x the rate actually achieved over the last 2 s.
   */
  private onRateLimited(retryAfterSec: number): void {
    const now = Date.now();
    if (retryAfterSec > 0) this.nextSlotAt = Math.max(this.nextSlotAt, now + Math.min(retryAfterSec, 60) * 1000);
    if (now - this.lastRateCutAt < 1000) return;
    this.lastRateCutAt = now;
    const recent = this.recentStarts.filter((t) => t >= now - 2000 && t <= now).length / 2;
    const current = Math.min(this.rate || Infinity, Math.max(1, recent));
    this.rate = Math.max(0.5, current * 0.85);
    this.adaptive = true;
  }

  /** Additive increase: probe ~1 req/s upward per second of clean responses. */
  private onRequestOk(): void {
    if (!this.adaptive || this.rate <= 0) return;
    this.rate += 1 / this.rate;
    if (this.rateCeiling > 0 && this.rate >= this.rateCeiling) {
      this.rate = this.rateCeiling;
      this.adaptive = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Link verification                                                   */
  /* ------------------------------------------------------------------ */

  private async verifyLinkTargets(opts: any, _origin: string): Promise<void> {
    // Aggregate every discovered link target
    const targetMap = new Map<string, { sources: string[]; anchors: string[]; nofollow: boolean; isInternal: boolean }>();
    for (const ex of this.rawExtractedLinks) {
      for (const l of ex.links) {
        const norm = normalizeUrl(l.target);
        const existing = targetMap.get(norm) || {
          sources: [],
          anchors: [],
          nofollow: l.nofollow,
          isInternal: l.isInternal,
        };
        existing.sources.push(l.source);
        existing.anchors.push(l.anchorText);
        existing.nofollow = existing.nofollow || l.nofollow;
        targetMap.set(norm, existing);
      }
    }

    const crawledStatus = new Map<string, number>();
    for (const p of this.pages) crawledStatus.set(p.normalizedUrl, p.status);

    const toVerify: string[] = [];
    for (const [norm, info] of targetMap.entries()) {
      if (crawledStatus.has(norm)) continue; // status known from crawl
      if (!info.isInternal && !opts.checkExternalLinks) continue;
      toVerify.push(norm);
    }

    // HEAD-check uncrawled targets. Same-host checks are bounded by the target
    // site's own concurrency ceiling, but cross-host checks (CDNs, fonts, map
    // tiles, analytics) hit many *different* servers and can fan out widely —
    // a single small pool for both is what made this phase dominate wall time.
    // Cache for hosts that failed connection/DNS to avoid repeating timeouts
    const failedHosts = new Set<string>();

    const checkOne = async (current: string) => {
      const info = targetMap.get(current)!;
      let host = "";
      try { host = new URL(current).host; } catch {}

      if (host && failedHosts.has(host)) {
        crawledStatus.set(current, 0);
        for (let i = 0; i < info.sources.length; i++) {
          this.allLinks.push({
            crawlId: this.crawlId,
            source: info.sources[i],
            target: current,
            anchorText: info.anchors[i] || "",
            nofollow: info.nofollow,
            isInternal: info.isInternal,
            targetStatus: 0,
            isBroken: false,
            isRedirect: false,
            redirectChain: [],
          });
        }
        return;
      }

      const timeoutMs = info.isInternal ? opts.timeoutMs : opts.externalLinkTimeoutMs;
      // Internal checks hit the crawled site: same rate cap / crawl-delay as the crawl.
      if (info.isInternal) await this.throttle(opts);
      let res = await fetchPage(current, { timeoutMs, method: "HEAD", followRedirects: true });
      // Many servers reject or mishandle HEAD (403/405/501, or reset the
      // connection). Re-check with a body-less GET before calling it broken,
      // as linkinator does. Timeouts are not retried: GET would time out too.
      if (res.status >= 400 || (res.status === 0 && !/timed out/i.test(res.errorMessage ?? ""))) {
        const viaGet = await fetchPage(current, { timeoutMs, method: "GET", followRedirects: true, discardBody: true });
        if (viaGet.status !== 0) res = viaGet;
      }
      if (info.isInternal && res.status === 429) this.onRateLimited(Number(res.headers["retry-after"]) || 0);
      if (res.status === 0 && host && !info.isInternal) {
        failedHosts.add(host);
      }
      crawledStatus.set(current, res.status);

      for (let i = 0; i < info.sources.length; i++) {
        this.allLinks.push({
          crawlId: this.crawlId,
          source: info.sources[i],
          target: current,
          anchorText: info.anchors[i] || "",
          nofollow: info.nofollow,
          isInternal: info.isInternal,
          targetStatus: res.status,
          // status 0 means the HEAD probe itself failed (timeout, connection
          // reset, or the target rate-limiting the crawler) — not a confirmed
          // dead link. Only a real HTTP >=400 response counts as broken;
          // otherwise big hosts get mass false positives under load.
          // 429 means "slow down", not "gone".
          isBroken: res.status >= 400 && res.status !== 429,
          isRedirect: res.redirected || (res.status >= 300 && res.status < 400),
          redirectChain: res.redirectChain,
        });
      }
    };

    // Each lane is checked sequentially; the pool runs `poolSize` lanes at once.
    const runPool = async (lanes: string[][], poolSize: number) => {
      let index = 0;
      const worker = async () => {
        while (index < lanes.length) {
          for (const current of lanes[index++]) await checkOne(current);
        }
      };
      const size = Math.max(1, Math.min(poolSize, lanes.length));
      await Promise.all(Array.from({ length: size }, () => worker()));
    };

    const internalTargets = toVerify.filter((u) => targetMap.get(u)?.isInternal);
    const externalTargets = toVerify.filter((u) => !targetMap.get(u)?.isInternal);

    await Promise.all([
      runPool(internalTargets.map((u) => [u]), opts.concurrency || 8),
      runPool(externalLanes(externalTargets, EXTERNAL_PER_HOST), Math.min(48, Math.max(24, (opts.concurrency || 12) * 2))),
    ]);

    // Record links to already-crawled pages
    for (const [norm, info] of targetMap.entries()) {
      if (!crawledStatus.has(norm)) continue;
      const status = crawledStatus.get(norm)!;
      for (let i = 0; i < info.sources.length; i++) {
        this.allLinks.push({
          crawlId: this.crawlId,
          source: info.sources[i],
          target: norm,
          anchorText: info.anchors[i] || "",
          nofollow: info.nofollow,
          isInternal: info.isInternal,
          targetStatus: status,
          isBroken: status >= 400,
          isRedirect: status >= 300 && status < 400,
          redirectChain: [],
        });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Link graph: incoming links, orphans, internal link score            */
  /* ------------------------------------------------------------------ */

  private applyLinkGraph(): void {
    const incoming = new Map<string, Set<string>>();
    for (const link of this.allLinks) {
      if (!link.isInternal || link.nofollow) continue;
      const srcNorm = normalizeUrl(link.source);
      const tgtNorm = normalizeUrl(link.target);
      if (srcNorm === tgtNorm) continue;
      if (!incoming.has(tgtNorm)) incoming.set(tgtNorm, new Set());
      incoming.get(tgtNorm)!.add(srcNorm);
    }

    const pageByNorm = new Map<string, PageAuditResult>();
    for (const p of this.pages) pageByNorm.set(p.normalizedUrl, p);

    // Pass 1: incoming counts + orphan / single-link flags
    for (const page of this.pages) {
      const inc = (incoming.get(page.normalizedUrl) || new Set<string>());
      inc.delete(page.normalizedUrl);
      page.incomingInternalLinks = Array.from(inc);
    }

    // Pass 2: internal link score (simplified PageRank over crawled nodes)
    const N = this.pages.length;
    const score = new Map<string, number>();
    for (const p of this.pages) score.set(p.normalizedUrl, 1 / Math.max(N, 1));
    // Single-pass adjacency index O(L) instead of O(P * L)
    const outgoingTargets = new Map<string, Set<string>>();
    for (const link of this.allLinks) {
      if (!link.isInternal || link.nofollow) continue;
      const srcNorm = normalizeUrl(link.source);
      const tgtNorm = normalizeUrl(link.target);
      if (srcNorm === tgtNorm || !pageByNorm.has(tgtNorm)) continue;
      let set = outgoingTargets.get(srcNorm);
      if (!set) {
        set = new Set();
        outgoingTargets.set(srcNorm, set);
      }
      set.add(tgtNorm);
    }
    const outDegree = new Map<string, number>();
    for (const p of this.pages) {
      outDegree.set(p.normalizedUrl, outgoingTargets.get(p.normalizedUrl)?.size || 0);
    }

    const d = 0.85;
    for (let iter = 0; iter < 20; iter++) {
      const next = new Map<string, number>();
      for (const p of this.pages) {
        let sum = 0;
        const incomingToPage = incoming.get(p.normalizedUrl) || new Set<string>();
        for (const src of incomingToPage) {
          const deg = outDegree.get(src) || 0;
          if (deg > 0) sum += (score.get(src) || 0) / deg;
        }
        next.set(p.normalizedUrl, (1 - d) / N + d * sum);
      }
      for (const [k, v] of next.entries()) score.set(k, v);
    }

    const maxScore = Math.max(...Array.from(score.values()), 1e-9);
    for (const p of this.pages) {
      p.internalLinkScore = Math.round(((score.get(p.normalizedUrl) || 0) / maxScore) * 100);
    }

    // Pass 3: broken / redirecting links (attributed to the source page)
    const pageByNormForLinks = new Map<string, PageAuditResult>();
    for (const p of this.pages) pageByNormForLinks.set(p.normalizedUrl, p);
    const brokenSeen = new Set<string>();
    for (const link of this.allLinks) {
      const src = pageByNormForLinks.get(normalizeUrl(link.source));
      if (!src) continue;
      const key = `${link.source}|${link.target}`;
      if (brokenSeen.has(key)) continue;
      brokenSeen.add(key);

      let issue: AuditIssue | null = null;
      if (link.isBroken && link.isInternal) {
        issue = {
          id: "broken_internal_link",
          name: "Broken internal link",
          severity: "Error",
          category: "Links",
          message: `Internal link to '${link.target}' returns HTTP ${link.targetStatus}.`,
          url: src.url,
          details: { target: link.target, status: link.targetStatus, anchorText: link.anchorText },
        };
      } else if (link.isBroken && !link.isInternal) {
        issue = {
          id: "broken_external_link",
          name: "Broken external link",
          severity: "Warning",
          category: "Links",
          message: `External link to '${link.target}' returns HTTP ${link.targetStatus}.`,
          url: src.url,
          details: { target: link.target, status: link.targetStatus, anchorText: link.anchorText },
        };
      } else if (link.isRedirect && link.isInternal) {
        issue = {
          id: "redirecting_internal_link",
          name: "Internal link to a redirecting URL",
          severity: "Notice",
          category: "Links",
          message: `Internal link to '${link.target}' redirects (HTTP ${link.targetStatus}); link directly to the destination.`,
          url: src.url,
          details: { target: link.target, status: link.targetStatus, anchorText: link.anchorText },
        };
      }
      if (issue) {
        src.auditIssues.push(issue);
        src.issues.push(`[${issue.severity}] ${issue.name}`);
        this.emit("issue", issue);
      }
    }

    // Pass 4: orphan + single-link + sitemap cross-reference issues
    for (const p of this.pages) {
      const issues: AuditIssue[] = [];
      const isRootish = p.normalizedUrl === this.rootUrl;

      if (p.incomingInternalLinks.length === 0 && !isRootish && p.status === 200 && !p.blockedByRobots) {
        p.isOrphan = true;
        issues.push({
          id: "orphan_page",
          name: "Orphan page (has no incoming internal links)",
          severity: "Error",
          category: "Links",
          message: "Page has no incoming internal links from any other crawled page on the domain.",
          url: p.url,
        });
      }

      if (p.incomingInternalLinks.length === 1 && !isRootish && p.status === 200) {
        issues.push({
          id: "single_incoming_link",
          name: "Page has only one dofollow incoming internal link",
          severity: "Notice",
          category: "Links",
          message: `Page has only 1 incoming internal link (from ${p.incomingInternalLinks[0]}).`,
          url: p.url,
          details: { linkedFrom: p.incomingInternalLinks[0] },
        });
      }

      // In sitemap but not internally linked (orphan in sitemap)
      if (
        this.sitemapUrlSet.size > 0 &&
        this.sitemapUrlSet.has(p.normalizedUrl) &&
        p.incomingInternalLinks.length === 0 &&
        !isRootish
      ) {
        issues.push({
          id: "orphan_in_sitemap",
          name: "URL in sitemap has no internal links",
          severity: "Warning",
          category: "Sitemap",
          message: "URL is listed in the XML sitemap but has no incoming internal links.",
          url: p.url,
        });
      }

      // Crawled and indexable but missing from sitemap
      if (
        this.sitemapUrlSet.size > 0 &&
        !this.sitemapUrlSet.has(p.normalizedUrl) &&
        p.isIndexable &&
        p.status === 200
      ) {
        issues.push({
          id: "not_in_sitemap",
          name: "Indexable page not in sitemap",
          severity: "Notice",
          category: "Sitemap",
          message: "Indexable page is not listed in the XML sitemap.",
          url: p.url,
        });
      }

      for (const issue of issues) {
        p.auditIssues.push(issue);
        p.issues.push(`[${issue.severity}] ${issue.name}`);
        this.emit("issue", issue);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sitewide checks: duplicates, hreflang, llms.txt, AI posture          */
  /* ------------------------------------------------------------------ */

  private applySitewideChecks(targetUrl: string): void {
    // 1. Attach sitewide-only issues (llms.txt + AI posture) to the root page
    // so they flow through the normal summary/recommendation pipeline.
    const root = this.pages.find((p) => p.normalizedUrl === this.rootUrl) || this.pages[0];
    if (root) {
      for (const issue of [...this.llmsTxtIssues, ...this.aiPostureIssues]) {
        root.auditIssues.push(issue);
        root.issues.push(`[${issue.severity}] ${issue.name}`);
        this.emit("issue", issue);
      }
      void targetUrl;
    }

    // 2. Duplicate content: exact-hash groups + shingle-Jaccard near-dups
    try {
      // One input per final URL: a redirected request (e.g. /old → /new) fetched the
      // same document as its target and must not be reported as a duplicate of it.
      const seenFinal = new Set<string>();
      const inputs = this.pages
        .filter((p) => p.status === 200 && this.dupFeatures.has(p.url))
        .sort((a, b) => Number(!!a.isRedirect) - Number(!!b.isRedirect))
        .filter((p) => {
          const key = normalizeUrl((p as any).finalUrl || p.url);
          if (seenFinal.has(key)) return false;
          seenFinal.add(key);
          return true;
        })
        .map((p) => ({ url: p.url, features: this.dupFeatures.get(p.url)! }));
      this.dupFeatures.clear();
      if (inputs.length >= 2) {
        const { exactGroups, nearDuplicates } = detectDuplicatesFromFeatures(inputs);
        const pageByUrl = new Map(this.pages.map((p) => [p.url, p]));
        const pushTo = (url: string, issue: AuditIssue) => {
          const pg = pageByUrl.get(url);
          if (!pg) return;
          pg.auditIssues.push(issue);
          pg.issues.push(`[${issue.severity}] ${issue.name}`);
          this.emit("issue", issue);
        };
        for (const group of exactGroups) {
          const [primary, ...rest] = group;
          for (const dup of rest) {
            pushTo(dup, {
              id: "duplicate_content_exact",
              name: "Exact duplicate content",
              severity: "Error",
              category: "Content",
              message: `Page body text is byte-identical (normalised) to ${primary}. Consolidate with a canonical or rewrite.`,
              url: dup,
              details: { duplicateOf: primary },
            });
          }
        }
        for (const nd of nearDuplicates) {
          pushTo(nd.url, {
            id: "duplicate_content_near",
            name: "Near-duplicate content",
            severity: "Warning",
            category: "Content",
            message: `Page is ${Math.round(nd.similarity * 100)}% similar (5-word shingle Jaccard ≥ 0.85) to ${nd.duplicateOf}. Differentiate or canonicalise to avoid cannibalisation.`,
            url: nd.url,
            details: { duplicateOf: nd.duplicateOf, similarity: nd.similarity },
          });
        }
      }
    } catch {
      /* duplicate detection is non-fatal */
    }

    // 3. hreflang reciprocity audit across the crawled set
    try {
      const hreflangPages = new Map<string, Array<{ lang: string; href: string }>>();
      const pageInfo = new Map<string, { status: number; isIndexable: boolean }>();
      for (const p of this.pages) {
        pageInfo.set(p.url, { status: p.status, isIndexable: p.isIndexable });
        if (p.hreflang && p.hreflang.length > 0 && p.status === 200) {
          // Reconstruct hrefs: PageAuditResult stores langs; recover hrefs from
          // the raw HTML is expensive — instead match by resolving lang→URL via
          // the page's own outgoing alternates is unavailable post-hoc, so we
          // record hreflang presence here and audit reciprocity from stored links.
          hreflangPages.set(p.url, []);
        }
      }
      // Recover full hreflang link pairs from LinkRecords is not available;
      // audit what we can: pages declaring hreflang without x-default/self-ref
      // was already covered per-page. Here we flag clusters where exactly one
      // side declares (unreciprocated cluster) using outgoing internal links
      // as the discovery signal would over-reach — so this pass only runs when
      // href data was captured during the crawl (see hreflangLinks below).
      void hreflangPages;
      const pairs = this.hreflangLinkPairs();
      if (pairs.pages.size > 0) {
        for (const issue of auditHreflangSitewide({ pages: pairs.pages, pageInfo: pairs.pageInfo })) {
          const pg = this.pages.find((p) => p.url === issue.url);
          if (!pg) continue;
          const auditIssue: AuditIssue = {
            id: issue.id,
            name: issue.name,
            severity: issue.severity,
            category: "International",
            message: issue.message,
            url: issue.url,
            details: issue.details,
          };
          pg.auditIssues.push(auditIssue);
          pg.issues.push(`[${auditIssue.severity}] ${auditIssue.name}`);
          this.emit("issue", auditIssue);
        }
      }
    } catch {
      /* hreflang audit is non-fatal */
    }
  }

  /**
   * hreflang pairs captured during the crawl. The per-page check context does
   * not retain hrefs, so the crawler re-derives them here from stored HTML is
   * intentionally skipped (memory); instead this returns an empty map unless
   * a subclass/test injects pairs. Kept as a seam for the render pipeline.
   */
  protected hreflangLinkPairs(): {
    pages: Map<string, Array<{ lang: string; href: string }>>;
    pageInfo: Map<string, { status: number; isIndexable: boolean }>;
  } {
    const pageInfo = new Map<string, { status: number; isIndexable: boolean }>();
    for (const p of this.pages) pageInfo.set(p.url, { status: p.status, isIndexable: p.isIndexable });
    return { pages: this.hreflangPairsByUrl, pageInfo };
  }

  private placeholderPage(url: string, depth: number, issue: AuditIssue): PageAuditResult {
    return {
      url,
      normalizedUrl: normalizeUrl(url),
      finalUrl: url,
      status: 0,
      responseTimeMs: 0,
      depth,
      rendered: false,
      canonicalMatches: false,
      blockedByRobots: true,
      isIndexable: false,
      isOrphan: false,
      internalLinkScore: 0,
      wordCount: 0,
      h1Count: 0,
      h2Count: 0,
      incomingInternalLinks: [],
      outgoingInternalLinks: [],
      externalLinks: [],
      images: [],
      hreflang: [],
      isRedirect: false,
      isHttpToHttpsRedirect: false,
      openGraph: { incomplete: true, missingKeys: ["all"] },
      twitterCard: { incomplete: true },
      schema: {
        hasJsonLd: false,
        typesFound: [],
        missingExpected: [],
        googleRichResultsErrors: [],
        schemaOrgErrors: [],
        errors: [],
        rawGraphCount: 0,
      },
      aeo: {
        score: 0,
        h1Count: 0,
        h2Count: 0,
        hasInvertedPyramidSnippet: false,
        tableCount: 0,
        hasFaqSchema: false,
        recommendations: [],
      },
      issues: [`[${issue.severity}] ${issue.name}`],
      auditIssues: [issue],
    };
  }

  private previousIssueCounts(): Record<string, number> {
    // Hook used by the persistence layer to inject historical deltas.
    return (this as any).__previousIssueCounts || {};
  }

  setPreviousIssueCounts(counts: Record<string, number>): void {
    (this as any).__previousIssueCounts = counts;
  }

  private emitProgress(partial: Partial<CrawlProgress>): void {
    const progress: CrawlProgress = {
      crawlId: this.crawlId,
      status: partial.status || "running",
      crawled: partial.crawled ?? this.pages.length,
      discovered: partial.discovered ?? 0,
      depth: partial.depth ?? this.maxDepthReached,
      currentUrl: partial.currentUrl,
      errors: partial.errors ?? this.errorCount,
      warnings: partial.warnings ?? this.warningCount,
      notices: partial.notices ?? this.noticeCount,
      pagesPerSecond: this.pagesPerSecond(),
      startedAt: this.startedAt,
      finishedAt: partial.status === "completed" || partial.status === "failed" ? new Date().toISOString() : undefined,
      message: partial.message,
    };
    this.emit("progress", progress);
  }

  private pagesPerSecond(): number {
    const elapsed = (Date.now() - new Date(this.startedAt).getTime()) / 1000;
    return elapsed > 0 ? Math.round((this.pages.length / elapsed) * 100) / 100 : 0;
  }
}

export function crawlIdId(crawlId?: string): string {
  return crawlId || `crawl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Convenience single-shot crawl for CLI/MCP use.
 */
/**
 * Worker pool for parse + checks. Defaults to cores-1 (max 4: past that the
 * main thread's fetch/clone work is the limit); 0 disables.
 * Under a TS source run the worker needs the tsx loader in execArgv (it is
 * there for `npx tsx`, not under vitest), so without it we stay inline.
 */
/** Only the loader flags (--require/--import X) — never --eval/--input-type etc. */
const CHECKPOINT_INTERVAL_MS = 30_000;
const CHECKPOINT_VERSION = 1;

/** At most this many requests in flight to any one external host. */
const EXTERNAL_PER_HOST = 2;

/**
 * Split URLs into lanes so no host gets more than `perHost` lanes (= requests
 * in flight). Longest lanes first so big hosts don't finish last.
 */
export function externalLanes(urls: string[], perHost: number): string[][] {
  const byHost = new Map<string, string[][]>();
  for (const u of urls) {
    let host = "";
    try { host = new URL(u).host; } catch { /* keep "" */ }
    let lanes = byHost.get(host);
    if (!lanes) byHost.set(host, (lanes = []));
    if (lanes.length < perHost) lanes.push([u]);
    else lanes.reduce((min, l) => (l.length < min.length ? l : min)).push(u);
  }
  return [...byHost.values()].flat().sort((a, b) => b.length - a.length);
}

function loaderArgs(): string[] {
  const out: string[] = [];
  const a = process.execArgv;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === "--require" || a[i] === "--import" || a[i] === "--loader") && a[i + 1]) out.push(a[i], a[++i]);
    else if (/^--(require|import|loader)=/.test(a[i])) out.push(a[i]);
  }
  return out;
}

function createPagePool(requested?: number): Piscina | null {
  const threads = requested ?? Math.min(4, availableParallelism() - 1);
  if (!threads || threads < 1) return null;
  const isTs = import.meta.url.endsWith(".ts");
  if (isTs && !process.execArgv.some((a) => /tsx/.test(a))) return null;
  try {
    return new Piscina({
      filename: new URL(isTs ? "./page-worker.ts" : "./page-worker.js", import.meta.url).href,
      minThreads: 1,
      maxThreads: threads,
      execArgv: loaderArgs(),
      // Keep idle V8 heaps from ballooning RSS; 384 MB still parses multi-MB pages.
      resourceLimits: { maxOldGenerationSizeMb: 384 },
    });
  } catch {
    return null;
  }
}

export async function crawlSite(
  targetUrl: string,
  options: CrawlOptions & {
    seedUrls?: string[];
    paths?: string[];
    expectedEntities?: string[];
    thresholds?: any;
    sitemapOverride?: string;
    previousIssueCounts?: Record<string, number>;
  } = {}
): Promise<CrawlResult> {
  const crawler = new Crawler();
  if (options.previousIssueCounts) {
    crawler.setPreviousIssueCounts(options.previousIssueCounts);
  }
  return crawler.crawl(targetUrl, options);
}
