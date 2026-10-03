#!/usr/bin/env node
/**
 * SEOForge 2.0 CLI — full-site crawler, audit engine, AI recommendations,
 * local dashboard server, and MCP agent interface.
 */
import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import { green, red, cyan, bold, yellow, gray } from "colorette";
import {
  CrawlOptions,
  CrawlResult,
  DomainAuditResult,
  OverallAuditReport,
} from "./types.js";
import { crawlSite } from "./crawl/crawler.js";
import { auditSinglePage } from "./audit-page.js";
import { submitToIndexNow } from "./indexnow.js";
import {
  formatTerminalOutput,
  formatCrawlTerminalOutput,
  formatPageTerminal,
} from "./report/terminal.js";
import {
  saveMarkdownReport,
  generateCrawlMarkdown,
} from "./report/markdown.js";
import { toCsv } from "./report/csv.js";
import { generateHtmlReport } from "./report/html.js";
import { generateFixBacklogMarkdown, generateRecommendations } from "./ai/recommendations.js";
import {
  loadSources,
  catalogMarkdown,
  buildPlan,
  planMarkdown,
  planCsv,
  catalogSize,
  type PostingProfile,
} from "./publishing/index.js";
import {
  checkSources,
  assess,
  reputationMarkdown,
  reputationCsv,
  type SourceRow,
} from "./reputation/index.js";
import { compareCompetitors, comparisonMarkdown } from "./competitors/index.js";
import {
  discover,
  hostAttempts,
  importSearchHtml,
  writeSearchPlan,
  discoveryMarkdown,
  searchPlanMarkdown,
  searchImportMarkdown,
  sourcesCsv,
  candidatesToRows,
  type NativeProvider,
  type SavedSearch,
  type SearchQuery,
} from "./discovery/index.js";
import { startMcpServer } from "./mcp/mcp-server.js";
import { startServer } from "./api/server.js";
import { loadConfig, mergeCrawlOptions } from "./config.js";
import { openStore, migrateLegacySnapshots } from "./store/db.js";
import * as repo from "./store/repository.js";
import { crawlDomain } from "./crawler.js";

const program = new Command();

async function ensureStore() {
  const dbPath = path.join(process.cwd(), "reports", "seoforge.db");
  const db = openStore(dbPath);
  await migrateLegacySnapshots().catch(() => {});
  return db;
}

async function persistAndReport(result: CrawlResult, save: boolean): Promise<string> {
  const db = await ensureStore();
  try {
    repo.saveCrawl(db, result);
  } catch (err) {
    console.error(yellow(`Warning: failed to persist crawl to store: ${(err as Error).message}`));
  }
  if (!save) return "";
  return saveMarkdownReport(result).catch((e) => {
    console.error(yellow(`Report save failed: ${e.message}`));
    return "";
  });
}

/* ------------------------------------------------------------------ */
/* Command: mcp                                                        */
/* ------------------------------------------------------------------ */
program
  .name("seoforge")
  .description("SEOForge 2.0 — Full-site SEO crawler, audit engine, AEO scorer, dashboard & MCP server")
  .version("2.0.0");

program
  .command("mcp")
  .description("Start the Model Context Protocol server on stdio for AI agents")
  .action(async () => {
    await startMcpServer();
  });

