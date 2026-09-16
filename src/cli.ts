#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import { green, red, cyan, bold, yellow } from "colorette";
import { SeoForgeConfig, OverallAuditReport, DomainAuditResult } from "./types.js";
import { crawlDomain } from "./crawler.js";
import { submitToIndexNow } from "./indexnow.js";
import { formatTerminalOutput, saveMarkdownReport } from "./reporter.js";

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

async function runAudit(config: SeoForgeConfig): Promise<OverallAuditReport> {
  const results: DomainAuditResult[] = [];
  const criticalIssues: string[] = [];

  for (const domain of config.domains) {
    const res = await crawlDomain(domain);
    results.push(res);
    if (!res.passed) {
      criticalIssues.push(`Domain '${domain.name}' has failing health checks.`);
    }
  }

  const totalUrls = results.reduce((acc, r) => acc + r.pages.length, 0);
  const avgAeo =
    results.length > 0
      ? Math.round(results.reduce((acc, r) => acc + r.averageAeoScore, 0) / results.length)
      : 0;

  return {
    timestamp: new Date().toISOString(),
    project: config.project,
    domainsAudited: results.length,
    totalUrlsChecked: totalUrls,
    averageAeoScore: avgAeo,
    criticalIssues,
    results,
  };
}

program
  .name("seoforge")
  .description("Autonomous SEO & AEO (Answer Engine Optimization) CLI Engine")
  .version("1.0.0");

// Command: audit
program
  .command("audit")
  .description("Crawl configured domains, validate Schema.org JSON-LD, and evaluate AEO readiness")
  .option("-c, --config <path>", "Path to configuration file")
  .option("-s, --save", "Save markdown report to reports/ directory")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    console.log(cyan(`Auditing ${config.domains.length} domain(s) for ${config.project}...`));

    const report = await runAudit(config);
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

    // Group URLs by host
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
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const report = await runAudit(config);
    console.log(formatTerminalOutput(report));

    const savedPath = await saveMarkdownReport(report);
    console.log(green(`\n✔ Saved markdown audit report to: ${savedPath}`));
  });

// Command: daily
program
  .command("daily")
  .description("Run complete daily maintenance: audit domains, save report, and submit to IndexNow")
  .option("-c, --config <path>", "Path to configuration file")
  .action(async (options) => {
    const config = await loadConfig(options.config);
    console.log(bold(cyan(`Starting SEOForge Daily Maintenance for ${config.project}...`)));

    // 1. Audit
    const report = await runAudit(config);
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
