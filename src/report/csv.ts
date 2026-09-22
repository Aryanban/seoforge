/**
 * CSV export — pages, issues, and links for spreadsheet workflows.
 */
import { CrawlResult } from "../types.js";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function pagesToCsv(result: CrawlResult): string {
  const header = [
    "url",
    "status",
    "depth",
    "ttfb_ms",
    "response_ms",
    "title",
    "description",
    "h1",
    "word_count",
    "incoming_links",
    "outgoing_links",
    "external_links",
    "is_orphan",
    "internal_link_score",
    "is_indexable",
    "canonical",
    "canonical_matches",
    "aeo_score",
    "schema_types",
    "issues",
  ];
  const rows = [header.join(",")];
  const pages = [...result.pages].sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  for (const p of pages) {
    rows.push(
      [
        p.url,
        p.status,
        p.depth,
        p.ttfbMs ?? p.responseTimeMs,
        p.responseTimeMs,
        p.title,
        p.description,
        p.h1Text,
        p.wordCount,
        p.incomingInternalLinks.length,
        p.outgoingInternalLinks.length,
        p.externalLinks.length,
        p.isOrphan ? "yes" : "no",
        p.internalLinkScore,
        p.isIndexable ? "yes" : "no",
        p.canonical,
        p.canonicalMatches ? "yes" : "no",
        p.aeo.score,
        p.schema.typesFound.join("|"),
        p.auditIssues.map((i) => `[${i.severity}] ${i.name}`).join("; "),
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  return rows.join("\n");
}

export function issuesToCsv(result: CrawlResult): string {
  const header = ["issue", "severity", "category", "page_url", "message"];
  const rows = [header.join(",")];
  for (const p of result.pages) {
    for (const i of p.auditIssues) {
      rows.push([i.name, i.severity, i.category, p.url, i.message].map(csvEscape).join(","));
    }
  }
  return rows.join("\n");
}

export function linksToCsv(result: CrawlResult): string {
  const header = ["source", "target", "anchor_text", "type", "nofollow", "target_status", "broken", "redirect"];
  const rows = [header.join(",")];
  const seen = new Set<string>();
  for (const l of result.links) {
    const key = `${l.source}|${l.target}|${l.anchorText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(
      [
        l.source,
        l.target,
        l.anchorText,
        l.isInternal ? "internal" : "external",
        l.nofollow ? "yes" : "no",
        l.targetStatus,
        l.isBroken ? "yes" : "no",
        l.isRedirect ? "yes" : "no",
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  return rows.join("\n");
}

export function recommendationsToCsv(result: CrawlResult): string {
  const header = ["priority", "issue", "severity", "category", "affected_pages", "effort", "recommendation"];
  const rows = [header.join(",")];
  for (const r of result.recommendations) {
    rows.push(
      [r.priority, r.name, r.severity, r.category, r.affectedPages, r.effort, r.recommendation]
        .map(csvEscape)
        .join(",")
    );
  }
  return rows.join("\n");
}

export type CsvKind = "pages" | "issues" | "links" | "recommendations";

export function toCsv(result: CrawlResult, kind: CsvKind): string {
  switch (kind) {
    case "issues":
      return issuesToCsv(result);
    case "links":
      return linksToCsv(result);
    case "recommendations":
      return recommendationsToCsv(result);
    case "pages":
    default:
      return pagesToCsv(result);
  }
}
