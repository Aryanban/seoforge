import fs from "fs/promises";
import path from "path";
import { green, red, yellow, cyan, bold, gray, magenta } from "colorette";
import { DomainAuditResult, OverallAuditReport, IssueSummary } from "./types.js";

export function formatTerminalOutput(report: OverallAuditReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(bold(cyan("┌────────────────────────────────────────────────────────────────────────┐")));
  lines.push(bold(cyan("│                   SEOForge Autonomous Site Audit                       │")));
  lines.push(bold(cyan("│               Ahrefs-Grade Technical Health & AEO Engine               │")));
  lines.push(bold(cyan("└────────────────────────────────────────────────────────────────────────┘")));
  lines.push(gray(`Timestamp: ${report.timestamp} | Project: ${report.project}`));
  lines.push("");

  // Aggregate issues across all domains
  const allIssuesMap = new Map<string, IssueSummary>();
  for (const d of report.results) {
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

  const sortedIssues = Array.from(allIssuesMap.values());
  const severityWeight = { Error: 3, Warning: 2, Notice: 1 };
  sortedIssues.sort((a, b) => {
    if (severityWeight[a.severity] !== severityWeight[b.severity]) {
      return severityWeight[b.severity] - severityWeight[a.severity];
    }
    return b.affectedPages - a.affectedPages;
  });

  // Ahrefs-Style Issues Overview Table
  lines.push(bold("## Site Audit: Issues Overview"));
  lines.push("");
  lines.push(
    `┌──────────────────────────────────────────────────────────┬──────────┬──────────┬────────┐`
  );
  lines.push(
    `│ ${bold("Issue".padEnd(56))} │ ${bold("Severity".padEnd(8))} │ ${bold("Affected".padStart(8))} │ ${bold("Change".padStart(6))} │`
  );
  lines.push(
    `├──────────────────────────────────────────────────────────┼──────────┼──────────┼────────┤`
  );

  if (sortedIssues.length === 0) {
    lines.push(
      `│ ${green("No issues detected across any audited pages!".padEnd(56))} │ ${green("Clean".padEnd(8))} │ ${"0".padStart(8)} │ ${"0".padStart(6)} │`
    );
  } else {
    for (const issue of sortedIssues) {
      let sevColored: string;
      if (issue.severity === "Error") sevColored = red(issue.severity.padEnd(8));
      else if (issue.severity === "Warning") sevColored = yellow(issue.severity.padEnd(8));
      else sevColored = cyan(issue.severity.padEnd(8));

      let changeStr = issue.change > 0 ? `+${issue.change}` : `${issue.change}`;
      let changeColored: string;
      if (issue.change < 0) {
        changeColored = green(changeStr.padStart(6)); // Resolved issues in green
      } else if (issue.change > 0) {
        changeColored = red(changeStr.padStart(6)); // New issues in red
      } else {
        changeColored = gray(changeStr.padStart(6));
      }

      const nameTrunc = issue.name.length > 56 ? issue.name.slice(0, 53) + "..." : issue.name.padEnd(56);
      const affectedStr = String(issue.affectedPages).padStart(8);

      lines.push(`│ ${nameTrunc} │ ${sevColored} │ ${affectedStr} │ ${changeColored} │`);
    }
  }
  lines.push(
    `└──────────────────────────────────────────────────────────┴──────────┴──────────┴────────┘`
  );
  lines.push("");

  // Per-domain audit breakdown
  lines.push(bold("## Audited Domains Breakdown"));
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
      totalErrors,
      totalWarnings,
      totalNotices,
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
    metaInfo += ` | Health: ${red(`${totalErrors} Errors`)}, ${yellow(`${totalWarnings} Warnings`)}, ${cyan(`${totalNotices} Notices`)}`;

    lines.push(metaInfo);

    for (const page of pages) {
      const codeBadge = page.status === 200 ? green(`${page.status} OK`) : red(`${page.status}`);
      const linkCountBadge = gray(`In: ${page.incomingInternalLinks.length} | Out: ${page.outgoingInternalLinks.length}`);
      const wordsBadge = gray(`${page.wordCount} words`);
      lines.push(
        `    • ${cyan(page.url)} [${codeBadge}, ${page.responseTimeMs}ms, ${wordsBadge}, ${linkCountBadge}] AEO: ${page.aeo.score}/100`
      );

      if (page.schema.hasJsonLd) {
        lines.push(`      ${green("Schema.org")}: ${page.schema.typesFound.join(", ")}`);
      } else {
        lines.push(`      ${yellow("Schema.org")}: None detected`);
      }

      if (page.isSpaCanonicalValid) {
        lines.push(`      ${gray("ℹ Canonical")}: SPA client root fallback acknowledged`);
      }

      if (page.auditIssues.length > 0) {
        for (const issue of page.auditIssues) {
          if (issue.severity === "Error") {
            lines.push(`      ${red("✖ [Error]")} ${issue.name}: ${issue.message}`);
          } else if (issue.severity === "Warning") {
            lines.push(`      ${yellow("⚠ [Warning]")} ${issue.name}: ${issue.message}`);
          } else {
            lines.push(`      ${cyan("ℹ [Notice]")} ${issue.name}: ${issue.message}`);
          }
        }
      }
    }
    lines.push("");
  }

  lines.push(bold(`Summary: ${report.domainsAudited} domains audited, ${report.totalUrlsChecked} URLs verified.`));
  lines.push(
    `Total Issues: ${red(`${report.totalErrors} Errors`)}, ${yellow(`${report.totalWarnings} Warnings`)}, ${cyan(
      `${report.totalNotices} Notices`
    )}`
  );
  lines.push(
    `Average Ecosystem AEO Score: ${
      report.averageAeoScore >= 70 ? green(`${report.averageAeoScore}/100`) : yellow(`${report.averageAeoScore}/100`)
    }`
  );

  return lines.join("\n");
}

