/**
 * Load and filter the publishing-source catalog.
 *
 * Ported from BeyondSEO `scripts/backlink_sources.py` (`load_sources`,
 * `catalog_markdown`). Deterministic, no network access.
 */

import { POSTING_SITES } from "./posting-sites.data.js";
import type { PostingSite, SourceFilter } from "./types.js";

const lower = (s: string): string => s.toLowerCase();

/**
 * Filter the 206-entry catalog. All filters are optional; an empty filter
 * returns the whole catalog. `category` matches any topic tag by substring.
 */
export function loadSources(filter: SourceFilter = {}): PostingSite[] {
  const { platform, category, kind, status } = filter;
  return POSTING_SITES.filter((r) => {
    if (platform && lower(platform) !== lower(r.name) && lower(platform) !== lower(r.id)) {
      return false;
    }
    if (category && !r.topics.some((t) => lower(t).includes(lower(category)))) {
      return false;
    }
    if (kind && kind !== r.kind) {
      return false;
    }
    if (status && status !== r.review_status) {
      return false;
    }
    return true;
  });
}

/** Total catalog size. */
export function catalogSize(): number {
  return POSTING_SITES.length;
}

/** Escape a cell value for safe inclusion in a markdown table. */
export function cell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ");
}

/**
 * Render filtered catalog rows as a browseable markdown table.
 * DR values are labelled unverified so they are never read as authority.
 */
export function catalogMarkdown(rows: PostingSite[]): string {
  const lines = [
    "# Free article and posting-site catalog",
    "",
    `${rows.length} matching website/community entries. Original PDF rows are preserved separately; duplicate account and post URLs count once per site entry.`,
    "",
    "Sheet DR values are unverified, sometimes conflicting, and are not DA. Guidance review checks documented routes, not successful account access or acquired links. Unreviewed entries require research.",
    "",
    `The source catalog contains ${catalogSize()} entries. See the posting guide for selection, writing, posting and verification steps.`,
    "",
    "| Website | Type | Topics | Review | Free terms | Sheet DR (unverified) | Posting route |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const route = r.posting_url ? `[Open](${r.posting_url})` : "Research first";
    lines.push(
      "| " +
        [
          `[${cell(r.name)}](${r.website_url})`,
          r.kind,
          cell(r.topics.join(", ")) || "Unclassified",
          r.review_status,
          r.cost_status,
          cell(r.sheet_dr_values.join(", ")) + (r.sheet_dr_conflict ? " (conflict)" : ""),
          route,
        ].join(" | ") +
        " |",
    );
  }
  return lines.join("\n") + "\n";
}
