/**
 * Terminal output formatter — Ahrefs-style tables for the CLI.
 */
import { green, red, yellow, cyan, bold, gray } from "colorette";
import { CrawlResult, IssueSummary } from "../types.js";

export function formatCrawlTerminalOutput(result: CrawlResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(bold(cyan("┌────────────────────────────────────────────────────────────────────────┐")));
  lines.push(bold(cyan("│            SEOForge 2.0 — Full-Site Crawl & Audit                      │")));
  lines.push(bold(cyan("│      Screaming Frog–grade crawler · Ahrefs-grade issue engine           │")));
  lines.push(bold(cyan("└────────────────────────────────────────────────────────────────────────┘")));
  lines.push(
    gray(
      `Target: ${result.targetUrl} · Strategy: ${result.strategy} · Status: ${result.status} · ${result.totalUrlsCrawled} pages crawled (max depth ${result.maxDepthReached})`
    )
  );
  lines.push(
    gray(
      `Robots: ${result.robotsAccessible ? "✓" : "✗"} · Sitemap: ${result.sitemapAccessible ? `✓ (${result.sitemapUrlCount} URLs)` : "✗"} · llms.txt: ${result.llmsTxtAccessible ? "✓" : "✗"}`
    )
  );
  lines.push("");

  const sortedIssues = [...result.issuesSummary].sort((a, b) => {
    const w = { Error: 3, Warning: 2, Notice: 1 };
    return w[b.severity] - w[a.severity] || b.affectedPages - a.affectedPages;
  });

  lines.push(bold("## Site Audit: Issues Overview"));
  lines.push("");
  lines.push("┌──────────────────────────────────────────────────────────┬──────────┬──────────┬────────┐");
  lines.push(`│ ${bold("Issue".padEnd(56))} │ ${bold("Severity".padEnd(8))} │ ${bold("Affected".padStart(8))} │ ${bold("Change".padStart(6))} │`);
  lines.push("├──────────────────────────────────────────────────────────┼──────────┼──────────┼────────┤");

  if (sortedIssues.length === 0) {
    lines.push(
      `│ ${green("No issues detected across any crawled pages!".padEnd(56))} │ ${green("Clean".padEnd(8))} │ ${"0".padStart(8)} │ ${"0".padStart(6)} │`
    );
  } else {
    for (const issue of sortedIssues.slice(0, 40)) {
      const sev =
        issue.severity === "Error" ? red(issue.severity.padEnd(8)) : issue.severity === "Warning" ? yellow(issue.severity.padEnd(8)) : cyan(issue.severity.padEnd(8));
      const changeStr = issue.change > 0 ? `+${issue.change}` : `${issue.change}`;
      const change = issue.change < 0 ? green(changeStr.padStart(6)) : issue.change > 0 ? red(changeStr.padStart(6)) : gray(changeStr.padStart(6));
      const name = issue.name.length > 56 ? issue.name.slice(0, 53) + "..." : issue.name.padEnd(56);
      lines.push(`│ ${name} │ ${sev} │ ${String(issue.affectedPages).padStart(8)} │ ${change} │`);
    }
  }
  lines.push("└──────────────────────────────────────────────────────────┴──────────┴──────────┴────────┘");
  lines.push("");

  lines.push(
    bold(
      `Health: ${red(`${result.totalErrors} Errors`)}, ${yellow(`${result.totalWarnings} Warnings`)}, ${cyan(`${result.totalNotices} Notices`)} · Average AEO: ${result.averageAeoScore}/100`
    )
  );
  lines.push("");

  return lines.join("\n");
}

export function formatPageTerminal(page: import("../types.js").PageAuditResult): string {
  const lines: string[] = [];
  lines.push(bold(cyan(`\n🔍 Inspecting: ${page.url}\n`)));
  lines.push(bold(`Status: `) + (page.status === 200 ? green(`${page.status} OK`) : red(`${page.status}`)));
  lines.push(bold(`Latency: `) + (page.responseTimeMs < 800 ? green(`${page.responseTimeMs}ms`) : yellow(`${page.responseTimeMs}ms`)));
  if (page.ttfbMs) lines.push(bold(`TTFB: `) + (page.ttfbMs < 800 ? green(`${page.ttfbMs}ms`) : yellow(`${page.ttfbMs}ms`)));
  lines.push(bold(`Title: `) + (page.title ? `${page.title} ${gray(`(${page.titleLength} chars)`)}` : red("Missing")));
  lines.push(bold(`Description: `) + (page.description ? gray(page.description.slice(0, 100)) : red("Missing")));
  lines.push(
    bold(`Canonical: `) +
      (page.canonicalMatches
        ? green(`${page.canonical} [MATCH]${page.isSpaCanonicalValid ? " (SPA)" : ""}`)
        : red(`${page.canonical || "None"} [MISMATCH]`))
  );
  lines.push(bold(`Schema.org: `) + (page.schema.typesFound.length ? green(page.schema.typesFound.join(", ")) : yellow("None")));
  lines.push(bold(`AEO Score: `) + (page.aeo.score >= 80 ? green(`${page.aeo.score}/100`) : yellow(`${page.aeo.score}/100`)));
  lines.push(bold(`Links: `) + gray(`${page.incomingInternalLinks.length} in / ${page.outgoingInternalLinks.length} out / ${page.externalLinks.length} ext`));

  if (page.auditIssues.length > 0) {
    lines.push(bold(red(`\nIssues (${page.auditIssues.length}):`)));
    for (const i of page.auditIssues) {
      const badge = i.severity === "Error" ? red("✖ [Error]") : i.severity === "Warning" ? yellow("⚠ [Warning]") : cyan("ℹ [Notice]");
      lines.push(`  ${badge} ${i.name}: ${i.message}`);
    }
  } else {
    lines.push(bold(green("\n✔ No issues detected on this page.")));
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Legacy compat — accepts the v1 OverallAuditReport shape             */
/* ------------------------------------------------------------------ */

export function formatTerminalOutput(report: any): string {
  if (report && report.results && !report.pages) {
    return formatLegacyReport(report);
  }
  return formatCrawlTerminalOutput(report as CrawlResult);
}

function formatLegacyReport(report: any): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(bold(cyan("SEOForge Site Audit — legacy multi-domain report")));
  lines.push(gray(`Project: ${report.project} · ${report.totalUrlsChecked} URLs · AEO ${report.averageAeoScore}/100`));
  for (const d of report.results) {
    lines.push(`${bold(d.domain.name)} ${d.passed ? green("✔") : red("✘")} — ${d.totalErrors}E / ${d.totalWarnings}W / ${d.totalNotices}N`);
  }
  return lines.join("\n");
}

export { green, red, yellow, cyan, bold, gray };
export type { IssueSummary };
