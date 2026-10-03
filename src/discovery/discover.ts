/**
 * The discovery orchestrator.
 *
 * Ports BeyondSEO `discovery.discover`, `discovery.consolidate` and
 * `discovery.host_attempts`.
 *
 * Sources are tried in a strict precedence for each query: recorded host
 * responses first (the host's own search tool, never impersonated), then
 * permitted native providers in order. Native attempts never retry: a
 * failure advances to the next provider. Everything is bounded by a shared
 * request/wall-clock budget. Own-site and search-provider hosts are filtered
 * out of the leads, and survivors are recorded as `unverified_lead`.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "path";
import { failureDetail } from "./diagnostics.js";
import { NativeSearch } from "./native.js";
import { parseSearch } from "./parse.js";
import { RequestBudget } from "./budget.js";
import { discoveryHost, normalizeCandidateUrl } from "./url.js";
import {
  DISCOVERY_NOTE,
  isSuccessStatus,
  type AttemptStatus,
  type DiscoveryCandidate,
  type DiscoveryResult,
  type DiscoverOptions,
  type HostRecord,
  type NativeProvider,
  type Provenance,
  type SearchAttempt,
  type SearchQuery,
} from "./types.js";

const PROVIDERS: NativeProvider[] = ["duckduckgo-html", "bing-rss"];
const MAX_SAVED_BYTES = 5_000_000;

/** A raw lead before consolidation; `verification` is assigned on merge. */
interface Lead {
  url: string;
  provenance: Provenance[];
}

const PROVIDER_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "bing.com",
  "www.bing.com",
  "duckduckgo.com",
  "html.duckduckgo.com",
]);

