/**
 * Model Context Protocol server — lets AI agents (Claude, Cursor, Antigravity,
 * Zed) drive SEOForge autonomously: run full-site crawls, read grouped issues,
 * fetch deterministic AI fix markdown, and dispatch IndexNow pings.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import {
  CrawlOptions,
  CrawlResult,
  DomainAuditResult,
  OverallAuditReport,
} from "../types.js";
import { Crawler } from "../crawl/crawler.js";
import { crawlSite } from "../crawl/crawler.js";
import { auditSinglePage } from "../audit-page.js";
import { parseSitemap } from "../crawl/sitemap-parser.js";
import { submitToIndexNow } from "../indexnow.js";
import { saveMarkdownReport } from "../report/markdown.js";
import { generateFixBacklogMarkdown } from "../ai/recommendations.js";
import { generateAeoSnippet } from "../ai/snippets.js";
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
import { loadConfig, mergeCrawlOptions } from "../config.js";
import { openStore } from "../store/db.js";
import * as repo from "../store/repository.js";

interface AsyncJob {
  crawlId: string;
  crawler: Crawler;
  targetUrl: string;
  result?: CrawlResult;
  error?: string;
}
const asyncJobs = new Map<string, AsyncJob>();

function summarizeForAgent(result: CrawlResult) {
  return {
    crawlId: result.id,
    targetUrl: result.targetUrl,
    status: result.status,
    strategy: result.strategy,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    pagesCrawled: result.totalUrlsCrawled,
    maxDepthReached: result.maxDepthReached,
    robotsAccessible: result.robotsAccessible,
    sitemapAccessible: result.sitemapAccessible,
    sitemapUrlCount: result.sitemapUrlCount,
    llmsTxtAccessible: result.llmsTxtAccessible,
    averageAeoScore: result.averageAeoScore,
    totalErrors: result.totalErrors,
    totalWarnings: result.totalWarnings,
    totalNotices: result.totalNotices,
    passed: result.passed,
  };
}

export function createMcpServer(): Server {
  const server = new Server(
    { name: "seoforge", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "seoforge_crawl",
        description:
          "Run a FULL-SITE crawl (BFS with robots compliance, sitemap discovery, broken-link verification, and a link-graph pass). Returns grouped issues plus deterministic AI fix markdown for every issue. This is the primary audit entry point.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Root URL to crawl (e.g. 'https://www.webforge.me'). Uses the first configured domain if omitted." },
            domain: { type: "string", description: "Name or URL substring of a configured domain to crawl." },
            max_depth: { type: "number", description: "Maximum crawl depth (default 10)." },
            limit: { type: "number", description: "Crawl budget — maximum pages to fetch (default 1000)." },
            concurrency: { type: "number", description: "Concurrent requests (default 8)." },
            render: { type: "boolean", description: "Enable Playwright JS rendering for SPAs (requires `npm i playwright && npx playwright install chromium`)." },
            strategy: { type: "string", enum: ["discover", "sitemap", "config"], description: "'discover' BFS from root; 'sitemap' seed from sitemap URLs; 'config' use configured paths." },
            async_mode: { type: "boolean", description: "Return a crawlId immediately and poll with seoforge_crawl_status (recommended for large sites)." },
            save_report: { type: "boolean", description: "Write the markdown report to reports/ (default true)." },
          },
        },
      },
      {
        name: "seoforge_crawl_status",
        description: "Poll the status of an asynchronous crawl started with seoforge_crawl (async_mode: true).",
        inputSchema: {
          type: "object",
          properties: { crawl_id: { type: "string", description: "Crawl ID returned by seoforge_crawl" } },
          required: ["crawl_id"],
        },
      },
      {
        name: "seoforge_get_issues",
        description: "Read grouped issues for a completed crawl (optionally filtered by severity), with affected URLs and recommendations.",
        inputSchema: {
          type: "object",
          properties: {
            crawl_id: { type: "string" },
            severity: { type: "string", enum: ["Error", "Warning", "Notice"] },
            limit: { type: "number", description: "Max issue groups to return (default 50)." },
          },
          required: ["crawl_id"],
        },
      },
      {
        name: "seoforge_get_recommendations",
        description: "Read the deterministic AI fix markdown for every issue in a crawl — each with why-it-matters, numbered fix steps, and before/after examples. Use this to write fix tickets or pull-request descriptions.",
        inputSchema: {
          type: "object",
          properties: {
            crawl_id: { type: "string" },
            priority: { type: "string", enum: ["Critical", "High", "Medium", "Low"] },
          },
          required: ["crawl_id"],
        },
      },
      {
        name: "seoforge_get_page",
        description: "Read the full audit detail for one page of a completed crawl (status, meta, headings, links, schema, AEO score, per-page issues).",
        inputSchema: {
          type: "object",
          properties: { crawl_id: { type: "string" }, url: { type: "string" } },
          required: ["crawl_id", "url"],
        },
      },
      {
        name: "seoforge_link_report",
        description: "Read the internal/external link report: broken links, redirecting links, anchor text, orphan pages, and internal link scores.",
        inputSchema: {
          type: "object",
          properties: {
            crawl_id: { type: "string" },
            kind: { type: "string", enum: ["broken", "internal", "external", "redirects"], description: "Filter the link set (default: broken)." },
            limit: { type: "number", description: "Max rows (default 50)." },
          },
          required: ["crawl_id"],
        },
      },
      {
        name: "seoforge_sitemap_report",
        description: "Read the XML sitemap report: accessibility, URL count, and URLs listed in the sitemap that have no internal links (orphan-in-sitemap).",
        inputSchema: { type: "object", properties: { crawl_id: { type: "string" } }, required: ["crawl_id"] },
      },
      {
        name: "seoforge_export_report",
        description: "Export a completed crawl as markdown, CSV (pages/issues/links/recommendations), or a self-contained HTML report.",
        inputSchema: {
          type: "object",
          properties: {
            crawl_id: { type: "string" },
            format: { type: "string", enum: ["md", "csv", "html"], description: "Export format (default md)." },
            csv_kind: { type: "string", enum: ["pages", "issues", "links", "recommendations"] },
          },
          required: ["crawl_id"],
        },
      },
      {
        name: "seoforge_inspect_url",
        description:
          "Deep-inspect a single URL in real time: TTFB/latency, canonical match, meta tags, Schema.org entities, Core Web Vitals (render mode), AEO score, and actionable issues. Does not crawl the site.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Full HTTPS URL to inspect" },
            expected_entities: { type: "array", items: { type: "string" }, description: "Expected Schema.org types (e.g. ['WebSite','FAQPage'])" },
            canonical_policy: { type: "string", enum: ["strict", "spa"] },
            render: { type: "boolean", description: "Render with headless Chromium (SPA support)." },
          },
          required: ["url"],
        },
      },
      {
        name: "seoforge_submit_indexnow",
        description: "Submit URLs to Bing & Yandex via the IndexNow protocol for immediate re-crawling.",
        inputSchema: {
          type: "object",
          properties: {
            urls: { type: "array", items: { type: "string" } },
            key: { type: "string", description: "Optional 32-character IndexNow key." },
          },
          required: ["urls"],
        },
      },
      {
        name: "seoforge_sample_sitemap",
        description: "Extract all URLs from an XML sitemap and audit N randomly selected deep routes.",
        inputSchema: {
          type: "object",
          properties: {
            sitemap_url: { type: "string" },
            count: { type: "number", description: "Random URLs to audit (default 5, max 20)" },
          },
          required: ["sitemap_url"],
        },
      },
      {
        name: "seoforge_check_llms_txt",
        description: "Validate /llms.txt and /llms-full.txt for AI crawlers (Claude, GPTBot, Perplexity).",
        inputSchema: {
          type: "object",
          properties: { base_url: { type: "string" } },
          required: ["base_url"],
        },
      },
      {
        name: "seoforge_generate_aeo_snippet",
        description:
          "Generate an optimal 40–55 word inverted-pyramid answer paragraph, a comparison table, and FAQPage JSON-LD for AI answer engines.",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string" },
            target_keyword: { type: "string" },
            entity_category: { type: "string" },
            details: { type: "string" },
          },
          required: ["topic", "target_keyword"],
        },
      },
      {
        name: "seoforge_daily_run",
        description: "Full daily routine: audit all configured domains, save the markdown report, and dispatch IndexNow pings.",
        inputSchema: {
          type: "object",
          properties: { save_report: { type: "boolean", description: "Save the report to reports/ (default true)" } },
        },
      },
      {
        name: "seoforge_publishing_plan",
        description: "Build a tailored publishing/backlink-prospect plan from a business profile against the 206-source catalog. Returns prioritized posting tasks with outlines, posting steps, link guidance and capacity-based dates. Deterministic, no network. With no profile, browses the catalog by topic/kind/status.",
        inputSchema: {
          type: "object",
          properties: {
            business: { type: "string", description: "Business or brand name" },
            website: { type: "string", description: "Your site URL" },
            audience: { type: "string", description: "Who you are trying to reach" },
            topics: { type: "array", items: { type: "string" }, description: "Topic tags such as technology, business, travel" },
            markets: { type: "array", items: { type: "string" }, description: "Regions you serve" },
            assets: { type: "array", items: { type: "string" }, description: "Eligibility assets you have (e.g. a GitHub org)" },
            posts_per_week: { type: "number", description: "Realistic publishing capacity, 1-7 (default 2)" },
            pages: {
              type: "array",
              items: {
                type: "object",
                properties: { url: { type: "string" }, topic: { type: "string" }, status: { type: "string" } },
                required: ["url", "topic"],
              },
              description: "Target pages on your site that published contributions can link to",
            },
            limit: { type: "number", description: "Requested shortlist size, 1-20 (default 15)" },
            category: { type: "string", description: "Catalog-only filter: topic tag" },
            kind: { type: "string", description: "Catalog-only filter: article, community, answer..." },
            status: { type: "string", description: "Catalog-only filter: guidance_reviewed, unreviewed..." },
          },
          required: [],
        },
      },
      {
        name: "seoforge_reputation_report",
        description: "Verify candidate backlink/mention source pages against your site and score reputation under model 1.1 (conservative: unknown evidence is never inflated, low-confidence headlines cap at 49/100). Pass an array of candidate source URLs (from search results or an export). Returns score, sensitivity range, confidence, coverage, strongest observed backlinks and mentions.",
        inputSchema: {
          type: "object",
          properties: {
            target_url: { type: "string", description: "Your site URL" },
            brand: { type: "string", description: "Brand name to detect as a mention" },
            sources: {
              type: "array",
              items: { type: "string" },
              description: "Candidate source page URLs to verify (search results or supplied URLs)",
            },
            aliases: { type: "array", items: { type: "string" }, description: "Extra brand name variants" },
            related_hosts: { type: "array", items: { type: "string" }, description: "Hosts treated as owned; never count as independent proof" },
            limit: { type: "number", description: "Max sources to verify, 1-500 (default 30)" },
            search_pages: { type: "number", description: "Requested search-page budget, 1-20 (default 5)" },
            render: { type: "boolean", description: "Use a browser for script-heavy source pages" },
          },
          required: ["target_url", "brand", "sources"],
        },
      },
      {
        name: "seoforge_compare_competitors",
        description: "Compare your site against competitor sites on measured crawl evidence (AEO score, issue counts, content depth, schema coverage, internal-link strength). Accepts stored crawl IDs, or URLs to crawl live with a small budget. Returns a metric matrix and prioritized gaps with recommendations. Discloses crawl-budget parity so uneven samples cannot pose as a ranking verdict.",
        inputSchema: {
          type: "object",
          properties: {
            crawl_id: { type: "string", description: "Baseline crawl ID (default: most recent)" },
            competitor_crawl_ids: { type: "array", items: { type: "string" }, description: "Stored competitor crawl IDs (1-5)" },
            target_url: { type: "string", description: "Crawl this URL live as the baseline" },
            competitor_urls: { type: "array", items: { type: "string" }, description: "Competitor URLs to crawl live (1-5)" },
            limit: { type: "number", description: "Crawl budget when crawling live (default 50)" },
          },
          required: [],
        },
      },
      {
        name: "seoforge_discover_sources",
        description: "Discover candidate backlink/mention sources for a site from bounded public search, saved result-page snapshots, or supplied URLs — without an API key or paid index. Tries recorded host search results first, then native providers (DuckDuckGo HTML, Bing RSS) with zero retries and a strict request budget. Every result is an UNVERIFIED LEAD: feed the returned candidates to seoforge_reputation_report to verify actual links and mentions on the pages. Honours robots per provider; offline mode imports supplied evidence only.",
        inputSchema: {
          type: "object",
          properties: {
            target_url: { type: "string", description: "Your site URL; own-site results are filtered out of the leads" },
            queries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  market: { type: "string" },
                  language: { type: "string" },
                },
                required: ["query"],
              },
              description: "Search queries to run (e.g. \"\\\"Brand\\\" -site:example.com\")",
            },
            providers: {
              type: "array",
              items: { type: "string", enum: ["duckduckgo-html", "bing-rss"] },
              description: "Native providers to try in order (default both)",
            },
            candidates: { type: "array", items: { type: "string" }, description: "Candidate URLs already known (skips searching for them)" },
            saved_searches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  provider: { type: "string", enum: ["duckduckgo-html", "bing-rss", "bing", "google"] },
                  query: { type: "string" },
                  captured_at: { type: "string" },
                },
                required: ["path", "provider", "query", "captured_at"],
              },
              description: "Saved result-page HTML snapshots on disk to import instead of searching live",
            },
            host_records: {
              type: "array",
              items: { type: "object" },
              description: "Search attempts recorded by your own search tool ({provider, query, captured_at, status, evidence, results})",
            },
            offline: { type: "boolean", description: "Never make a live search request; imports/supplied URLs only" },
            max_requests: { type: "number", description: "Total native request budget, 1-100 (default 16)" },
            max_queries: { type: "number", description: "Queries to process, 1-20 (default 8)" },
            max_candidates: { type: "number", description: "Candidate URLs to keep, 1-500 (default 100)" },
            timeout_seconds: { type: "number", description: "Per-request timeout seconds, 1-30 (default 12)" },
            seconds: { type: "number", description: "Wall-clock budget seconds, 1-300 (default 90)" },
            out_dir: { type: "string", description: "Write discovery.json + sources.csv + markdown under this directory" },
          },
          required: ["target_url"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      /* ------------------------------------------------------------ */
      if (name === "seoforge_crawl") {
        const config = await loadConfig(args?.config_path as string | undefined).catch(() => null);
        let targetUrl = args?.url as string | undefined;
        let domainName: string | undefined;
        let project: string | undefined;
        let crawlOpts: CrawlOptions = {};

        if (!targetUrl) {
          if (!config) return err("No URL provided and no configuration file found.");
          const match = args?.domain
            ? config.domains.find(
                (d) =>
                  d.name.toLowerCase().includes((args!.domain as string).toLowerCase()) ||
                  d.url.toLowerCase().includes((args!.domain as string).toLowerCase())
              )
            : config.domains[0];
          if (!match) return err(`No domain matching '${args?.domain}' in configuration.`);
          targetUrl = match.url;
          domainName = match.name;
          project = config.project;
          crawlOpts = mergeCrawlOptions(config, match, {
            maxDepth: numArg(args?.max_depth),
            limit: numArg(args?.limit),
            concurrency: numArg(args?.concurrency),
            render: args?.render as boolean | undefined,
            strategy: args?.strategy as any,
          });
          crawlOpts.expectedEntities = match.expectedEntities;
          crawlOpts.thresholds = config.thresholds as any;
          (crawlOpts as any).paths = match.paths;
          (crawlOpts as any).sitemapOverride = match.sitemap;
        } else {
          crawlOpts = {
            maxDepth: numArg(args?.max_depth) ?? 10,
            limit: numArg(args?.limit) ?? 1000,
            concurrency: numArg(args?.concurrency) ?? 8,
            render: (args?.render as boolean) ?? false,
            strategy: (args?.strategy as any) ?? "discover",
          };
        }

        const crawlId = `crawl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const crawler = new Crawler(crawlId);

        if (args?.async_mode) {
          const job: AsyncJob = { crawlId, crawler, targetUrl };
          asyncJobs.set(crawlId, job);
          crawler.crawl(targetUrl, crawlOpts).then(
            (result) => {
              const full: CrawlResult = { ...result, id: crawlId, project, domainName };
              job.result = full;
              persist(full);
            },
            (error) => {
              job.error = error.message;
            }
          );
          return ok({
            crawlId,
            targetUrl,
            status: "running",
            message: "Poll with seoforge_crawl_status until status is 'completed'.",
          });
        }

        const result = await crawler.crawl(targetUrl, crawlOpts);
        const full: CrawlResult = { ...result, id: crawlId, project, domainName };
        persist(full);

        let reportPath = "";
        if (args?.save_report !== false) {
          reportPath = await saveMarkdownReport(full).catch(() => "");
        }

        return ok({
          summary: summarizeForAgent(full),
          reportPath: reportPath || undefined,
          issues: full.issuesSummary.slice(0, 100).map((i) => ({
            issue: i.name,
            severity: i.severity,
            category: i.category,
            affectedPages: i.affectedPages,
            change: i.change,
            recommendation: i.recommendation,
            sampleUrls: i.affectedUrls.slice(0, 5),
          })),
          recommendationsMarkdown: full.recommendations.slice(0, 25).map((r) => ({
            priority: r.priority,
            effort: r.effort,
            issue: r.name,
            affectedPages: r.affectedPages,
            markdown: r.markdown,
          })),
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_crawl_status") {
        const crawlId = args?.crawl_id as string;
        const job = asyncJobs.get(crawlId);
        if (!job) return err(`No async crawl with id '${crawlId}'.`);
        if (job.error) return err(`Crawl failed: ${job.error}`);
        if (!job.result) {
          return ok({ crawlId, targetUrl: job.targetUrl, status: "running" });
        }
        const full = job.result;
        return ok({
          ...summarizeForAgent(full),
          issueGroups: full.issuesSummary.length,
          recommendations: full.recommendations.length,
          message: "Crawl complete — use seoforge_get_issues / seoforge_get_recommendations to read results.",
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_get_issues") {
        const result = await loadFullResult(args?.crawl_id as string);
        if (!result) return err("Crawl not found.");
        const severity = args?.severity as string | undefined;
        let issues = result.issuesSummary;
        if (severity) issues = issues.filter((i) => i.severity === severity);
        const limit = numArg(args?.limit) ?? 50;
        return ok({
          crawlId: result.id,
          targetUrl: result.targetUrl,
          totalGroups: issues.length,
          issues: issues.slice(0, limit).map((i) => ({
            issue: i.name,
            severity: i.severity,
            category: i.category,
            affectedPages: i.affectedPages,
            change: i.change,
            recommendation: i.recommendation,
            affectedUrls: i.affectedUrls.slice(0, 25),
          })),
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_get_recommendations") {
        const result = await loadFullResult(args?.crawl_id as string);
        if (!result) return err("Crawl not found.");
        const priority = args?.priority as string | undefined;
        let recs = result.recommendations;
        if (priority) recs = recs.filter((r) => r.priority === priority);
        return ok({
          crawlId: result.id,
          targetUrl: result.targetUrl,
          count: recs.length,
          fullBacklogMarkdown: generateFixBacklogMarkdown(recs),
          recommendations: recs.map((r) => ({
            priority: r.priority,
            effort: r.effort,
            issue: r.name,
            severity: r.severity,
            category: r.category,
            affectedPages: r.affectedPages,
            recommendation: r.recommendation,
            markdown: r.markdown,
          })),
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_get_page") {
        const result = await loadFullResult(args?.crawl_id as string);
        if (!result) return err("Crawl not found.");
        const url = (args?.url as string).toLowerCase();
        const page = result.pages.find((p) => p.url.toLowerCase() === url || p.normalizedUrl === url);
        if (!page) return err("Page not found in this crawl.");
        return ok({
          url: page.url,
          status: page.status,
          depth: page.depth,
          title: page.title,
          description: page.description,
          canonical: page.canonical,
          canonicalMatches: page.canonicalMatches,
          h1Text: page.h1Text,
          h1Count: page.h1Count,
          h2Count: page.h2Count,
          wordCount: page.wordCount,
          incomingLinks: page.incomingInternalLinks.length,
          outgoingLinks: page.outgoingInternalLinks.length,
          externalLinks: page.externalLinks.length,
          isOrphan: page.isOrphan,
          internalLinkScore: page.internalLinkScore,
          isIndexable: page.isIndexable,
          aeoScore: page.aeo.score,
          schemaTypes: page.schema.typesFound,
          schemaErrors: [...page.schema.schemaOrgErrors, ...page.schema.googleRichResultsErrors],
          coreWebVitals: page.cwv,
          issues: page.auditIssues.map((i) => ({ severity: i.severity, category: i.category, issue: i.name, message: i.message })),
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_link_report") {
        const result = await loadFullResult(args?.crawl_id as string);
        if (!result) return err("Crawl not found.");
        const kind = (args?.kind as string) || "broken";
        const limit = numArg(args?.limit) ?? 50;
        let links = result.links;
        if (kind === "broken") links = links.filter((l) => l.isBroken);
        if (kind === "redirects") links = links.filter((l) => l.isRedirect && !l.isBroken);
        if (kind === "internal") links = links.filter((l) => l.isInternal);
        if (kind === "external") links = links.filter((l) => !l.isInternal);
        return ok({
          crawlId: result.id,
          kind,
          total: links.length,
          links: links.slice(0, limit).map((l) => ({
            from: l.source,
            to: l.target,
            anchorText: l.anchorText || "(empty)",
            type: l.isInternal ? "internal" : "external",
            nofollow: l.nofollow,
            status: l.targetStatus,
            broken: l.isBroken,
            redirect: l.isRedirect,
          })),
          orphanPages: result.pages.filter((p) => p.isOrphan).map((p) => ({ url: p.url, incomingLinks: p.incomingInternalLinks.length })),
          topInternalLinkScore: [...result.pages]
            .sort((a, b) => b.internalLinkScore - a.internalLinkScore)
            .slice(0, 10)
            .map((p) => ({ url: p.url, score: p.internalLinkScore, incoming: p.incomingInternalLinks.length })),
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_sitemap_report") {
        const result = await loadFullResult(args?.crawl_id as string);
        if (!result) return err("Crawl not found.");
        const orphanInSitemap = result.pages.filter((p) =>
          p.auditIssues.some((i) => i.id === "orphan_in_sitemap")
        );
        const missingFromSitemap = result.pages.filter((p) =>
          p.auditIssues.some((i) => i.id === "not_in_sitemap")
        );
        return ok({
          crawlId: result.id,
          sitemapAccessible: result.sitemapAccessible,
          sitemapUrlCount: result.sitemapUrlCount,
          crawledPages: result.totalUrlsCrawled,
          orphanInSitemap: orphanInSitemap.map((p) => p.url),
          missingFromSitemap: missingFromSitemap.map((p) => p.url),
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_export_report") {
        const result = await loadFullResult(args?.crawl_id as string);
        if (!result) return err("Crawl not found.");
        const format = (args?.format as string) || "md";
        const reportPath = await saveMarkdownReport(result).catch(() => "");
        if (format === "html") {
          const { generateHtmlReport } = await import("../report/html.js");
          const out = path.join(process.cwd(), "reports", `crawl-html-${new Date().toISOString().split("T")[0]}.html`);
          await fs.mkdir(path.dirname(out), { recursive: true });
          await fs.writeFile(out, generateHtmlReport(result), "utf-8");
          return ok({ format: "html", path: out });
        }
        if (format === "csv") {
          const { toCsv } = await import("../report/csv.js");
          const kind = (args?.csv_kind as any) || "pages";
          const out = path.join(process.cwd(), "reports", `crawl-${kind}-${new Date().toISOString().split("T")[0]}.csv`);
          await fs.mkdir(path.dirname(out), { recursive: true });
          await fs.writeFile(out, toCsv(result, kind), "utf-8");
          return ok({ format: "csv", kind, path: out });
        }
        return ok({ format: "md", path: reportPath });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_inspect_url") {
        const url = args?.url as string;
        const { page, issues } = await auditSinglePage(url, {
          expectedEntities: args?.expected_entities as string[] | undefined,
          canonicalPolicy: args?.canonical_policy as any,
          render: args?.render as boolean | undefined,
        });
        return ok({ page, issues });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_submit_indexnow") {
        const urls = args?.urls as string[];
        const config = await loadConfig(args?.config_path as string | undefined).catch(() => null);
        const key = (args?.key as string) || config?.indexnow?.key || "";
        const byHost = new Map<string, string[]>();
        for (const u of urls) {
          try {
            const host = new URL(u).hostname;
            const list = byHost.get(host) || [];
            list.push(u);
            byHost.set(host, list);
          } catch {
            /* skip invalid */
          }
        }
        const responses = [];
        for (const [host, list] of byHost.entries()) {
          const res = await submitToIndexNow({ host, key, keyLocation: config?.indexnow?.keyLocation, urlList: list });
          responses.push({ host, count: list.length, ...res });
        }
        return ok({ submitted: urls.length, results: responses });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_sample_sitemap") {
        const sitemapUrl = args?.sitemap_url as string;
        const count = Math.min(20, Math.max(1, numArg(args?.count) ?? 5));
        const parsed = await parseSitemap(sitemapUrl, { limit: 200000 });
        if (!parsed.accessible) return err(`Sitemap returned an error or invalid XML (${parsed.errors.join("; ")})`);
        const shuffled = [...parsed.entries].sort(() => 0.5 - Math.random());
        const sampled = shuffled.slice(0, count);
        const results = [];
        for (const entry of sampled) {
          const { page } = await auditSinglePage(entry.url);
          results.push(page);
        }
        return ok({
          sitemapUrl,
          totalUrlsInSitemap: parsed.urlCount,
          hasSitemapIndex: parsed.hasSitemapIndex,
          sampledCount: sampled.length,
          results,
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_check_llms_txt") {
        const base = (args?.base_url as string).replace(/\/$/, "");
        const probe = async (url: string) => {
          try {
            const res = await fetch(url, { headers: { "User-Agent": "SEOForgeBot/2.0" } });
            if (res.status !== 200) return { url, status: res.status, length: 0, preview: "" };
            const body = await res.text();
            return { url, status: res.status, length: body.length, preview: body.slice(0, 400) };
          } catch (e: any) {
            return { url, status: 0, length: 0, preview: `Error: ${e.message}` };
          }
        };
        return ok({
          domain: base,
          llmsTxt: await probe(`${base}/llms.txt`),
          llmsFullTxt: await probe(`${base}/llms-full.txt`),
          compliant: (await probe(`${base}/llms.txt`)).status === 200,
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_generate_aeo_snippet") {
        const result = generateAeoSnippet({
          topic: args?.topic as string,
          targetKeyword: args?.target_keyword as string,
          entityCategory: args?.entity_category as string,
          details: args?.details as string,
        });
        return ok(result);
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_daily_run") {
        const config = await loadConfig(args?.config_path as string | undefined);
        const results: DomainAuditResult[] = [];
        const criticalIssues: string[] = [];

        for (const domain of config.domains) {
          const opts = mergeCrawlOptions(config, domain);
          const res = await crawlSite(domain.url, opts);
          if (!res.passed) criticalIssues.push(`Domain '${domain.name}' has issues (${res.totalErrors} errors, ${res.totalWarnings} warnings).`);
          results.push({
            domain,
            crawlDate: res.startedAt,
            robotsAccessible: res.robotsAccessible,
            sitemapAccessible: res.sitemapAccessible,
            sitemapUrlCount: res.sitemapUrlCount,
            llmsTxtAccessible: res.llmsTxtAccessible,
            llmsFullTxtAccessible: res.llmsFullTxtAccessible,
            sampledUrlsCount: res.totalUrlsCrawled,
            pages: res.pages,
            issuesSummary: res.issuesSummary,
            totalErrors: res.totalErrors,
            totalWarnings: res.totalWarnings,
            totalNotices: res.totalNotices,
            totalIssues: res.totalIssues,
            averageAeoScore: res.averageAeoScore,
            passed: res.passed,
          });
        }

        const totalUrls = results.reduce((a, r) => a + r.pages.length, 0);
        const totalErrors = results.reduce((a, r) => a + r.totalErrors, 0);
        const totalWarnings = results.reduce((a, r) => a + r.totalWarnings, 0);
        const totalNotices = results.reduce((a, r) => a + r.totalNotices, 0);
        const avgAeo = results.length
          ? Math.round(results.reduce((a, r) => a + r.averageAeoScore, 0) / results.length)
          : 0;

        const allIssuesMap = new Map<string, any>();
        for (const d of results) {
          for (const issue of d.issuesSummary) {
            if (!allIssuesMap.has(issue.name)) allIssuesMap.set(issue.name, { ...issue });
            else {
              const ex = allIssuesMap.get(issue.name)!;
              ex.affectedPages += issue.affectedPages;
              ex.change += issue.change;
              ex.affectedUrls = Array.from(new Set([...ex.affectedUrls, ...issue.affectedUrls]));
            }
          }
        }

        const report: OverallAuditReport = {
          timestamp: new Date().toISOString(),
          project: config.project,
          domainsAudited: results.length,
          totalUrlsChecked: totalUrls,
          totalErrors,
          totalWarnings,
          totalNotices,
          totalIssues: totalErrors + totalWarnings + totalNotices,
          averageAeoScore: avgAeo,
          criticalIssues,
          issuesSummary: Array.from(allIssuesMap.values()),
          results,
        };

        let reportPath = "";
        if (args?.save_report !== false) {
          reportPath = await saveMarkdownReport(report as any).catch(() => "");
        }

        const key = config.indexnow?.key || "";
        const allUrls: string[] = [];
        for (const d of config.domains) {
          const base = d.url.endsWith("/") ? d.url.slice(0, -1) : d.url;
          for (const p of d.paths || ["/"]) allUrls.push(`${base}${p.startsWith("/") ? p : `/${p}`}`);
        }
        const byHost = new Map<string, string[]>();
        for (const u of allUrls) {
          try {
            const host = new URL(u).hostname;
            const list = byHost.get(host) || [];
            list.push(u);
            byHost.set(host, list);
          } catch {
            /* skip */
          }
        }
        const indexNowResults = [];
        for (const [host, list] of byHost.entries()) {
          const res = await submitToIndexNow({ host, key, keyLocation: config.indexnow?.keyLocation, urlList: list });
          indexNowResults.push({ host, count: list.length, ...res });
        }

        return ok({
          status: "success",
          timestamp: report.timestamp,
          savedReport: reportPath || undefined,
          averageAeoScore: avgAeo,
          summary: `Audited ${results.length} domains (${totalUrls} URLs). Average AEO: ${avgAeo}/100. ${totalErrors} errors, ${totalWarnings} warnings.`,
          indexNowResults,
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_publishing_plan") {
        const limit = numArg(args?.limit) ?? 15;
        // Catalog browse mode (no business profile): filter and return rows.
        if (!args?.business) {
          const rows = loadSources({
            category: args?.category as string | undefined,
            kind: args?.kind as string | undefined,
            status: args?.status as string | undefined,
          }).slice(0, limit);
          return ok({
            mode: "catalog",
            total: catalogSize(),
            matching: rows.length,
            entries: rows.map((r) => ({
              id: r.id,
              name: r.name,
              kind: r.kind,
              topics: r.topics,
              review_status: r.review_status,
              cost_status: r.cost_status,
              posting_url: r.posting_url,
              sheet_dr_values_unverified: r.sheet_dr_values,
            })),
          });
        }
        const profile = {
          business: String(args.business),
          website: String(args.website ?? ""),
          audience: String(args.audience ?? ""),
          topics: (args.topics as string[]) ?? [],
          markets: (args.markets as string[]) ?? [],
          assets: (args.assets as string[]) ?? [],
          posts_per_week: numArg(args?.posts_per_week) ?? 2,
          pages: (args.pages as PostingProfile["pages"]) ?? [],
        };
        const plan = buildPlan(profile, loadSources(), { limit });
        const db = openStore(path.join(process.cwd(), "reports", "seoforge.db"));
        const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        repo.savePublishingPlan(db, plan, id);
        return ok({
          mode: "plan",
          planId: id,
          business: plan.business,
          selected_sources: plan.selected_sources,
          requested_sources: plan.requested_sources,
          shortfall: plan.shortfall,
          excluded_summary: plan.excluded_summary,
          catalog_sites_considered: plan.catalog_sites_considered,
          tasks: plan.tasks,
          interpretation: plan.interpretation,
          markdown: planMarkdown(plan),
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_reputation_report") {
        const target = args?.target_url as string;
        const brand = args?.brand as string;
        const sourceUrls = (args?.sources as string[]) ?? [];
        if (!target || !brand) return err("target_url and brand are required.");
        if (sourceUrls.length === 0) return err("Provide at least one candidate source URL in sources[].");
        const rows: SourceRow[] = sourceUrls.map((url) => ({ URL: url }));
        const verification = await checkSources(rows, target, {
          limit: numArg(args?.limit) ?? 30,
          render: !!args?.render,
          brand,
          aliases: (args?.aliases as string[]) ?? [],
        });
        const result = assess(verification, {
          relatedHosts: (args?.related_hosts as string[]) ?? [],
          requestedSearchPages: numArg(args?.search_pages) ?? 5,
        });
        const db = openStore(path.join(process.cwd(), "reports", "seoforge.db"));
        const id = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        result.evidence_source = id;
        repo.saveReputationAssessment(db, result, id);
        return ok({
          assessmentId: id,
          score: result.score,
          score_range: result.score_range,
          score_status: result.score_status,
          confidence: result.confidence,
          evidence_factor: result.evidence_adjustment.factor,
          limiting_factors: result.evidence_adjustment.limiting_factors,
          coverage: result.coverage,
          observed_link_pages: result.observed_link_pages,
          observed_mention_pages: result.observed_mention_pages,
          top_backlinks: result.top_backlinks.map((s) => ({
            source_url: s.source_url,
            supported_quality_points: s.supported_quality_points,
            relationship: s.relationship,
            target_links: s.target_links,
          })),
          top_mentions_without_links: result.top_mentions_without_links.map((s) => ({
            source_url: s.source_url,
            mention_excerpt: s.brand_mentions[0]?.excerpt,
          })),
          markdown: reputationMarkdown(result),
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_compare_competitors") {
        const db = openStore(path.join(process.cwd(), "reports", "seoforge.db"));
        let baseline: CrawlResult | null = null;
        const competitors: CrawlResult[] = [];
        const liveTarget = args?.target_url as string | undefined;
        const liveUrls = (args?.competitor_urls as string[]) ?? [];
        if (liveTarget) {
          if (liveUrls.length === 0) return err("Live comparison needs competitor_urls along with target_url.");
          if (liveUrls.length > 5) return err("Compare at most five competitors.");
          const budget = numArg(args?.limit) ?? 50;
          baseline = await crawlSite(liveTarget, { limit: budget, maxDepth: 3, respectRobots: true });
          for (const u of liveUrls) {
            competitors.push(await crawlSite(u, { limit: budget, maxDepth: 3, respectRobots: true }));
          }
        } else {
          const ids = (args?.competitor_crawl_ids as string[]) ?? [];
          if (ids.length === 0) return err("Provide competitor_crawl_ids (stored crawls) or target_url + competitor_urls.");
          if (ids.length > 5) return err("Compare at most five competitors.");
          if (args?.crawl_id) baseline = repo.getFullCrawl(db, args.crawl_id as string);
          else {
            const latest = repo.listCrawls(db, 1)[0];
            if (latest) baseline = repo.getFullCrawl(db, latest.id);
          }
          if (!baseline) return err("Baseline crawl not found; run a crawl first or pass crawl_id.");
          for (const id of ids) {
            const c = repo.getFullCrawl(db, id);
            if (!c) return err(`Competitor crawl '${id}' not found.`);
            competitors.push(c);
          }
        }
        const comparison = compareCompetitors(baseline, competitors);
        const id = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        repo.saveCompetitorComparison(db, comparison, id);
        return ok({
          comparisonId: id,
          baselineUrl: comparison.baselineUrl,
          competitorUrls: comparison.competitorUrls,
          budgetComparable: comparison.budgetComparable,
          strengths: comparison.strengths,
          gaps: comparison.gaps,
          metrics: comparison.metrics,
          markdown: comparisonMarkdown(comparison),
        });
      }

      /* ------------------------------------------------------------ */
      if (name === "seoforge_discover_sources") {
        const target = args?.target_url as string;
        if (!target) return err("target_url is required.");
        const queries = (args?.queries as SearchQuery[]) ?? [];
        const candidates = (args?.candidates as string[]) ?? [];
        const saved = (args?.saved_searches as SavedSearch[]) ?? [];
        const hostRecords = (args?.host_records as HostRecord[]) ?? [];
        if (queries.length === 0 && candidates.length === 0 && saved.length === 0 && hostRecords.length === 0) {
          return err("Provide queries[], candidates[], saved_searches[] or host_records[].");
        }
        const outDir = (args?.out_dir as string) ?? path.join(process.cwd(), "reports", "discovery");
        const timeoutSeconds = numArg(args?.timeout_seconds);
        const result = await discover(queries, outDir, {
          target,
          providers: (args?.providers as NativeProvider[]) ?? undefined,
          hostRecords: hostRecords.length > 0 ? hostAttempts(hostRecords) : [],
          candidates,
          saved,
          offline: !!args?.offline,
          maxRequests: numArg(args?.max_requests),
          maxQueries: numArg(args?.max_queries),
          maxCandidates: numArg(args?.max_candidates),
          timeoutMs: timeoutSeconds ? Math.round(timeoutSeconds * 1000) : undefined,
          seconds: numArg(args?.seconds),
        });
        await fs.writeFile(
          path.join(outDir, "sources.csv"),
          sourcesCsv(candidatesToRows(result.candidates)),
        );
        await fs.writeFile(path.join(outDir, "discovery.md"), discoveryMarkdown(result));

        const db = openStore(path.join(process.cwd(), "reports", "seoforge.db"));
        const id = `disc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        repo.saveDiscoveryRun(db, result, id);
        return ok({
          discoveryId: id,
          status: result.status,
          search_available: result.search_available,
          candidates: result.candidates.map((c) => ({
            url: c.url,
            verification: c.verification,
            first_observed: c.provenance[0]?.provider,
            query: c.provenance[0]?.query,
          })),
          candidate_count: result.candidate_count,
          attempts: result.attempts.map((a) => ({
            provider: a.provider,
            query: a.query,
            status: a.status,
            accepted_leads: a.accepted_leads ?? a.results.length,
          })),
          native_requests: result.native_requests,
          request_budget: result.request_budget,
          candidate_budget_reached: result.candidate_budget_reached,
          note: result.note,
          sources_csv: path.join(outDir, "sources.csv"),
          next_step: "Candidates are unverified leads. Verify with seoforge_reputation_report (target_url + brand + these URLs).",
        });
      }

      return err(`Unknown tool '${name}'`);
    } catch (err: any) {
      return err(`Internal tool execution error: ${err.message}`);
    }
  });

  return server;
}

/* ------------------------------------------------------------------ */

function ok(data: any) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function err(message: string) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}
function numArg(v: any): number | undefined {
  return typeof v === "number" ? v : v !== undefined ? Number(v) : undefined;
}

function persist(result: CrawlResult): void {
  try {
    const db = openStore(path.join(process.cwd(), "reports", "seoforge.db"));
    repo.saveCrawl(db, result);
  } catch (err) {
    console.error("Failed to persist crawl to store:", err);
  }
}

async function loadFullResult(crawlId: string): Promise<CrawlResult | null> {
  const job = asyncJobs.get(crawlId);
  if (job?.result) return job.result;
  try {
    const db = openStore(path.join(process.cwd(), "reports", "seoforge.db"));
    return repo.getFullCrawl(db, crawlId);
  } catch {
    return null;
  }
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SEOForge 2.0 MCP Server listening on stdio.");
}