/* ------------------------------------------------------------------ */
/* Command: crawl                                                      */
/* ------------------------------------------------------------------ */
program
  .command("crawl [url]")
  .description("Crawl a full site: BFS discovery, robots compliance, sitemap parsing, broken-link checks, and AI issue reports")
  .option("-d, --depth <n>", "Maximum crawl depth", "10")
  .option("-l, --limit <n>", "Crawl budget (max pages)", "1000")
  .option("-c, --concurrency <n>", "Concurrent requests", "8")
  .option("-r, --render", "Enable Playwright JS rendering for SPAs")
  .option("-s, --strategy <strategy>", "Crawl strategy: discover | sitemap | config", "discover")
  .option("--sample <count>", "When strategy=sitemap, audit N random sitemap URLs")
  .option("--save", "Save markdown + AI fix-backlog reports to reports/")
  .option("--no-robots", "Ignore robots.txt disallow rules")
  .action(async (url: string | undefined, options) => {
    const config = await loadConfig().catch(() => null);
    let targetUrl = url;
    let extra: CrawlOptions = {};

    if (!targetUrl) {
      if (!config) {
        console.error(red("Provide a URL to crawl, or configure domains in seoforge.config.json."));
        process.exit(1);
      }
      const d = config.domains[0];
      targetUrl = d.url;
      extra = mergeCrawlOptions(config, d, { strategy: "config" });
      (extra as any).paths = d.paths;
      (extra as any).sitemapOverride = d.sitemap;
      extra.expectedEntities = d.expectedEntities;
      (extra as any).thresholds = config.thresholds;
    }

    const opts: CrawlOptions = {
      maxDepth: parseInt(options.depth, 10),
      limit: parseInt(options.limit, 10),
      concurrency: parseInt(options.concurrency, 10),
      render: !!options.render,
      strategy: options.strategy,
      sampleSitemap: options.sample ? parseInt(options.sample, 10) : undefined,
      respectRobots: options.robots !== false,
      ...extra,
    };

    console.log(bold(cyan(`\n🕷  Crawling ${targetUrl} (depth ${opts.maxDepth}, budget ${opts.limit}, strategy ${opts.strategy}${opts.render ? ", render mode" : ""})…\n`)));

    const result = await crawlSite(targetUrl, opts);
    console.log(formatCrawlTerminalOutput(result));

    if (result.recommendations.length > 0) {
      console.log(bold(`\n📋 ${result.recommendations.length} AI recommendation(s):`));
      for (const rec of result.recommendations.slice(0, 5)) {
        console.log(`  ${priorityBadge(rec.priority)} ${rec.name} — ${gray(`${rec.affectedPages} page(s) · effort ${rec.effort}`)}`);
      }
      if (result.recommendations.length > 5) {
        console.log(gray(`  …and ${result.recommendations.length - 5} more (see reports/ or the dashboard).`));
      }
    }

    const reportPath = await persistAndReport(result, !!options.save);
    if (reportPath) console.log(green(`\n✔ Saved report: ${reportPath}`));
    console.log(gray(`Crawl ID: ${result.id}`));
  });

/* ------------------------------------------------------------------ */
/* Command: inspect                                                    */
/* ------------------------------------------------------------------ */
program
  .command("inspect <url>")
  .description("Deep-inspect a single URL in real time (TTFB, canonical, meta, schema, CWV, AEO score)")
  .option("-e, --expected <entities>", "Comma-separated expected Schema.org entities")
  .option("-p, --policy <policy>", "Canonical policy ('strict' or 'spa')", "strict")
  .option("-r, --render", "Render with headless Chromium (SPA support + Core Web Vitals)")
  .action(async (url: string, options) => {
    const expected = options.expected ? options.expected.split(",").map((s: string) => s.trim()) : [];
    const policy = options.policy === "spa" ? "spa" : "strict";
    console.log(bold(cyan(`\n🔍 Inspecting ${url}${options.render ? " (render mode)" : ""}…`)));
    const { page } = await auditSinglePage(url, {
      expectedEntities: expected,
      canonicalPolicy: policy,
      render: !!options.render,
    });
    console.log(formatPageTerminal(page));
  });

/* ------------------------------------------------------------------ */
/* Command: audit (v1-compatible multi-domain audit)                    */
/* ------------------------------------------------------------------ */
async function runAudit(config: any, options: any): Promise<OverallAuditReport> {
  const results: DomainAuditResult[] = [];
  const criticalIssues: string[] = [];

  for (const domain of config.domains) {
    const sample = options?.sampleSitemap ?? domain.sampleSitemap;
    const res = await crawlDomain(domain, { sampleSitemap: sample });
    results.push(res);
    if (!res.passed) {
      criticalIssues.push(`Domain '${domain.name}' has issues (${res.totalErrors} errors, ${res.totalWarnings} warnings).`);
    }
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

  return {
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
}

program
  .command("audit")
  .description("Audit all configured domains (v1-compatible; use `crawl` for full-site BFS)")
  .option("-c, --config <path>", "Path to configuration file")
  .option("-s, --save", "Save markdown report to reports/")
  .option("--sample <count>", "Sample N dynamic URLs from XML sitemaps")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const sample = options.sample ? parseInt(options.sample, 10) : undefined;
    console.log(cyan(`Auditing ${config.domains.length} domain(s) for ${config.project}…`));
    const report = await runAudit(config, { sampleSitemap: sample });
    console.log(formatTerminalOutput(report));
    if (options.save) {
      const savedPath = await saveMarkdownReport(report as any);
      console.log(green(`\n✔ Saved markdown audit report to: ${savedPath}`));
    }
  });

