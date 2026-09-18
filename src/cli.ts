#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import { green, red, cyan, bold, yellow, gray, magenta } from "colorette";
import { SeoForgeConfig, OverallAuditReport, DomainAuditResult } from "./types.js";
import { crawlDomain, crawlPage } from "./crawler.js";
import { submitToIndexNow } from "./indexnow.js";
import { formatTerminalOutput, saveMarkdownReport } from "./reporter.js";
import { startMcpServer } from "./mcp-server.js";

const program = new Command();

async function loadConfig(configPath?: string): Promise<SeoForgeConfig> {
  const resolvedPath = path.resolve(process.cwd(), configPath || "seoforge.config.json");
  try {
    const raw = await fs.readFile(resolvedPath, "utf-8");
    return JSON.parse(raw) as SeoForgeConfig;
  } catch (err: any) {
    console.error(red(`Failed to load configuration from ${resolvedPath}: ${err.message}`));
    process.exit(1);
  }
}

async function runAudit(
  config: SeoForgeConfig,
  options?: { sampleSitemap?: number }
): Promise<OverallAuditReport> {
  const results: DomainAuditResult[] = [];
  const criticalIssues: string[] = [];

  for (const domain of config.domains) {
    const sample = options?.sampleSitemap ?? domain.sampleSitemap;
    const res = await crawlDomain(domain, { sampleSitemap: sample });
    results.push(res);
    if (!res.passed) {
      criticalIssues.push(
        `Domain '${domain.name}' has issues (${res.totalErrors} errors, ${res.totalWarnings} warnings).`
      );
    }
  }

  const totalUrls = results.reduce((acc, r) => acc + r.pages.length, 0);
  const totalErrors = results.reduce((acc, r) => acc + r.totalErrors, 0);
  const totalWarnings = results.reduce((acc, r) => acc + r.totalWarnings, 0);
  const totalNotices = results.reduce((acc, r) => acc + r.totalNotices, 0);
  const totalIssues = totalErrors + totalWarnings + totalNotices;

  const avgAeo =
    results.length > 0
      ? Math.round(results.reduce((acc, r) => acc + r.averageAeoScore, 0) / results.length)
      : 0;

  // Aggregate issues across all domains
  const allIssuesMap = new Map<string, any>();
  for (const d of results) {
    for (const issue of d.issuesSummary) {
      if (!allIssuesMap.has(issue.name)) {
        allIssuesMap.set(issue.name, { ...issue });
      } else {
        const existing = allIssuesMap.get(issue.name)!;
        existing.affectedPages += issue.affectedPages;
        existing.change += issue.change;
        existing.affectedUrls = Array.from(
          new Set([...existing.affectedUrls, ...issue.affectedUrls])
        );
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
    totalIssues,
    averageAeoScore: avgAeo,
    criticalIssues,
    issuesSummary: Array.from(allIssuesMap.values()),
    results,
  };
}

program
  .name("seoforge")
  .description("Autonomous SEO & AEO (Answer Engine Optimization) CLI Engine & MCP Server")
  .version("1.1.0");

// Command: mcp (Model Context Protocol Server)
program
  .command("mcp")
  .description("Start the Model Context Protocol (MCP) server on stdio for Antigravity & AI agents")
  .action(async () => {
    await startMcpServer();
  });

// Command: inspect <url>
program
  .command("inspect <url>")
  .description("Deep-dive inspect a single URL in real-time (TTFB, canonical, schema, AEO score)")
  .option("-e, --expected <entities>", "Comma-separated list of expected Schema.org entities")
  .option("-p, --policy <policy>", "Canonical policy ('strict' or 'spa')", "strict")
  .action(async (url: string, options) => {
    const expected = options.expected ? options.expected.split(",").map((s: string) => s.trim()) : [];
    const policy = options.policy === "spa" ? "spa" : "strict";

    console.log(bold(cyan(`\n🔍 Inspecting URL: ${url} (Policy: ${policy})...\n`)));
    const res = await crawlPage(url, expected, policy);

    console.log(bold(`Status: `) + (res.status === 200 ? green(`${res.status} OK`) : red(`${res.status}`)));
    console.log(bold(`Response Latency: `) + (res.responseTimeMs < 800 ? green(`${res.responseTimeMs}ms`) : yellow(`${res.responseTimeMs}ms`)));
    console.log(bold(`Title: `) + (res.title ? green(res.title) : red("Missing")));
    console.log(bold(`Description: `) + (res.description ? gray(res.description) : red("Missing")));
    console.log(
      bold(`Canonical: `) +
        (res.canonicalMatches
          ? green(`${res.canonical} [MATCH]${res.isSpaCanonicalValid ? " (SPA origin recognized)" : ""}`)
          : red(`${res.canonical || "None"} [MISMATCH]`))
    );

    console.log(bold(`\nSchema.org JSON-LD:`));
    console.log(`  Entities detected: ${res.schema.typesFound.length > 0 ? green(res.schema.typesFound.join(", ")) : yellow("None")}`);
    if (res.schema.missingExpected.length > 0) {
      console.log(`  ${yellow(`Missing expected: ${res.schema.missingExpected.join(", ")}`)}`);
    }
    if (res.schema.errors.length > 0) {
      console.log(`  ${red(`Validation errors: ${res.schema.errors.join("; ")}`)}`);
    }

    console.log(bold(`\nAEO (Answer Engine Optimization) Evaluation:`));
    console.log(`  Score: ${res.aeo.score >= 80 ? green(`${res.aeo.score}/100`) : yellow(`${res.aeo.score}/100`)}`);
    console.log(`  H1 Headings: ${res.aeo.h1Count === 1 ? green("1 (Optimal)") : yellow(String(res.aeo.h1Count))}`);
    console.log(`  H2 Subheadings: ${res.aeo.h2Count >= 2 ? green(`${res.aeo.h2Count} (Semantic)`) : yellow(String(res.aeo.h2Count))}`);
    console.log(
      `  Inverted Pyramid Snippet: ${res.aeo.hasInvertedPyramidSnippet ? green("✔ Detected (40-55 word direct answer)") : yellow("None")}`
    );
    if (res.aeo.definitionSnippet) {
      console.log(`    "${gray(res.aeo.definitionSnippet.slice(0, 120))}..."`);
    }
    console.log(`  Comparison/Spec Tables: ${res.aeo.tableCount > 0 ? green(`${res.aeo.tableCount} table(s)`) : yellow("0")}`);
    console.log(`  FAQ Schema: ${res.aeo.hasFaqSchema ? green("✔ Present") : yellow("None")}`);

    if (res.issues.length > 0) {
      console.log(bold(red(`\nIssues Detected (${res.issues.length}):`)));
      res.issues.forEach((iss) => console.log(`  ${red("✖")} ${iss}`));
    } else {
      console.log(bold(green(`\n✔ 100% Compliant: Zero issues detected.`)));
    }
  });

// Command: audit
program
  .command("audit")
  .description("Crawl configured domains, validate Schema.org JSON-LD, and evaluate AEO readiness")
  .option("-c, --config <path>", "Path to configuration file")
  .option("-s, --save", "Save markdown report to reports/ directory")
  .option("--sample <count>", "Sample N dynamic URLs from XML sitemaps")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const sample = options.sample ? parseInt(options.sample, 10) : undefined;
    console.log(cyan(`Auditing ${config.domains.length} domain(s) for ${config.project}...`));
    if (sample) console.log(gray(`Sitemap dynamic sampling active: ${sample} URL(s) per domain.`));

    const report = await runAudit(config, { sampleSitemap: sample });
    console.log(formatTerminalOutput(report));

    if (options.save) {
      const savedPath = await saveMarkdownReport(report);
      console.log(green(`\n✔ Saved markdown audit report to: ${savedPath}`));
    }
  });

