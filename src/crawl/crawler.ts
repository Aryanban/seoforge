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
import { CrawlQueue, normalizeUrl, matchesPatterns } from "./queue.js";
import { ResolvedCrawlOptions } from "../config.js";
import { fetchRobots, isDisallowed, RobotsCheckResult } from "./robots.js";
import { parseSitemap } from "./sitemap-parser.js";
import { fetchPage } from "./fetcher.js";
import { extractLinks, extractImages, ExtractedLinks } from "./link-extractor.js";
import { renderUrl } from "./renderer.js";
import { runPageChecks, PageCheckContext } from "../checks/registry.js";
import { buildIssueSummary } from "../checks/summary.js";
import { generateRecommendations } from "../ai/recommendations.js";

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
  private robots: RobotsCheckResult | null = null;
  private sitemapEntries: SitemapEntry[] = [];
  private sitemapUrlSet = new Set<string>();
  private sitemapAccessible = false;
  private sitemapUrlCount = 0;
  private robotsAccessible = false;
  private llmsTxtAccessible?: boolean;
  private llmsFullTxtAccessible?: boolean;
  private maxDepthReached = 0;
  private requestedCount = 0;
  private lastRequestTimes: number[] = [];
  private crawlId: string;
  private rootUrl = "";
  /**
   * Fetches currently in flight. New URLs are only discovered by a page that
   * is being fetched, so the crawl is genuinely finished only when the queue
   * is empty AND nothing is in flight. Without this, workers exit the moment
   * the queue is briefly empty (e.g. right after the seed URL is dequeued)
   * and the crawl collapses to a single worker — killing all parallelism.
   */
  private activeFetches = 0;

  constructor(crawlId?: string) {
    super();
    this.crawlId = crawlIdId(crawlId);
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
    this.startedAt = new Date().toISOString();
    this.rootUrl = normalizeUrl(targetUrl);

    this.emitProgress({
      status: "running",
      crawled: 0,
      discovered: 0,
      depth: 0,
      message: `Resolving robots.txt and sitemap for ${origin}…`,
    });

    // 1. robots.txt
    this.robots = await fetchRobots(`${origin}/robots.txt`);
    this.robotsAccessible = this.robots.accessible;

    // 2. sitemap.xml (explicit, from robots directive, or default)
    const sitemapUrl =
      opts.sitemapOverride ||
      this.robots.sitemaps[0] ||
      `${origin}/sitemap.xml`;
    if (opts.followSitemap !== false && sitemapUrl) {
      const sitemapResult = await parseSitemap(sitemapUrl, {
        limit: opts.limit ? opts.limit * 20 : 200000,
      });
      this.sitemapAccessible = sitemapResult.accessible;
      this.sitemapEntries = sitemapResult.entries;
      this.sitemapUrlCount = sitemapResult.urlCount;
      this.sitemapUrlSet = new Set(sitemapResult.entries.map((e) => normalizeUrl(e.url)));
    }

    // 3. llms.txt probes
    this.llmsTxtAccessible = await this.probe(`${origin}/llms.txt`);
    this.llmsFullTxtAccessible = await this.probe(`${origin}/llms-full.txt`);

    // 4. Seed the queue per strategy
    const queue = new CrawlQueue(opts.maxDepth, opts.limit);
    this.seedQueue(queue, opts, targetUrl);

    // 5. Crawl with a worker pool
    await this.runWorkers(queue, opts, targetUrl);

    // 6. Link verification (internal non-HTML + external)
    await this.verifyLinkTargets(opts, origin);

    // 7. Link-graph pass: incoming links, orphans, internal link score
    this.applyLinkGraph();

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

    this.emit("done", result);
    return result;
  }

  /* ------------------------------------------------------------------ */

  private resolveOptions(targetUrl: string, options: CrawlOptions): ResolvedCrawlOptions {
    const o = { ...options };
    return {
      maxDepth: o.maxDepth ?? 10,
      concurrency: o.concurrency ?? 8,
      limit: o.limit ?? 1000,
      render: o.render ?? false,
      strategy: (o.strategy ?? "discover") as CrawlStrategy,
      sampleSitemap: o.sampleSitemap ?? 0,
      canonicalPolicy: o.canonicalPolicy ?? "strict",
      respectRobots: o.respectRobots ?? true,
      maxRequestsPerSecond: o.maxRequestsPerSecond ?? 20,
      excludePatterns: o.excludePatterns ?? [],
      checkExternalLinks: o.checkExternalLinks ?? true,
      externalLinkTimeoutMs: o.externalLinkTimeoutMs ?? 8000,
      timeoutMs: o.timeoutMs ?? 15000,
      followSitemap: o.followSitemap ?? true,
      sitemapOverride: o.sitemapOverride,
      expectedEntities: o.expectedEntities ?? [],
      thresholds: o.thresholds,
      paths: o.paths,
      seedUrls: o.seedUrls,
    };
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
      for (const u of opts.seedUrls) {
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

    for (let i = 0; i < concurrency; i++) {
      workers.push(this.worker(queue, opts, targetUrl));
    }
    await Promise.all(workers);
  }

  private async worker(queue: CrawlQueue, opts: any, targetUrl: string): Promise<void> {
    while (!this.stopped) {
      const item = queue.dequeue();

      // No work right now. New URLs can only be produced by a page currently
      // being fetched, so if something is in flight we must WAIT for it to
      // enqueue more — exiting here would strand the other workers and
      // collapse the crawl to a single concurrent request.
      if (!item) {
        if (this.activeFetches === 0) return;
        await new Promise((r) => setTimeout(r, 25));
        continue;
      }
      if (queue.isBudgetExhausted && this.pages.length >= opts.limit) return;

      // Claim the item synchronously, before any await, so sibling workers
      // observe in-flight work and wait rather than exiting while the queue
      // is momentarily empty.
      this.activeFetches++;
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
        this.pages.push(blockedPage);
        this.emit("page", blockedPage);
        this.emit("issue", blockedIssue);
        this.emitProgress({ status: "running", crawled: this.pages.length, discovered: queue.discovered, depth: item.depth, currentUrl: item.url });
        continue;
      }

        await this.throttle(opts);

        const pageData = await this.fetchPageData(item.url, item.depth, opts);
        queue.markVisited(item.normalizedUrl);

      const links = pageData.html
        ? extractLinks(pageData.html, pageData.finalUrl)
        : { links: [], internalTargets: [], externalTargets: [] };
      const images = pageData.html ? extractImages(pageData.html, pageData.finalUrl) : [];
      this.rawExtractedLinks.push(links);
      this.allImages.push(...images);

      // Enqueue discovered internal links (all strategies follow links)
      for (const target of links.internalTargets) {
        const norm = normalizeUrl(target);
        if (matchesPatterns(target, opts.excludePatterns)) continue;
        queue.enqueue(target, norm, item.depth + 1, item.url);
      }

      // Run audit checks
      const ctx: Omit<PageCheckContext, "meta"> = {
        pageUrl: item.url,
        finalUrl: pageData.finalUrl,
        html: pageData.html,
        status: pageData.status,
        responseTimeMs: pageData.responseTimeMs,
        ttfbMs: pageData.ttfbMs,
        depth: item.depth,
        rendered: pageData.rendered,
        headers: pageData.headers,
        links,
        images,
        robots: this.robots,
        options: opts,
        thresholds: opts.thresholds,
        expectedEntities: opts.expectedEntities,
        canonicalPolicy: opts.canonicalPolicy,
        cwv: pageData.cwv,
        sitemapUrls: this.sitemapUrlSet,
        sourceUrl: item.source,
        isRedirect: pageData.isRedirect,
        redirectChain: pageData.redirectChain,
        isHttpToHttpsRedirect: pageData.isHttpToHttpsRedirect,
      };

      const { page, issues } = runPageChecks(ctx);
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
        this.activeFetches--;
      }
    }
  }

  private async fetchPageData(url: string, depth: number, opts: any) {
    if (opts.render) {
      const rendered = await renderUrl(url, {
        timeoutMs: opts.timeoutMs,
        blockHeavyResources: false,
      });
      if (rendered.html) {
        const raw = await fetchPage(url, { timeoutMs: opts.timeoutMs, method: "GET" });
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
          rendered: true,
          headers: raw.headers,
          contentType: raw.contentType,
          contentLengthBytes: raw.contentLengthBytes,
          cwv: rendered.cwv,
          errorMessage: raw.errorMessage,
        };
      }
      // render failed → fall back to raw fetch with the render error preserved
      const raw = await fetchPage(url, { timeoutMs: opts.timeoutMs, method: "GET" });
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
    const isHtml = (raw.contentType || "").includes("html") || raw.html.length > 0;
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
      html: isHtml ? raw.html : "",
      rendered: false,
      headers: raw.headers,
      contentType: raw.contentType,
      contentLengthBytes: raw.contentLengthBytes,
      cwv: undefined,
      errorMessage: raw.errorMessage,
    };
  }

  private async throttle(opts: any): Promise<void> {
    const rps = opts.maxRequestsPerSecond;
    if (!rps || rps <= 0) return;
    const minInterval = 1000 / rps;
    const now = Date.now();
    this.lastRequestTimes = this.lastRequestTimes.filter((t) => now - t < 1000);
    if (this.lastRequestTimes.length >= rps) {
      const wait = minInterval - (now - this.lastRequestTimes[0]);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequestTimes.push(Date.now());

    // robots crawl-delay politeness
    const delay = this.robots?.crawlDelay;
    if (delay && delay > 0) {
      await new Promise((r) => setTimeout(r, Math.min(delay * 1000, 5000)));
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
    const checkOne = async (current: string) => {
      const info = targetMap.get(current)!;
      const res = await fetchPage(current, {
        timeoutMs: info.isInternal ? opts.timeoutMs : opts.externalLinkTimeoutMs,
        method: "HEAD",
        followRedirects: true,
      });
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
          isBroken: res.status >= 400 || res.status === 0,
          isRedirect: res.redirected || (res.status >= 300 && res.status < 400),
          redirectChain: res.redirectChain,
        });
      }
    };

    const runPool = async (items: string[], poolSize: number) => {
      let index = 0;
      const worker = async () => {
        while (index < items.length) {
          const current = items[index++];
          await checkOne(current);
        }
      };
      const size = Math.max(1, Math.min(poolSize, items.length));
      await Promise.all(Array.from({ length: size }, () => worker()));
    };

    const internalTargets = toVerify.filter((u) => targetMap.get(u)?.isInternal);
    const externalTargets = toVerify.filter((u) => !targetMap.get(u)?.isInternal);

    await Promise.all([
      runPool(internalTargets, opts.concurrency || 6),
      runPool(externalTargets, 16),
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
    const outDegree = new Map<string, number>();
    for (const p of this.pages) {
      const outs = new Set(
        this.allLinks
          .filter((l) => normalizeUrl(l.source) === p.normalizedUrl && l.isInternal && !l.nofollow)
          .map((l) => normalizeUrl(l.target))
          .filter((t) => pageByNorm.has(t) && t !== p.normalizedUrl)
      );
      outDegree.set(p.normalizedUrl, outs.size);
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

function crawlIdId(crawlId?: string): string {
  return crawlId || `crawl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Convenience single-shot crawl for CLI/MCP use.
 */
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