/* ------------------------------------------------------------------ */
/* Command: serve (dashboard)                                          */
/* ------------------------------------------------------------------ */
program
  .command("serve")
  .description("Start the local web dashboard + REST API (default: http://127.0.0.1:5173)")
  .option("-p, --port <port>", "Port", "5173")
  .option("-H, --host <host>", "Bind host", "127.0.0.1")
  .option("--no-open", "Do not open the browser automatically")
  .option("-c, --config <path>", "Path to configuration file")
  .action(async (options) => {
    await startServer({
      port: parseInt(options.port, 10),
      host: options.host,
      open: options.open,
      configPath: options.config,
    });
  });

/* ------------------------------------------------------------------ */
/* Command: export                                                     */
/* ------------------------------------------------------------------ */
program
  .command("export <format>")
  .description("Export the latest crawl (or --crawl <id>) as md, csv, html, or backlog (ai)")
  .option("--crawl <id>", "Crawl ID (default: most recent)")
  .option("--kind <kind>", "CSV kind: pages | issues | links | recommendations", "pages")
  .option("--all-urls", "List every affected URL per issue (no 20-URL cap) — full AI/handoff report")
  .option("-o, --out <path>", "Output file path")
  .action(async (format: string, options) => {
    const db = await ensureStore();
    let result: CrawlResult | null = null;
    if (options.crawl) result = repo.getFullCrawl(db, options.crawl);
    else {
      const latest = repo.listCrawls(db, 1)[0];
      if (latest) result = repo.getFullCrawl(db, latest.id);
    }
    if (!result) {
      console.error(red("No crawl found. Run `seoforge crawl <url>` first."));
      process.exit(1);
    }

    const dateStr = new Date().toISOString().split("T")[0];
    let content: string;
    let outPath: string;
    if (format === "md") {
      content = generateCrawlMarkdown(result);
      outPath = options.out || path.join(process.cwd(), "reports", `crawl-${dateStr}.md`);
    } else if (format === "html") {
      content = generateHtmlReport(result);
      outPath = options.out || path.join(process.cwd(), "reports", `crawl-${dateStr}.html`);
    } else if (format === "csv") {
      content = toCsv(result, options.kind);
      outPath = options.out || path.join(process.cwd(), "reports", `crawl-${options.kind}-${dateStr}.csv`);
    } else if (format === "backlog" || format === "ai") {
      // Re-render from the stored issue summaries so --all-urls can lift the
      // 20-URL cap that the on-disk recommendations were built with.
      const recs = options.allUrls
        ? generateRecommendations(result.issuesSummary, Infinity)
        : result.recommendations;
      content = generateFixBacklogMarkdown(recs);
      outPath = options.out || path.join(process.cwd(), "reports", `ai-fix-backlog-${dateStr}.md`);
    } else {
      console.error(red(`Unknown format '${format}'. Use md, csv, html, or backlog.`));
      process.exit(1);
    }

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, content, "utf-8");
    console.log(green(`✔ Exported ${format} → ${outPath}`));
  });

