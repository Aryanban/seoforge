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
    const {
      domain,
      passed,
      robotsAccessible,
      sitemapAccessible,
      sitemapUrlCount,
      llmsTxtAccessible,
      sampledUrlsCount,
      pages,
      averageAeoScore,
    } = domainResult;

    const statusBadge = passed ? green("✔ PASSED") : red("✘ ISSUES FOUND");
    lines.push(`${bold(domain.name)} (${cyan(domain.url)}) [${statusBadge}]`);

    let metaInfo = `  Robots: ${robotsAccessible ? green("Accessible") : red("Unreachable")} | Sitemap: ${
      sitemapAccessible ? green(`Accessible (${sitemapUrlCount} URLs)`) : red("Unreachable")
    }`;

    if (llmsTxtAccessible !== undefined) {
      metaInfo += ` | llms.txt: ${llmsTxtAccessible ? green("Accessible") : gray("N/A")}`;
    }
    if (sampledUrlsCount && sampledUrlsCount > 0) {
      metaInfo += ` | Sampled: ${cyan(`${sampledUrlsCount} URLs`)}`;
    }
    metaInfo += ` | Avg AEO: ${averageAeoScore >= 70 ? green(`${averageAeoScore}/100`) : yellow(`${averageAeoScore}/100`)}`;

    lines.push(metaInfo);

    for (const page of pages) {
      const codeBadge = page.status === 200 ? green(`${page.status} OK`) : red(`${page.status}`);
      lines.push(`    • ${cyan(page.url)} [${codeBadge}, ${page.responseTimeMs}ms] AEO: ${page.aeo.score}/100`);

      if (page.schema.hasJsonLd) {
        lines.push(`      ${green("Schema.org")}: ${page.schema.typesFound.join(", ")}`);
      } else {
        lines.push(`      ${yellow("Schema.org")}: None detected`);
      }

      if (page.isSpaCanonicalValid) {
        lines.push(`      ${gray("ℹ Canonical")}: SPA client root fallback acknowledged`);
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
    if (res.llmsTxtAccessible !== undefined) {
      lines.push(`- **llms.txt (AI Crawlers)**: ${res.llmsTxtAccessible ? "Accessible" : "Not Found"}`);
    }
    if (res.sampledUrlsCount && res.sampledUrlsCount > 0) {
      lines.push(`- **Dynamic Sitemap Sample**: ${res.sampledUrlsCount} parcel/village routes audited`);
    }
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
  lines.push("*Generated automatically by [SEOForge](https://github.com/Aryanban/seoforge) Autonomous Engine & MCP Server.*");

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
