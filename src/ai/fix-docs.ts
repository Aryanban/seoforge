/**
 * Per-issue AI-style markdown fix-document builder (deterministic).
 */
import { IssueSummary } from "../types.js";

export interface FixLibraryEntry {
  impact: string;
  steps: string[];
  beforeAfter?: { before: string; after: string };
  effort?: "S" | "M" | "L";
}

export function buildFixDoc(issue: IssueSummary, entry?: FixLibraryEntry, maxUrls = 20): string {
  const lines: string[] = [];
  const impact = entry?.impact ?? defaultImpact(issue);
  const steps = entry?.steps ?? [issue.recommendation];

  lines.push(`> **Why it matters**`);
  lines.push("");
  lines.push(impact);
  lines.push("");

  lines.push(`> **How to fix**`);
  lines.push("");
  steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });
  lines.push("");

  if (entry?.beforeAfter) {
    lines.push(`> **Before / after**`);
    lines.push("");
    lines.push("```diff");
    lines.push(`- ${entry.beforeAfter.before}`);
    lines.push(`+ ${entry.beforeAfter.after}`);
    lines.push("```");
    lines.push("");
  }

  if (issue.affectedUrls.length > 0) {
    const capped = maxUrls !== Infinity && issue.affectedUrls.length > maxUrls;
    const shown = capped ? issue.affectedUrls.slice(0, maxUrls) : issue.affectedUrls;
    const label = capped
      ? `Affected URLs (${shown.length} shown)`
      : `Affected URLs (all ${issue.affectedUrls.length})`;
    lines.push(`> **${label}**`);
    lines.push("");
    for (const url of shown) lines.push(`- \`${url}\``);
    if (capped) {
      lines.push(`- _…and ${issue.affectedUrls.length - shown.length} more (see the dashboard or \`export backlog --all-urls\`)_`);
    }
    lines.push("");
  }

  if (issue.change !== 0) {
    const trend = issue.change > 0 ? `📈 **+${issue.change} new since last crawl**` : `📉 **${issue.change} resolved since last crawl**`;
    lines.push(trend);
    lines.push("");
  }

  return lines.join("\n");
}

function defaultImpact(issue: IssueSummary): string {
  if (issue.severity === "Error") {
    return `${issue.name} is a critical error affecting ${issue.affectedPages} page(s). Errors block crawling, indexing, or user access and should be fixed before anything else.`;
  }
  if (issue.severity === "Warning") {
    return `${issue.name} weakens the page's ranking potential across ${issue.affectedPages} page(s). Warnings do not block indexing but compound over time.`;
  }
  return `${issue.name} is an optimization opportunity across ${issue.affectedPages} page(s). Notices are low-risk polish items.`;
}