/* ------------------------------------------------------------------ */
/* Command: publish — backlink/publishing source catalog + plan         */
/* ------------------------------------------------------------------ */
program
  .command("publish [query]")
  .description("Browse the 206-source publishing catalog, or build a tailored posting plan from a profile")
  .option("--category <topic>", "Filter by topic tag (technology, business, travel, ...)")
  .option("--kind <kind>", "Filter by format (article, community, answer, ...)")
  .option("--status <status>", "Filter by review status (guidance_reviewed, unreviewed, ...)")
  .option("--limit <n>", "Catalog rows to show, or requested shortlist size for a plan", "15")
  .option("--profile <path>", "Business profile JSON; builds a tailored plan instead of browsing")
  .option("--out <dir>", "Save the plan as markdown + csv + json to this directory")
  .option("--json", "Emit machine-readable JSON instead of markdown")
  .action(async (query: string | undefined, options) => {
    const limit = parseInt(options.limit, 10);
    if (options.profile) {
      const raw = await fs.readFile(options.profile, "utf-8");
      const profile = JSON.parse(raw) as PostingProfile;
      const plan = buildPlan(profile, loadSources(), { limit });
      if (options.out) {
        const dir = options.out;
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "posting-plan.json"), JSON.stringify(plan, null, 2) + "\n");
        await fs.writeFile(path.join(dir, "posting-plan.md"), planMarkdown(plan));
        await fs.writeFile(path.join(dir, "posting-plan.csv"), planCsv(plan));
        console.log(
          green(
            `✔ Plan: ${plan.selected_sources}/${plan.requested_sources} sources → ${dir} (md + csv + json)`,
          ),
        );
        if (plan.shortfall > 0) {
          console.log(yellow(`  Research gap: ${plan.shortfall} more suitable sources needed.`));
        }
      } else {
        console.log(options.json ? JSON.stringify(plan, null, 2) : planMarkdown(plan));
      }
      const db = await ensureStore();
      const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      repo.savePublishingPlan(db, plan, id);
      console.log(gray(`  persisted as ${id}`));
      return;
    }

    const rows = loadSources({
      platform: query,
      category: options.category,
      kind: options.kind,
      status: options.status,
    }).slice(0, limit);
    if (rows.length === 0) {
      console.error(red("No catalog entries match those filters."));
      process.exit(1);
    }
    console.log(
      options.json ? JSON.stringify(rows, null, 2) : catalogMarkdown(rows),
    );
    console.log(gray(`\nCatalog: ${catalogSize()} entries total.`));
  });

/* ------------------------------------------------------------------ */
/* Command: reputation — verify candidate sources, model 1.1 score      */
/* ------------------------------------------------------------------ */
program
  .command("reputation")
  .description("Verify candidate backlink/mention sources and score reputation (model 1.1)")
  .requiredOption("-t, --target <url>", "Your site URL")
  .requiredOption("-b, --brand <name>", "Brand name to find as a mention")
  .requiredOption("-s, --sources <path>", "Source list: JSON array of rows, CSV, or one URL per line")
  .option("--alias <names>", "Extra brand variants (comma-separated)")
  .option("--related-host <hosts>", "Hosts treated as owned (comma-separated)")
  .option("--limit <n>", "Max sources to verify (1-500)", "30")
  .option("--search-pages <n>", "Requested search-page budget (1-20)", "5")
  .option("--render", "Use a browser for script-heavy source pages")
  .option("--out <dir>", "Save the assessment as markdown + csv + json to this directory")
  .action(async (options) => {
    const raw = await fs.readFile(options.sources, "utf-8");
    const rows = parseSourceList(raw, options.sources);
    const limit = parseInt(options.limit, 10);
    const searchPages = parseInt(options.searchPages, 10);
    const verification = await checkSources(rows, options.target, {
      limit,
      render: !!options.render,
      brand: options.brand,
      aliases: options.alias ? options.alias.split(",").map((s: string) => s.trim()) : [],
    });
    const result = assess(verification, {
      relatedHosts: options.relatedHost
        ? options.relatedHost.split(",").map((s: string) => s.trim())
        : [],
      requestedSearchPages: searchPages,
    });
    const db = await ensureStore();
    const id = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    result.evidence_source = id;
    repo.saveReputationAssessment(db, result, id);

    if (options.out) {
      const dir = options.out;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "reputation.json"), JSON.stringify(result, null, 2) + "\n");
      await fs.writeFile(path.join(dir, "reputation.md"), reputationMarkdown(result));
      await fs.writeFile(path.join(dir, "reputation-sources.csv"), reputationCsv(result));
      console.log(green(`✔ Reputation report → ${dir} (md + csv + json)`));
    } else {
      console.log(reputationMarkdown(result));
    }
    console.log(
      cyan(
        `Score: ${result.score ?? "withheld"}/100 (${result.score_status}, ${result.confidence}) — persisted as ${id}`,
      ),
    );
  });