/** Require an ISO capture timestamp that actually carries a timezone. */
function requireTimestamp(value: string | undefined | null, label: string): string {
  if (!value) throw new Error(`Host attempt needs ${label}.`);
  const normalized = value.endsWith("Z") ? `${value.slice(0, -1)}+00:00` : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Host attempt needs ${label} as an ISO timestamp with a timezone.`);
  }
  return normalized;
}

/** Read tool outputs recorded by the host; never pretend the CLI called a host tool. */
export function hostAttempts(payload: HostRecord[] | string): SearchAttempt[] {
  const records: HostRecord[] =
    typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!Array.isArray(records)) throw new Error("Host import needs an 'attempts' array.");
  if (records.length > 100) throw new Error("Host import needs at most 100 recorded attempts.");

  return records.map((row) => {
    for (const key of ["provider", "query", "captured_at", "status", "evidence"] as const) {
      if (!row[key]) throw new Error(`Host attempt needs ${key}.`);
    }
    const capturedAt = requireTimestamp(row.captured_at, "captured_at");
    if (row.status === "results" && !(row.results && row.results.length > 0)) {
      throw new Error("A successful host result must contain result URLs.");
    }
    const results = (row.results ?? []).map((item, i) => ({
      url: item.url,
      title: item.title ?? "",
      snippet: item.snippet ?? "",
      result_order: i + 1,
    }));
    let failure = null;
    let status: AttemptStatus = row.status as AttemptStatus;
    if (!isSuccessStatus(row.status)) {
      // The raw tool evidence, not a claimed cause, determines classification.
      failure = failureDetail(row.evidence, row.http_status ?? 0);
      status = failure ? failure.code : "unknown";
    }
    return {
      provider: row.provider as SearchAttempt["provider"],
      query: row.query,
      requested_market: row.requested_market ?? row.market ?? null,
      requested_language: row.requested_language ?? row.language ?? null,
      captured_at: capturedAt,
      attempted_at: capturedAt,
      status,
      failure,
      results,
      origin: "host_recorded",
      coverage: row.coverage ?? "Host-returned sample; pagination/localization unknown.",
    } as SearchAttempt;
  });
}

/** Consolidate URL duplicates without dropping separate discovery observations. */
export function consolidate(candidates: Lead[]): DiscoveryCandidate[] {
  const merged = new Map<string, DiscoveryCandidate>();
  for (const item of candidates) {
    const url = normalizeCandidateUrl(item.url);
    if (!url) continue;
    let row = merged.get(url);
    if (!row) {
      row = { url, verification: "unverified_lead", provenance: [] };
      merged.set(url, row);
    }
    for (const observation of item.provenance) {
      if (!row.provenance.includes(observation)) row.provenance.push(observation);
    }
  }
  return [...merged.values()];
}

export async function discover(
  queries: SearchQuery[],
  outDir: string,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const {
    target = "",
    providers = PROVIDERS,
    hostRecords = [],
    candidates = [],
    saved = [],
    offline = false,
    maxRequests = 16,
    maxQueries = 8,
    maxCandidates = 100,
    timeoutMs = 12_000,
    seconds = 90,
    cacheDir,
    cacheTtlSeconds = 86_400,
    snapshotDir,
  } = options;

  if (
    !(maxRequests >= 1 && maxRequests <= 100) ||
    !(maxQueries >= 1 && maxQueries <= 20) ||
    !(maxCandidates >= 1 && maxCandidates <= 500) ||
    !(timeoutMs >= 1 && timeoutMs <= 30_000) ||
    !(seconds >= 1 && seconds <= 300)
  ) {
    throw new Error("Discovery budgets exceed supported bounds.");
  }
  for (const p of providers) {
    if (p !== "duckduckgo-html" && p !== "bing-rss") {
      throw new Error("Unknown native search provider.");
    }
  }
  if (!Array.isArray(queries)) throw new Error("Queries must be a list.");
  if (saved.length > 20) throw new Error("At most 20 saved search pages can be imported.");
  if (target && !normalizeCandidateUrl(target)) {
    throw new Error("Discovery target must be a valid http(s) URL.");
  }

  await fs.mkdir(outDir, { recursive: true });
  const budget = new RequestBudget(maxRequests, seconds);
  const snapshots = snapshotDir ?? path.join(outDir, "snapshots");
  const adapters = new Map(
    providers.map((p) => [p, new NativeSearch(p, budget, timeoutMs, snapshots)]),
  );
  const targetHost = discoveryHost(target);
  const attempts: SearchAttempt[] = [];
  const leads: Lead[] = [];

  function addAttempt(
    row: Partial<SearchAttempt> & { status: AttemptStatus; results?: any[] },
    spec: SearchQuery,
    previous: { provider: string; status: string } | null,
  ): AttemptStatus {
    const full: SearchAttempt = {
      actual_market: null,
      actual_language: null,
      captured_at: new Date().toISOString(),
      attempted_at: new Date().toISOString(),
      ...row,
      query: spec.query,
      requested_market: spec.market ?? null,
      requested_language: spec.language ?? null,
      fallback_from: previous,
      results: row.results ?? [],
    } as SearchAttempt;
    requireTimestamp(full.captured_at, "captured_at");

    const rows: Lead[] = [];
    full.results.forEach((item, i) => {
      const url = normalizeCandidateUrl(item.url);
      if (!url) return;
      const host = discoveryHost(url);
      if (PROVIDER_HOSTS.has(host)) return;
      if (targetHost && (host === targetHost || host.endsWith(`.${targetHost}`))) return;

      const provenance: Provenance = { ...full } as Provenance;
      delete (provenance as any).results;
      delete (provenance as any).robots;
      provenance.result_order = item.result_order ?? i + 1;
      provenance.title = item.title ?? "";
      provenance.snippet = item.snippet ?? "";
      rows.push({ url, provenance: [provenance] });
    });
    if (full.status === "results" && rows.length === 0) {
      full.status = "no_relevant_results";
    }
    full.accepted_leads = rows.length;
    attempts.push(full);
    leads.push(...rows);
    return full.status;
  }

  // Supplied candidates: URLs the operator already knows about.
  for (const item of candidates) {
    const url = typeof item === "string" ? item : ((item as any).URL ?? (item as any).url) ?? "";
    const extra = typeof item === "string" ? {} : item;
    leads.push({
      url,
      provenance: [
        {
          provider: "supplied",
          query: null,
          captured_at: null,
          imported_at: new Date().toISOString(),
          origin: "supplied_candidate",
          evidence: extra,
          coverage: "URL supplied; source page not yet checked.",
        },
      ],
    });
  }

  // Saved search HTML: operator snapshots, never live scrapes.
  for (const record of saved) {
    const spec: SearchQuery = {
      query: record.query,
      market: record.market ?? null,
      language: record.language ?? null,
    };
    requireTimestamp(record.captured_at, "captured_at");
    const stat = await fs.stat(record.path);
    if (stat.size > MAX_SAVED_BYTES) {
      throw new Error("Saved search HTML exceeds the 5 MB import limit.");
    }
    const body = await fs.readFile(record.path);
    const [status, rows, reason] = parseSearch(body, record.provider);
    addAttempt(
      {
        provider: record.provider as SearchAttempt["provider"],
        captured_at: requireTimestamp(record.captured_at, "captured_at"),
        status,
        results: rows,
        origin: "saved_html",
        source_snapshot: record.path,
        response_sha256: createHash("sha256").update(body).digest("hex"),
        failure: isSuccessStatus(status)
          ? null
          : { code: status, evidence: reason, http_status: null, cause: "unknown" },
        coverage: "Supplied snapshot; freshness/localization not independently verified.",
        search_page: record.search_page ?? null,
      },
      spec,
      null,
    );
  }

  // Queries: recorded host responses first, then native providers.
  for (const spec of queries.slice(0, maxQueries)) {
    if (!spec || !String(spec.query ?? "").trim()) {
      throw new Error("Each query needs nonempty query text.");
    }
    let previous: { provider: string; status: string } | null = null;
    let found = false;

    const records = hostRecords.filter(
      (r) =>
        r.query === spec.query &&
        (r.requested_market ?? null) === (spec.market ?? null) &&
        (r.requested_language ?? null) === (spec.language ?? null),
    );
    for (const row of records) {
      const state = addAttempt(row as SearchAttempt, spec, previous);
      previous = { provider: String(row.provider), status: state };
      found = found || state === "results";
    }
    if (found) continue;

    if (spec.query_review_status === "needs_review") {
      addAttempt(
        {
          provider: "query_preparation",
          origin: "query_review",
          status: "query_review_required",
          captured_at: new Date().toISOString(),
          results: [],
          failure: null,
          coverage:
            "No search executed for this generated seed. Agent: write a natural buyer query from the profile, mark it reviewed and continue. This is not a provider failure.",
        },
        spec,
        previous,
      );
      continue;
    }

    if (offline) {
      addAttempt(
        {
          provider: "native",
          status: "tool_unavailable",
          captured_at: new Date().toISOString(),
          results: [],
          failure: {
            code: "tool_unavailable",
            evidence: "Native search disabled for this run.",
            http_status: null,
            cause: "unknown",
          },
        },
        spec,
        previous,
      );
      continue;
    }

    for (const [provider, adapter] of adapters) {
      const cacheKey = cacheDir
        ? path.join(
            cacheDir,
            `${createHash("sha256").update(JSON.stringify([provider, spec])).digest("hex")}.json`,
          )
        : null;

      let row: any = null;
      if (cacheKey) {
        row = await readCache(cacheKey, cacheTtlSeconds);
      }
      if (row === null) {
        try {
          row = await adapter.call(spec);
        } catch (err) {
          const failure = failureDetail(
            err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          );
          row = {
            provider,
            status: failure ? failure.code : "unknown",
            failure,
            captured_at: new Date().toISOString(),
            results: [],
          };
        }
        if (cacheKey && isSuccessStatus(row.status)) {
          await writeCache(cacheKey, row);
        }
      }

      const state = addAttempt(row, spec, previous);
      previous = { provider, status: state };
      if (state === "results") break;
    }
  }

  const merged = consolidate(leads);
  const limited = merged.length > maxCandidates;
  const capped = merged.slice(0, maxCandidates);

  const result: DiscoveryResult = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    target,
    status: capped.length > 0 ? "leads_available" : "no_leads",
    search_available: attempts.some((a) => isSuccessStatus(a.status)),
    queries_requested: queries.length,
    queries_processed: Math.min(queries.length, maxQueries),
    queries_needing_review: attempts.filter((a) => a.status === "query_review_required").length,
    attempts,
    candidates: capped,
    candidate_count: capped.length,
    native_requests: budget.used,
    request_budget: maxRequests,
    candidate_budget_reached: limited,
    coverage_limited: true,
    note: DISCOVERY_NOTE,
    host_tool_availability: hostRecords.length > 0 ? "recorded" : "not_observed_by_cli",
  };

  await fs.writeFile(
    path.join(outDir, "discovery.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}

async function readCache(cacheKey: string, ttlSeconds: number): Promise<any> {
  try {
    const raw = await fs.readFile(cacheKey, "utf-8");
    const entry = JSON.parse(raw);
    const age = (Date.now() - new Date(entry.captured_at).getTime()) / 1000;
    if (age >= 0 && age <= ttlSeconds && isSuccessStatus(entry.status)) {
      return { ...entry, cache_hit: true };
    }
  } catch {
    /* unreadable or expired cache entry */
  }
  return null;
}

async function writeCache(cacheKey: string, row: any): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cacheKey), { recursive: true });
    // Cache embeds response metadata, not a path into another run's artifacts.
    const { source_snapshot, ...rest } = row;
    await fs.writeFile(cacheKey, JSON.stringify(rest, null, 2));
  } catch {
    /* cache is a convenience, never a hard requirement */
  }
}
