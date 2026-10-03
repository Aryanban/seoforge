/**
 * Native search providers.
 *
 * Ports BeyondSEO `discovery.SearchTransport`, `discovery.NativeSearch` and
 * the robots handling those providers rely on.
 *
 * Native attempts have **zero automatic retries**: a failure advances to the
 * next provider. The shared budget includes robots, redirects and every HTTP
 * request. robots.txt is honoured per provider origin; when the policy itself
 * cannot be retrieved the request is withheld rather than sent.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import robotsParser from "robots-parser";
import { fetchPage } from "../crawl/fetcher.js";
import { failureDetail } from "./diagnostics.js";
import { parseSearch } from "./parse.js";
import { RequestBudget } from "./budget.js";
import type {
  AttemptStatus,
  FailureDetail,
  NativeProvider,
  SearchQuery,
  SearchResultRow,
} from "./types.js";

const MAX_BYTES = 2_000_000;
const ROBOTS_USER_AGENT = "SEOForgeBot";

const PROVIDER_BASE: Record<NativeProvider, string> = {
  "duckduckgo-html": "https://html.duckduckgo.com/html/",
  "bing-rss": "https://www.bing.com/search",
};

function originOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
}

export interface BudgetedResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  fetchedAt: string;
  finalUrl: string;
  error: string;
}

/** Fetch one URL, charging the shared budget and clamping to its deadline. */
export async function budgetedFetch(
  url: string,
  budget: RequestBudget,
  timeoutMs: number,
): Promise<BudgetedResponse> {
  budget.take();
  const fetchedAt = new Date().toISOString();
  const res = await fetchPage(url, {
    timeoutMs: Math.max(100, Math.min(timeoutMs, budget.remainingMs())),
  });
  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    body: res.html.slice(0, MAX_BYTES),
    fetchedAt,
    finalUrl: res.finalUrl,
    error: res.errorMessage ?? "",
  };
}

interface RobotsRules {
  blocked: boolean;
  parser: any;
}

/** Per-origin robots policy. Blocked origins withhold their requests. */
class DiscoveryRobotsCache {
  private cache = new Map<string, RobotsRules>();
  readonly evidence: Record<string, Record<string, unknown>> = {};

  constructor(private budget: RequestBudget, private timeoutMs: number) {}

  async decision(
    url: string,
  ): Promise<{ allowed: boolean; reason: "" | "robots_rule_disallowed" | "robots_unavailable" }> {
    const origin = originOf(url);
    let rules = this.cache.get(origin);
    if (!rules) {
      rules = await this.load(origin);
      this.cache.set(origin, rules);
    }
    if (rules.blocked) return { allowed: false, reason: "robots_unavailable" };
    if (rules.parser && rules.parser.isAllowed(url, ROBOTS_USER_AGENT) === false) {
      return { allowed: false, reason: "robots_rule_disallowed" };
    }
    return { allowed: true, reason: "" };
  }

  private async load(origin: string): Promise<RobotsRules> {
    const robotsUrl = `${origin}/robots.txt`;
    const r = await budgetedFetch(robotsUrl, this.budget, this.timeoutMs);
    const blocked =
      !!r.error || r.status === 429 || r.status >= 500 || (r.status >= 300 && r.status < 400);
    const text = r.status === 200 ? r.body.slice(0, 512_000) : "";
    this.evidence[origin] = {
      url: robotsUrl,
      status: r.status,
      error: r.error || null,
      blocked,
      policy_availability: blocked
        ? "unreachable"
        : r.status >= 400 && r.status < 500
          ? "unavailable"
          : "available",
      fetched_at: r.fetchedAt,
      sha256: createHash("sha256").update(r.body).digest("hex"),
      redirects: originOf(r.finalUrl) === origin ? [] : [r.finalUrl],
    };
    return { blocked, parser: text ? (robotsParser as any)(robotsUrl, text) : null };
  }
}

export interface NativeSearchResult {
  provider: NativeProvider;
  captured_at: string;
  request_url: string;
  status: AttemptStatus;
  failure: FailureDetail | null;
  http_status: number;
  robots: Record<string, Record<string, unknown>>;
  results: SearchResultRow[];
  actual_market: null;
  actual_language: null;
  coverage: string;
  search_page: number;
  source_snapshot?: string;
  response_sha256?: string;
}

/** Fetch one public search endpoint and parse its result rows. */
export class NativeSearch {
  readonly provider: NativeProvider;
  private readonly base: string;
  private readonly budget: RequestBudget;
  private readonly timeoutMs: number;
  private readonly snapshotDir?: string;
  private readonly robots: DiscoveryRobotsCache;

  constructor(
    provider: NativeProvider,
    budget: RequestBudget,
    timeoutMs = 12_000,
    snapshotDir?: string,
  ) {
    this.provider = provider;
    this.budget = budget;
    this.timeoutMs = timeoutMs;
    this.snapshotDir = snapshotDir;
    this.base = PROVIDER_BASE[provider];
    this.robots = new DiscoveryRobotsCache(budget, timeoutMs);
  }

  async call(spec: SearchQuery): Promise<NativeSearchResult> {
    const params = new URLSearchParams({ q: spec.query });
    if (this.provider === "bing-rss") params.set("format", "rss");
    const url = `${this.base}?${params.toString()}`;

    const robotsDecision = await this.robots.decision(url);
    if (!robotsDecision.allowed) {
      const detail = failureDetail(robotsDecision.reason);
      return {
        provider: this.provider,
        captured_at: new Date().toISOString(),
        request_url: url,
        status: detail ? detail.code : "robots_unavailable",
        failure: detail,
        http_status: 0,
        robots: this.robots.evidence,
        results: [],
        actual_market: null,
        actual_language: null,
        coverage:
          "Search request withheld: robots policy for the provider origin was not established.",
        search_page: 1,
      };
    }

    const r = await budgetedFetch(url, this.budget, this.timeoutMs);
    const detail = failureDetail(r.error, r.status, r.headers, r.body);

    const result: NativeSearchResult = {
      provider: this.provider,
      captured_at: r.fetchedAt,
      request_url: url,
      status: detail ? detail.code : "response_received",
      failure: detail,
      http_status: r.status,
      robots: this.robots.evidence,
      results: [],
      actual_market: null,
      actual_language: null,
      coverage: "One public result response; localization and pagination not verified.",
      search_page: 1,
    };

    if (r.body && this.snapshotDir) {
      const name = `${createHash("sha256").update(url + r.fetchedAt).digest("hex")}.html`;
      await fs.mkdir(this.snapshotDir, { recursive: true });
      await fs.writeFile(path.join(this.snapshotDir, name), r.body);
      result.source_snapshot = `snapshots/${name}`;
      result.response_sha256 = createHash("sha256").update(r.body).digest("hex");
    }

    if (!detail) {
      const [status, rows, evidence] = parseSearch(r.body, this.provider);
      result.status = status;
      result.results = rows;
      if (status !== "results" && status !== "empty_results" && status !== "no_relevant_results") {
        result.failure = { code: status, evidence, http_status: null, cause: "unknown" };
      }
    }
    return result;
  }
}
