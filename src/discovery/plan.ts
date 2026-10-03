/**
 * Search plan and saved-HTML import.
 *
 * Ports BeyondSEO `reputation.search_plan` and `reputation.import_search_html`.
 *
 * `searchPlan` emits Google *navigation* links only — it never claims to run
 * a search. `importSearchHtml` extracts candidate links from HTML snapshots
 * the operator already saved, and records that no live search was performed
 * by this tool. Both keep the "unverified lead" contract.
 */

import path from "path";
import { promises as fs } from "fs";
import { discover } from "./discover.js";
import { discoveryHost, normalizeCandidateUrl } from "./url.js";
import {
  searchImportMarkdown,
  searchPlanMarkdown,
  sourcesCsv,
} from "./report.js";
import type {
  DiscoveryCandidate,
  SavedProvider,
  SearchImportResult,
  SearchPlanResult,
} from "./types.js";

const ENGINE_TO_PROVIDER: Record<string, SavedProvider> = {
  Google: "google",
  Bing: "bing",
  DuckDuckGo: "duckduckgo-html",
};

/** Build a bounded plan of Google search navigation URLs (no searching). */
export function searchPlan(
  target: string,
  brand: string,
  pages = 5,
): SearchPlanResult {
  const normalized = normalizeCandidateUrl(target);
  if (!normalized || !brand.trim() || !(pages >= 1 && pages <= 20)) {
    throw new Error("Provide a target URL, brand and a page budget between 1 and 20.");
  }
  const query = `"${brand.trim()}" -site:${discoveryHost(normalized)}`;
  const result: SearchPlanResult = {
    target: normalized,
    brand: brand.trim(),
    requested_pages: pages,
    completed_pages: 0,
    query,
    created_at: new Date().toISOString(),
    pages: Array.from({ length: pages }, (_, i) => ({
      page: i + 1,
      url: `https://www.google.com/search?${new URLSearchParams({
        q: query,
        start: String(i * 10),
      }).toString()}`,
      status: "planned",
    })),
    note: "These are search navigation links, not scraped results or verified pagination. " +
      "Use available search/browser access and record actual coverage. Stop at access " +
      "challenges; import saved result pages or supply source URLs when pagination is " +
      "unavailable.",
  };
  return result;
}

/** Write a search plan to disk (markdown + JSON + an empty sources template). */
export async function writeSearchPlan(
  target: string,
  brand: string,
  outDir: string,
  pages = 5,
): Promise<SearchPlanResult> {
  const result = searchPlan(target, brand, pages);
  await fs.mkdir(outDir, { recursive: true });
  await writeIfEmpty(path.join(outDir, "search-plan.json"), JSON.stringify(result, null, 2));
  await fs.writeFile(path.join(outDir, "search-plan.md"), searchPlanMarkdown(result));
  return result;
}

/**
 * Import public search-result snapshots without claiming to have run live
 * searches. Extracts result-heading links and records each one as an
 * unverified candidate.
 */
export async function importSearchHtml(
  paths: string[],
  target: string,
  query: string,
  capturedAt: string,
  outDir: string,
  engine = "Google",
): Promise<SearchImportResult> {
  const normalized = normalizeCandidateUrl(target);
  if (!paths || paths.length === 0 || paths.length > 20) {
    throw new Error("Supply 1-20 saved result pages.");
  }
  if (!normalized || !query.trim() || !capturedAt.trim()) {
    throw new Error("Supply a target URL, query and capture timestamp.");
  }
  await ensureEmptyOutDir(outDir);

  const originalTime = capturedAt.trim();
  const stamp =
    originalTime.length === 10 ? `${originalTime}T00:00:00+00:00` : originalTime;
  const provider = ENGINE_TO_PROVIDER[engine] ?? (engine.toLowerCase() as SavedProvider);

  const discovered = await discover([], outDir, {
    target: normalized,
    offline: true,
    saved: paths.map((p) => ({
      path: p,
      provider,
      query: query.trim(),
      captured_at: stamp,
    })),
  });

  const candidates = discovered.candidates;
  for (const candidate of candidates) {
    for (const observation of candidate.provenance) {
      observation.search_page =
        paths.findIndex((p) => p === observation.source_snapshot) + 1 || null;
      (observation as Record<string, unknown>).timestamp_precision =
        originalTime.length === 10 ? "date" : "timestamp";
    }
  }

  const rows = candidates.map((c) => rowFor(c, engine, query.trim(), originalTime));
  await fs.writeFile(
    path.join(outDir, "sources.csv"),
    sourcesCsv(rows, [
      "URL",
      "engine",
      "query",
      "search_page",
      "result_order",
      "observed_at",
      "source_snapshot",
      "provenance",
    ]),
  );

  const result: SearchImportResult = {
    input_kind: "supplied_search_html",
    engine_declared_by_operator: engine,
    snapshots_imported: paths.length,
    attempts: discovered.attempts,
    candidate_urls: rows.length,
    captured_at_supplied: stamp,
    note: "Extracted result-heading links from supplied HTML. Result order is not a " +
      "verified search rank; snippets do not establish mentions or backlinks. No live " +
      "search was performed by this command.",
    candidates,
  };
  await fs.writeFile(path.join(outDir, "search-import.md"), searchImportMarkdown(result));
  return result;
}

interface ImportRow {
  URL: string;
  engine: string;
  query: string;
  search_page: number | null;
  result_order: number | null;
  observed_at: string;
  source_snapshot?: string | null;
  provenance: unknown;
  [key: string]: unknown;
}

function rowFor(
  candidate: DiscoveryCandidate,
  engine: string,
  query: string,
  observedAt: string,
): ImportRow {
  const first = candidate.provenance[0] ?? {};
  return {
    URL: candidate.url,
    engine,
    query,
    search_page: (first.search_page as number | null) ?? null,
    result_order: (first.result_order as number | null) ?? null,
    observed_at: observedAt,
    source_snapshot: (first.source_snapshot as string | null) ?? null,
    provenance: candidate.provenance,
  };
}

async function ensureEmptyOutDir(outDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(outDir);
    if (entries.length > 0) {
      throw new Error("Choose a new search-import folder.");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

async function writeIfEmpty(filePath: string, contents: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `${contents}\n`);
  }
}