export function generateMarkdownReport(report: OverallAuditReport): string {
  const lines: string[] = [];

  lines.push(`# SEOForge Site Audit & AEO Report`);
  lines.push(`*Ahrefs-Grade Technical SEO & Answer Engine Optimization Audit*`);
  lines.push("");
  lines.push(`**Project**: ${report.project}  `);
  lines.push(`**Crawl Date**: ${report.timestamp}  `);
  lines.push(`**Audited Domains**: ${report.domainsAudited}  `);
  lines.push(`**Total URLs Checked**: ${report.totalUrlsChecked}  `);
  lines.push(
    `**Total Issues**: ${report.totalErrors} Errors, ${report.totalWarnings} Warnings, ${report.totalNotices} Notices  `
  );
  lines.push(`**Average Ecosystem AEO Score**: **${report.averageAeoScore}/100**  `);
  lines.push("");

  // Aggregate issues across all domains
  const allIssuesMap = new Map<string, IssueSummary>();
  for (const d of report.results) {
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

  const sortedIssues = Array.from(allIssuesMap.values());
  const severityWeight = { Error: 3, Warning: 2, Notice: 1 };
  sortedIssues.sort((a, b) => {
    if (severityWeight[a.severity] !== severityWeight[b.severity]) {
      return severityWeight[b.severity] - severityWeight[a.severity];
    }
    return b.affectedPages - a.affectedPages;
  });

  lines.push("## Site Audit: Issues Overview (Ahrefs Standard)");
  lines.push("");
  lines.push("| Issue | Severity | Affected Pages | Change | Actionable Recommendation |");
  lines.push("| :--- | :--- | :--- | :--- | :--- |");

  if (sortedIssues.length === 0) {
    lines.push("| None detected | Clean | 0 | 0 | All audited properties satisfy SEO & AEO standards. |");
  } else {
    for (const issue of sortedIssues) {
      const changeStr = issue.change > 0 ? `+${issue.change}` : `${issue.change}`;
      const sevBadge =
        issue.severity === "Error"
          ? "🔴 **Error**"
          : issue.severity === "Warning"
          ? "🟡 **Warning**"
          : "🔵 **Notice**";
      lines.push(
        `| **${issue.name}** | ${sevBadge} | ${issue.affectedPages} | \`${changeStr}\` | ${issue.recommendation} |`
      );
    }
  }
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
    lines.push(
      `- **Domain Health**: ${res.totalErrors} Errors, ${res.totalWarnings} Warnings, ${res.totalNotices} Notices`
    );
    lines.push("");

    lines.push(
      "| URL | HTTP Status | Response Time | Word Count | Incoming Links | AEO Score | Schema Entities | Key Issues |"
    );
    lines.push(
      "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |"
    );

    for (const p of res.pages) {
      const entities = p.schema.typesFound.length > 0 ? p.schema.typesFound.join(", ") : "None";
      const issueSummary =
        p.auditIssues.length > 0
          ? p.auditIssues.map((i) => `[${i.severity}] ${i.name}`).join("; ")
          : "None";
      lines.push(
        `| \`${p.url}\` | ${p.status} | ${p.responseTimeMs}ms | ${p.wordCount} | ${p.incomingInternalLinks.length} in / ${p.outgoingInternalLinks.length} out | ${p.aeo.score}/100 | ${entities} | ${issueSummary} |`
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "*Generated automatically by [SEOForge](https://github.com/Aryanban/seoforge) Autonomous Engine & MCP Server.*"
  );

  return lines.join("\n");
}

export async function saveMarkdownReport(
  report: OverallAuditReport,
  baseDir: string = process.cwd()
): Promise<string> {
  const reportsDir = path.join(baseDir, "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const dateStr = new Date().toISOString().split("T")[0];
  const filePath = path.join(reportsDir, `daily-${dateStr}.md`);

  const content = generateMarkdownReport(report);
  await fs.writeFile(filePath, content, "utf-8");

  return filePath;
}