/** Parse a source list from JSON array, CSV, or newline-separated URLs. */
function parseSourceList(raw: string, sourcePath: string): SourceRow[] {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === ".json") {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON source list must be an array of rows with a URL field.");
    }
    return parsed as SourceRow[];
  }
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (ext === ".csv" && lines[0]?.toLowerCase().startsWith("url")) {
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    return lines.slice(1).map((line) => {
      const cells = splitCsvLine(line);
      const row: Record<string, unknown> = {};
      header.forEach((h, i) => (row[h] = cells[i]));
      return row as unknown as SourceRow;
    });
  }
  return lines.map((url) => ({ URL: url }));
}

/** Split one CSV line, honouring quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/* ------------------------------------------------------------------ */
/* Command: discover — bounded search leads for reputation research      */
/* ------------------------------------------------------------------ */

/**
 * Commander gives a scalar (last value wins) for a repeated option unless a
 * collector is supplied, so every "repeatable" flag uses this to build an
 * array — including for the first, and for zero, occurrences.
 */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

program
  .command("discover")
  .description("Collect unverified backlink/mention leads from bounded search, imports or supplied URLs")
  .requiredOption("-t, --target <url>", "Your site URL (own-site results are filtered out)")
  .option("-q, --query <text>", "A search query (repeatable)", collect, [] as string[])
  .option("--queries <path>", "JSON array of { query, market, language } specifications")
  .option("--market <code>", "Requested market applied to every --query term")
  .option("--language <code>", "Requested language applied to every --query term")
  .option("--provider <name>", "Native provider: duckduckgo-html | bing-rss (repeatable)", collect, [] as string[])
  .option("--host-results <path>", "JSON with search attempts recorded by your own search tool")
  .option("--saved-search <path>", "JSON list of saved HTML { path, provider, query, captured_at } records")
  .option("--candidate <url>", "A known candidate URL (repeatable)", collect, [] as string[])
  .option("--sources-csv <path>", "CSV/JSON source list merged as supplied candidates")
  .option("--offline", "Never make a live search request")
  .option("--max-requests <n>", "Total native request budget (1-100)", "16")
  .option("--max-queries <n>", "Queries to process (1-20)", "8")
  .option("--max-candidates <n>", "Candidate URLs to keep (1-500)", "100")
  .option("--timeout <s>", "Per-request timeout seconds (1-30)", "12")
  .option("--seconds <n>", "Wall-clock budget seconds (1-300)", "90")
  .option("--cache <dir>", "Reuse successful native responses from this cache directory")
  .option("--out <dir>", "Save discovery.json + sources.csv + markdown to this directory")
  .action(async (options) => {
    if ((options.query ?? []).length === 0 && !options.queries && !options.savedSearch && (options.candidate ?? []).length === 0 && !options.sourcesCsv) {
      console.error(red("Provide --query (repeatable), --queries, --saved-search, or --candidate URLs."));
      process.exit(1);
    }
    const queries: SearchQuery[] = [];
    if (options.queries) {
      const parsed = JSON.parse(await fs.readFile(options.queries, "utf-8"));
      if (!Array.isArray(parsed)) {
        console.error(red("--queries must be a JSON array of { query, market, language } objects."));
        process.exit(1);
      }
      queries.push(...parsed);
    }
    for (const q of (options.query as string[]) ?? []) {
      queries.push({ query: q, market: options.market, language: options.language });
    }

    const candidates: Array<string | Record<string, unknown>> = [
      ...((options.candidate as string[]) ?? []),
    ];
    if (options.sourcesCsv) {
      const rows = parseSourceList(
        await fs.readFile(options.sourcesCsv, "utf-8"),
        options.sourcesCsv,
      );
      for (const row of rows) {
        candidates.push({ URL: row.URL, ...(row.discovery ?? {}) });
      }
    }

    const providers = ((options.provider as string[]) ?? []).filter((p) => p) as NativeProvider[];
    for (const p of providers) {
      if (p !== "duckduckgo-html" && p !== "bing-rss") {
        console.error(red(`Unknown provider '${p}'. Use duckduckgo-html or bing-rss.`));
        process.exit(1);
      }
    }

    const outDir = options.out ?? path.join("reports", "discovery");
    const result = await discover(queries, outDir, {
      target: options.target,
      providers: providers.length > 0 ? providers : undefined,
      hostRecords: options.hostResults
        ? hostAttempts(JSON.parse(await fs.readFile(options.hostResults, "utf-8")))
        : [],
      candidates,
      saved: options.savedSearch
        ? (JSON.parse(await fs.readFile(options.savedSearch, "utf-8")) as SavedSearch[])
        : [],
      offline: !!options.offline,
      maxRequests: parseInt(options.maxRequests, 10),
      maxQueries: parseInt(options.maxQueries, 10),
      maxCandidates: parseInt(options.maxCandidates, 10),
      timeoutMs: Math.round(parseFloat(options.timeout) * 1000),
      seconds: parseFloat(options.seconds),
      cacheDir: options.cache,
    });

    await fs.writeFile(
      path.join(outDir, "sources.csv"),
      sourcesCsv(candidatesToRows(result.candidates)),
    );
    await fs.writeFile(path.join(outDir, "discovery.md"), discoveryMarkdown(result));

    const db = await ensureStore();
    const id = `disc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    repo.saveDiscoveryRun(db, result, id);

    if (options.out) {
      console.log(green(`✔ Discovery → ${outDir} (${result.candidate_count} candidates)`));
    } else {
      console.log(discoveryMarkdown(result));
    }
    console.log(
      cyan(
        `${result.candidate_count} unverified lead${result.candidate_count === 1 ? "" : "s"} from ${result.queries_processed} quer${result.queries_processed === 1 ? "y" : "ies"} — persisted as ${id}`,
      ),
    );
    console.log(
      gray(`Feed the leads to reputation: seoforge reputation -t ${options.target} -b "Brand" -s ${path.join(outDir, "sources.csv")}`),
    );
  });

/* ------------------------------------------------------------------ */
/* Command: search-plan — Google discovery navigation plan (no searching) */
/* ------------------------------------------------------------------ */
program
  .command("search-plan")
  .description("Plan bounded Google discovery navigation URLs; does not run searches")
  .requiredOption("-t, --target <url>", "Your site URL")
  .requiredOption("-b, --brand <name>", "Brand name to search for")
  .option("--pages <n>", "Search pages to plan (1-20)", "5")
  .option("--out <dir>", "Save the plan as markdown + json to this directory")
  .action(async (options) => {
    const pages = parseInt(options.pages, 10);
    const outDir = options.out ?? path.join("reports", "search-plan");
    const plan = await writeSearchPlan(options.target, options.brand, outDir, pages);
    if (options.out) {
      console.log(green(`✔ Search plan → ${outDir} (${plan.pages.length} pages)`));
    } else {
      console.log(searchPlanMarkdown(plan));
    }
  });

/* ------------------------------------------------------------------ */
/* Command: search-import — extract candidates from saved result HTML     */
/* ------------------------------------------------------------------ */
program
  .command("search-import [files...]")
  .description("Extract candidate links from saved public search result HTML pages")
  .requiredOption("-t, --target <url>", "Your site URL")
  .requiredOption("--query <text>", "The query these result pages were captured for")
  .requiredOption("--captured-at <date>", "ISO date (2026-09-23) or timestamp when pages were captured")
  .option("--engine <name>", "Engine declared by the operator", "Google")
  .option("--out <dir>", "Save sources.csv + markdown to this directory")
  .action(async (files: string[], options) => {
    if (!files || files.length === 0) {
      console.error(red("Supply 1-20 saved result-page HTML files as arguments."));
      process.exit(1);
    }
    const outDir = options.out ?? path.join("reports", "search-import");
    const result = await importSearchHtml(
      files,
      options.target,
      options.query,
      options.capturedAt,
      outDir,
      options.engine,
    );
    if (options.out) {
      console.log(green(`✔ Search import → ${outDir} (${result.candidate_urls} candidates)`));
    } else {
      console.log(searchImportMarkdown(result));
    }
    console.log(
      gray(`Imported ${result.candidate_urls} candidate URL${result.candidate_urls === 1 ? "" : "s"} from ${result.snapshots_imported} snapshot${result.snapshots_imported === 1 ? "" : "s"}. No live search was run.`),
    );
  });

/* ------------------------------------------------------------------ */
/* Command: compare — competitor gap analysis on crawl evidence         */
/* ------------------------------------------------------------------ */
program
  .command("compare")
  .description("Compare a baseline crawl against competitor crawls (AEO, issues, depth, links)")
  .option("--crawl <id>", "Baseline crawl ID (default: most recent)")
  .option("--competitors <ids>", "Comma-separated competitor crawl IDs (1-5)")
  .option("--target <url>", "Crawl this site live as the baseline (with --competitor-urls)")
  .option("--competitor-urls <urls>", "Comma-separated competitor URLs to crawl live")
  .option("--limit <n>", "Crawl budget when crawling live", "50")
  .option("--out <path>", "Save the comparison as markdown to this path")
  .action(async (options) => {
    const db = await ensureStore();
    let baseline: CrawlResult | null = null;
    const competitors: CrawlResult[] = [];

    if (options.target) {
      if (!options.competitorUrls) {
        console.error(red("Live comparison needs --competitor-urls along with --target."));
        process.exit(1);
      }
      const budget = parseInt(options.limit, 10);
      const urls = options.competitorUrls.split(",").map((u: string) => u.trim());
      if (urls.length > 5) {
        console.error(red("Compare at most five competitors."));
        process.exit(1);
      }
      console.log(cyan(`Crawling baseline ${options.target} (budget ${budget})…`));
      baseline = await crawlSite(options.target, { limit: budget, maxDepth: 3, respectRobots: true });
      for (const u of urls) {
        console.log(cyan(`Crawling competitor ${u}…`));
        const c = await crawlSite(u, { limit: budget, maxDepth: 3, respectRobots: true });
        competitors.push(c);
      }
    } else {
      if (!options.competitors) {
        console.error(red("Provide --competitors <ids> (stored crawls) or --target + --competitor-urls."));
        process.exit(1);
      }
      const ids: string[] = options.competitors.split(",").map((s: string) => s.trim());
      if (ids.length > 5) {
        console.error(red("Compare at most five competitors."));
        process.exit(1);
      }
      if (options.crawl) baseline = repo.getFullCrawl(db, options.crawl);
      else {
        const latest = repo.listCrawls(db, 1)[0];
        if (latest) baseline = repo.getFullCrawl(db, latest.id);
      }
      if (!baseline) {
        console.error(red("Baseline crawl not found. Run `seoforge crawl <url>` first or pass --crawl <id>."));
        process.exit(1);
      }
      for (const id of ids) {
        const c = repo.getFullCrawl(db, id);
        if (!c) {
          console.error(red(`Competitor crawl '${id}' not found.`));
          process.exit(1);
        }
        competitors.push(c);
      }
    }

    const comparison = compareCompetitors(baseline, competitors);
    const id = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    repo.saveCompetitorComparison(db, comparison, id);
    const md = comparisonMarkdown(comparison);
    if (options.out) {
      await fs.mkdir(path.dirname(options.out), { recursive: true });
      await fs.writeFile(options.out, md, "utf-8");
      console.log(green(`✔ Comparison → ${options.out}`));
    } else {
      console.log(md);
    }
    console.log(gray(`  persisted as ${id}`));
  });

/* ------------------------------------------------------------------ */
/* Command: indexnow                                                   */
/* ------------------------------------------------------------------ */
program
  .command("indexnow")
  .description("Submit updated URLs to Bing & Yandex via the IndexNow protocol")
  .option("-c, --config <path>", "Path to configuration file")
  .option("-u, --urls <urls>", "Comma-separated list of URLs to submit")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const key = config.indexnow?.key || "";
    const keyLocation = config.indexnow?.keyLocation;

    let urlsToSubmit: string[] = [];
    if (options.urls) {
      urlsToSubmit = options.urls.split(",").map((u: string) => u.trim());
    } else {
      for (const d of config.domains) {
        const base = d.url.endsWith("/") ? d.url.slice(0, -1) : d.url;
        for (const p of d.paths || ["/"]) {
          urlsToSubmit.push(`${base}${p.startsWith("/") ? p : `/${p}`}`);
        }
      }
    }

    const byHost = new Map<string, string[]>();
    for (const u of urlsToSubmit) {
      try {
        const parsed = new URL(u);
        const list = byHost.get(parsed.hostname) || [];
        list.push(u);
        byHost.set(parsed.hostname, list);
      } catch {
        /* skip invalid */
      }
    }

    console.log(bold(cyan(`Submitting ${urlsToSubmit.length} URL(s) across ${byHost.size} host(s) to IndexNow...`)));
    for (const [host, list] of byHost.entries()) {
      const res = await submitToIndexNow({ host, key, keyLocation, urlList: list });
      if (res.success) console.log(green(`✔ [${host}] ${res.message}`));
      else console.log(yellow(`⚠ [${host}] ${res.message}`));
    }
  });

/* ------------------------------------------------------------------ */
/* Command: report                                                     */
/* ------------------------------------------------------------------ */
program
  .command("report")
  .description("Run an audit and generate a timestamped markdown report in reports/")
  .option("-c, --config <path>", "Path to configuration file")
  .option("--sample <count>", "Sample N dynamic URLs from XML sitemaps")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const sample = options.sample ? parseInt(options.sample, 10) : undefined;
    const report = await runAudit(config, { sampleSitemap: sample });
    console.log(formatTerminalOutput(report));
    const savedPath = await saveMarkdownReport(report as any);
    console.log(green(`\n✔ Saved markdown audit report to: ${savedPath}`));
  });

/* ------------------------------------------------------------------ */
/* Command: daily                                                      */
/* ------------------------------------------------------------------ */
program
  .command("daily")
  .description("Complete daily maintenance: audit domains, save report, submit to IndexNow")
  .option("-c, --config <path>", "Path to configuration file")
  .option("--sample <count>", "Sample N dynamic URLs from XML sitemaps (default: 3)", "3")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const sample = parseInt(options.sample || "3", 10);
    console.log(bold(cyan(`Starting SEOForge Daily Maintenance for ${config.project}…`)));

    const report = await runAudit(config, { sampleSitemap: sample });
    console.log(formatTerminalOutput(report));
    const savedPath = await saveMarkdownReport(report as any);
    console.log(green(`✔ Daily report saved: ${savedPath}`));

    const key = config.indexnow?.key || "";
    const allUrls: string[] = [];
    for (const d of config.domains) {
      const base = d.url.endsWith("/") ? d.url.slice(0, -1) : d.url;
      for (const p of d.paths || ["/"]) allUrls.push(`${base}${p.startsWith("/") ? p : `/${p}`}`);
    }
    const byHost = new Map<string, string[]>();
    for (const u of allUrls) {
      try {
        const list = byHost.get(new URL(u).hostname) || [];
        list.push(u);
        byHost.set(new URL(u).hostname, list);
      } catch {
        /* skip */
      }
    }
    for (const [host, list] of byHost.entries()) {
      const res = await submitToIndexNow({ host, key, urlList: list });
      if (res.success) console.log(green(`✔ [${host}] ${res.message}`));
      else console.log(yellow(`⚠ [${host}] ${res.message}`));
    }
    console.log(bold(green("\n✔ SEOForge Daily Maintenance completed.")));
  });

program.parse(process.argv);

function priorityBadge(p: string): string {
  if (p === "Critical") return red("● Critical");
  if (p === "High") return yellow("● High");
  if (p === "Medium") return cyan("● Medium");
  return gray("● Low");
}