// Command: indexnow
program
  .command("indexnow")
  .description("Submit updated URLs to Bing & Yandex via the IndexNow protocol")
  .option("-c, --config <path>", "Path to configuration file")
  .option("-u, --urls <urls>", "Comma-separated list of URLs to submit")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const key = config.indexnow?.key || "4f9d2a1b7e8c3d5f6a0b9e8d7c6b5a4f";
    const keyLocation = config.indexnow?.keyLocation;

    let urlsToSubmit: string[] = [];
    if (options.urls) {
      urlsToSubmit = options.urls.split(",").map((u: string) => u.trim());
    } else {
      for (const d of config.domains) {
        const base = d.url.endsWith("/") ? d.url.slice(0, -1) : d.url;
        const paths = d.paths || ["/"];
        for (const p of paths) {
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
      } catch {}
    }

    console.log(bold(cyan(`Submitting ${urlsToSubmit.length} URL(s) across ${byHost.size} host(s) to IndexNow...`)));

    for (const [host, list] of byHost.entries()) {
      const res = await submitToIndexNow({
        host,
        key,
        keyLocation,
        urlList: list,
      });

      if (res.success) {
        console.log(green(`✔ [${host}] IndexNow: ${res.message}`));
      } else {
        console.log(yellow(`⚠ [${host}] IndexNow: ${res.message}`));
      }
    }
  });

