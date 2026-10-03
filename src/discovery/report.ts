/**
 * Discovery report writers — markdown summary + sources.csv.
 *
 * Ports the report shapes from BeyondSEO `engine.save_report` /
 * `discovery.discover` CSV output. `sources.csv` is the handoff file: it has
 * a `URL` column so it drops straight into `seoforge reputation --sources`.
 */

import type {
  DiscoveryCandidate,
  DiscoveryResult,
  SearchAttempt,
  SearchImportResult,
  SearchPlanResult,
} from "./types.js";
import { isSuccessStatus } from "./types.js";

/** Quote a CSV field when it contains a comma, quote or newline. */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function sourcesCsv(
  rows: Array<Record<string, unknown>>,
  columns = ["URL", "engine", "query", "observed_at", "search_page", "provenance"],
): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** One row per candidate for the handoff CSV. */
export function candidatesToRows(candidates: DiscoveryCandidate[]): Array<Record<string, unknown>> {
  return candidates.map((candidate) => {
    const first = candidate.provenance[0] ?? {};
    return {
      URL: candidate.url,
      engine: first.provider ?? null,
      query: first.query ?? null,
      observed_at: first.captured_at ?? first.imported_at ?? null,
      search_page: first.search_page ?? null,
      provenance: candidate.provenance,
    };
  });
}

function statusLabel(status: string): string {
  return isSuccessStatus(status) ? status : `⚠ ${status}`;
}

function attemptsTable(attempts: SearchAttempt[]): string {
  if (attempts.length === 0) return "_No search attempts were recorded._";
  const lines = ["| Query | Provider | Status | Leads |", "| --- | --- | --- | --- |"];
  for (const a of attempts) {
    const query = a.query.length > 48 ? `${a.query.slice(0, 45)}...` : a.query;
    lines.push(
      `| ${query || "—"} | ${a.provider} | ${statusLabel(a.status)} | ${a.accepted_leads ?? a.results.length} |`,
    );
  }
  return lines.join("\n");
}

export function discoveryMarkdown(result: DiscoveryResult): string {
  const lines = [
    "# SEOForge Discovery — search leads (unverified)",
    "",
    `Target: ${result.target || "—"}`,
    `Status: **${result.status}** — ${result.candidate_count} candidate URL${result.candidate_count === 1 ? "" : "s"}`,
    `Native search available: ${result.search_available ? "yes (at least one provider responded)" : "no"}`,
    "",
    "## Search attempts",
    "",
    attemptsTable(result.attempts),
    "",
    "## What this is",
    "",
    result.note,
    "",
    "- Every candidate above is an **unverified lead**. Verify the page with the crawler before treating it as a backlink or mention.",
    `- This is a bounded sample: ${result.native_requests} of ${result.request_budget} native requests used${result.candidate_budget_reached ? ", and the candidate budget was reached" : ""}.`,
    "- A failed search provider is not a failed audit: supply URLs or import saved result pages instead.",
    "",
    "## Next step",
    "",
    "```sh",
    `seoforge reputation --target ${result.target || "https://example.com"} \\`,
    '  --brand "Your Brand" --sources discovery/sources.csv',
    "```",
    "",
  ];
  return lines.join("\n");
}

export function searchPlanMarkdown(plan: SearchPlanResult): string {
  const lines = [
    "# Reputation discovery plan",
    "",
    `Query: \`${plan.query}\``,
    `Requested pages: ${plan.requested_pages} (completed: ${plan.completed_pages})`,
    "",
    plan.note,
    "",
    ...plan.pages.map((p) => `- Page ${p.page}: ${p.url} — ${p.status}`),
    "",
    "Capture these pages with your own browser/search access, then import them:",
    "",
    "```sh",
    `seoforge search-import --target ${plan.target} --query "${plan.query}" \\`,
    "  --engine Google --captured-at 2026-09-23 --out reports/search-import \\",
    "  page1.html page2.html",
    "```",
    "",
  ];
  return lines.join("\n");
}

export function searchImportMarkdown(result: SearchImportResult): string {
  const lines = [
    "# Imported search candidates",
    "",
    result.note,
    "",
    `Imported ${result.candidate_urls} unique candidate URL${result.candidate_urls === 1 ? "" : "s"} from ${result.snapshots_imported} snapshot${result.snapshots_imported === 1 ? "" : "s"} (engine: ${result.engine_declared_by_operator}).`,
    "",
    "## Attempts",
    "",
    attemptsTable(result.attempts),
    "",
    "Verify these pages with the crawler before treating any as a backlink or mention.",
    "",
  ];
  return lines.join("\n");
}
