import fs from "fs/promises";
import path from "path";
import { green, red, yellow, cyan, bold, gray } from "colorette";
import { DomainAuditResult, OverallAuditReport } from "./types.js";

export function formatTerminalOutput(report: OverallAuditReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(bold(cyan("┌──────────────────────────────────────────────────────────────┐")));
  lines.push(bold(cyan("│               SEOForge Autonomous Engine Audit               │")));
  lines.push(bold(cyan("└──────────────────────────────────────────────────────────────┘")));
  lines.push(gray(`Timestamp: ${report.timestamp} | Project: ${report.project}`));
  lines.push("");

  for (const domainResult of report.results) {
    const { domain, passed, robotsAccessible, sitemapAccessible, sitemapUrlCount, pages, averageAeoScore } = domainResult;

    const statusBadge = passed ? green("✔ PASSED") : red("✘ ISSUES FOUND");
    lines.push(`${bold(domain.name)} (${cyan(domain.url)}) [${statusBadge}]`);
    lines.push(
      `  Robots: ${robotsAccessible ? green("Accessible") : red("Unreachable")} | Sitemap: ${
        sitemapAccessible ? green(`Accessible (${sitemapUrlCount} URLs)`) : red("Unreachable")
      } | Avg AEO: ${averageAeoScore >= 70 ? green(`${averageAeoScore}/100`) : yellow(`${averageAeoScore}/100`)}`
    );

    for (const page of pages) {
      const codeBadge = page.status === 200 ? green(`${page.status} OK`) : red(`${page.status}`);
      lines.push(`    • ${cyan(page.url)} [${codeBadge}, ${page.responseTimeMs}ms] AEO: ${page.aeo.score}/100`);

      if (page.schema.hasJsonLd) {
        lines.push(`      ${green("Schema.org")}: ${page.schema.typesFound.join(", ")}`);
      } else {
        lines.push(`      ${yellow("Schema.org")}: None detected`);
      }

      if (page.issues.length > 0) {
        for (const issue of page.issues) {
          lines.push(`      ${red("!")} ${issue}`);
        }
      }
    }
    lines.push("");
  }

  lines.push(bold(`Summary: ${report.domainsAudited} domains audited, ${report.totalUrlsChecked} URLs verified.`));
  lines.push(
    `Average Ecosystem AEO Score: ${
      report.averageAeoScore >= 70 ? green(`${report.averageAeoScore}/100`) : yellow(`${report.averageAeoScore}/100`)
    }`
  );

  return lines.join("\n");
}

export function generateMarkdownReport(report: OverallAuditReport): string {
  const lines: string[] = [];

  lines.push(`# SEOForge Audit Report — ${report.timestamp}`);
  lines.push("");
  lines.push(`**Project**: ${report.project}  `);
  lines.push(`**Audited Domains**: ${report.domainsAudited}  `);
  lines.push(`**Total URLs Checked**: ${report.totalUrlsChecked}  `);
  lines.push(`**Average AEO Score**: **${report.averageAeoScore}/100**  `);
  lines.push("");

  lines.push("## Domain Breakdown");
  lines.push("");

  for (const res of report.results) {
    lines.push(`### ${res.domain.name} (${res.domain.url})`);
    lines.push(`- **Status**: ${res.passed ? "✅ Compliant" : "⚠️ Needs Attention"}`);
    lines.push(`- **Robots.txt**: ${res.robotsAccessible ? "Accessible" : "Missing / Blocked"}`);
    lines.push(`- **Sitemap**: ${res.sitemapAccessible ? `Accessible (${res.sitemapUrlCount} URLs)` : "Missing / Blocked"}`);
    lines.push(`- **Domain AEO Score**: **${res.averageAeoScore}/100**`);
    lines.push("");

    lines.push("| URL | HTTP Status | Response Time | AEO Score | Schema Entities | Key Issues |");
    lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");

    for (const p of res.pages) {
      const entities = p.schema.typesFound.length > 0 ? p.schema.typesFound.join(", ") : "None";
      const issueSummary = p.issues.length > 0 ? p.issues.join("; ") : "None";
      lines.push(
        `| \`${p.url}\` | ${p.status} | ${p.responseTimeMs}ms | ${p.aeo.score}/100 | ${entities} | ${issueSummary} |`
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("*Generated automatically by [SEOForge](https://github.com/Aryanban/seoforge) Autonomous Engine.*");

  return lines.join("\n");
}

export async function saveMarkdownReport(report: OverallAuditReport, baseDir: string = process.cwd()): Promise<string> {
  const reportsDir = path.join(baseDir, "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const dateStr = new Date().toISOString().split("T")[0];
  const filePath = path.join(reportsDir, `daily-${dateStr}.md`);

  const content = generateMarkdownReport(report);
  await fs.writeFile(filePath, content, "utf-8");

  return filePath;
}