// Command: report
program
  .command("report")
  .description("Run full audit and generate a timestamped markdown report in reports/")
  .option("-c, --config <path>", "Path to configuration file")
  .option("--sample <count>", "Sample N dynamic URLs from XML sitemaps")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const sample = options.sample ? parseInt(options.sample, 10) : undefined;
    const report = await runAudit(config, { sampleSitemap: sample });
    console.log(formatTerminalOutput(report));

    const savedPath = await saveMarkdownReport(report);
    console.log(green(`\n✔ Saved markdown audit report to: ${savedPath}`));
  });

// Command: daily
program
  .command("daily")
  .description("Run complete daily maintenance: audit domains with sitemap sampling, save report, and submit to IndexNow")
  .option("-c, --config <path>", "Path to configuration file")
  .option("--sample <count>", "Sample N dynamic URLs from XML sitemaps (default: 3)", "3")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const sample = parseInt(options.sample || "3", 10);
    console.log(bold(cyan(`Starting SEOForge Daily Maintenance for ${config.project} (Sample: ${sample})...`)));

    // 1. Audit
    const report = await runAudit(config, { sampleSitemap: sample });
    console.log(formatTerminalOutput(report));

    // 2. Save report
    const savedPath = await saveMarkdownReport(report);
    console.log(green(`✔ Daily report saved: ${savedPath}`));

    // 3. IndexNow submission
    const key = config.indexnow?.key || "4f9d2a1b7e8c3d5f6a0b9e8d7c6b5a4f";
    const allUrls: string[] = [];
    for (const d of config.domains) {
      const base = d.url.endsWith("/") ? d.url.slice(0, -1) : d.url;
      const paths = d.paths || ["/"];
      for (const p of paths) {
        allUrls.push(`${base}${p.startsWith("/") ? p : `/${p}`}`);
      }
    }

    const byHost = new Map<string, string[]>();
    for (const u of allUrls) {
      try {
        const parsed = new URL(u);
        const list = byHost.get(parsed.hostname) || [];
        list.push(u);
        byHost.set(parsed.hostname, list);
      } catch {}
    }

    for (const [host, list] of byHost.entries()) {
      const res = await submitToIndexNow({
        host,
        key,
        urlList: list,
      });
      if (res.success) {
        console.log(green(`✔ [${host}] IndexNow: ${res.message}`));
      } else {
        console.log(yellow(`⚠ [${host}] IndexNow: ${res.message}`));
      }
    }

    console.log(bold(green("\n✔ SEOForge Daily Maintenance completed successfully.")));
  });

program.parse(process.argv);
