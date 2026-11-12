/**
 * keyword-volume.ts — monthly search-volume estimates without a paid API.
 *
 * Method (the parts of the Ahrefs-style approach that can be reproduced from
 * public data):
 *   1. Ground truth: Search Console impressions for queries the site ranks for
 *      near the top. At positions 1-10 nearly every search produces an
 *      impression, so impressions / visibility(position) ≈ searches.
 *   2. Relative demand: Google Trends interest, compared in batches of up to 5
 *      terms that share a pivot. Terms too small to register against the top
 *      pivot are re-compared against a smaller pivot (a "ladder"), and the
 *      ratios are chained back to the top pivot.
 *   3. Calibration: anchors (GSC queries ranking top 5) also go through the
 *      ladder; scale = median(anchor searches / anchor relative interest).
 *      Every other term's volume = relative interest × scale.
 * Results are estimates with a low/high band, not Keyword Planner figures.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface GscAnchor {
  query: string;
  impressions: number;
  position: number;
  /** Number of days the impressions cover. */
  days: number;
}

export interface VolumeEstimate {
  keyword: string;
  monthly: number | null;
  low: number | null;
  high: number | null;
  /** Interest relative to the top pivot (pivot = 1). */
  relative: number | null;
  method: "gsc" | "trends" | "gsc-floor" | "below-trends-floor" | "trends-error" | "uncalibrated";
  confidence: "high" | "medium" | "low";
}

/** Returns mean interest per keyword (same order), for up to 5 keywords. */
export type TrendsFetcher = (keywords: string[]) => Promise<number[]>;

/** Share of searches that produce an impression at a given average position. */
export function visibilityAt(position: number): number {
  if (position <= 3) return 1;
  if (position <= 5) return 0.95;
  if (position <= 10) return 0.85;
  if (position <= 20) return 0.25;
  return 0.05;
}

/** Monthly searches implied by a GSC row; null when the position is too low to trust. */
export function monthlyFromGsc(a: GscAnchor): number | null {
  if (a.position > 10 || a.days <= 0) return null;
  return (a.impressions / visibilityAt(a.position)) * (30 / a.days);
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Smallest mean interest (0-100 scale) treated as a measurable signal. */
const MIN_SIGNAL = 0.5;
/** Below this mean, Trends' integer rounding error exceeds ~10%, so try a smaller pivot first. */
const MIN_PRECISE = 5;

/** Keywords Trends can compare: no search operators, quotes or very long strings. */
export function isTrendsQueryable(k: string): boolean {
  return k.length > 0 && k.length <= 80 && !/["':]|(^|\s)-\S|\bsite:/.test(k);
}

/** One rejected keyword must not sink its batch: retry singly; a failed keyword reads NaN, never 0. */
async function fetchSafely(fetchTrends: TrendsFetcher, pivot: string, batch: string[]): Promise<number[]> {
  try {
    return await fetchTrends([pivot, ...batch]);
  } catch (err) {
    if (batch.length === 1) {
      if (String(err).includes("rate limit")) throw err;
      return [100, NaN];
    }
    const out = [0];
    for (const k of batch) {
      const [p, v] = await fetchSafely(fetchTrends, pivot, [k]);
      // Re-scale each single comparison to a common pivot value of 100.
      out[0] = 100;
      out.push(Number.isNaN(v) ? NaN : p > 0 ? (v / p) * 100 : 0);
    }
    return out;
  }
}

/**
 * Relative interest of every keyword against the first pivot, using a ladder of
 * progressively smaller pivots for terms that don't register.
 */
export async function trendsLadder(
  keywords: string[],
  pivot: string,
  fetchTrends: TrendsFetcher,
  maxLevels = 4,
  /** Filled with keywords Trends rejected (reported as errors, not as low volume). */
  failed: Set<string> = new Set(),
  /** Filled with the relative interest of the smallest pivot reached. */
  ladderInfo: { lastPivotRel: number; rateLimited?: boolean } = { lastPivotRel: 1 },
): Promise<Map<string, number>> {
  const rel = new Map<string, number>([[pivot, 1]]);
  // Coarse readings (signal present but below MIN_PRECISE) are kept as a fallback
  // and re-measured against a smaller pivot.
  const coarse = new Map<string, number>();
  let pending = [...new Set(keywords.filter((k) => k !== pivot))];
  let currentPivot = pivot;
  for (let level = 0; level < maxLevels && pending.length; level++) {
    const pivotRel = rel.get(currentPivot)!;
    const unresolved: string[] = [];
    for (let i = 0; i < pending.length; i += 4) {
      const batch = pending.slice(i, i + 4);
      let means: number[];
      try {
        means = await fetchSafely(fetchTrends, currentPivot, batch);
      } catch (err) {
        if (!String(err).includes("rate limit")) throw err;
        // Rate-limited: keep everything measured so far; the rest re-run later from cache.
        for (const k of pending.slice(i)) failed.add(k);
        for (const [k, r] of coarse) if (!rel.has(k)) rel.set(k, r);
        ladderInfo.rateLimited = true;
        return rel;
      }
      const pMean = means[0];
      batch.forEach((k, j) => {
        const v = means[j + 1];
        if (Number.isNaN(v)) { failed.add(k); return; }
        if (pMean > 0 && v >= MIN_PRECISE) { rel.set(k, (v / pMean) * pivotRel); coarse.delete(k); return; }
        if (pMean > 0 && v >= MIN_SIGNAL) coarse.set(k, (v / pMean) * pivotRel);
        unresolved.push(k);
      });
    }
    pending = unresolved;
    if (!pending.length) break;
    // Next pivot: the smallest resolved term that is still clearly measurable
    // (≥ 3% of the current pivot) — small enough for weak terms to register.
    const candidates = [...rel.entries()]
      .filter(([k, r]) => k !== currentPivot && r < pivotRel && r >= pivotRel * 0.03)
      .sort((a, b) => a[1] - b[1]);
    if (!candidates.length) break;
    currentPivot = candidates[0][0];
    ladderInfo.lastPivotRel = candidates[0][1];
  }
  for (const [k, r] of coarse) if (!rel.has(k)) rel.set(k, r);
  return rel;
}

export async function estimateVolumes(opts: {
  keywords: string[];
  anchors: GscAnchor[];
  pivot: string;
  fetchTrends: TrendsFetcher;
  maxAnchors?: number;
}): Promise<{ estimates: VolumeEstimate[]; scale: number | null; anchorsUsed: string[]; rateLimited: boolean }> {
  const anchorMonthly = new Map<string, number>();
  // The strongest top-5 GSC queries, capped so calibration stays a few dozen Trends calls.
  const ranked = opts.anchors
    .filter((a) => a.position <= 5 && isTrendsQueryable(a.query))
    .map((a) => [a.query, monthlyFromGsc(a)] as const)
    .filter((x): x is readonly [string, number] => x[1] != null && x[1] >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.maxAnchors ?? 15);
  for (const [q, m] of ranked) anchorMonthly.set(q, m);
  const failed = new Set<string>();
  const ladderInfo: { lastPivotRel: number; rateLimited?: boolean } = { lastPivotRel: 1 };
  const rel = await trendsLadder([...opts.keywords.filter(isTrendsQueryable), ...anchorMonthly.keys()], opts.pivot, opts.fetchTrends, 4, failed, ladderInfo);

  const ratios: number[] = [];
  const anchorsUsed: string[] = [];
  for (const [q, m] of anchorMonthly) {
    const r = rel.get(q);
    if (r) { ratios.push(m / r); anchorsUsed.push(q); }
  }
  const scale = ratios.length ? median(ratios) : null;
  const spread = ratios.length >= 2 ? Math.max(...ratios) / Math.min(...ratios) : 3;
  const band = Math.min(Math.max(Math.sqrt(spread), 1.5), 4);

  const gscByQuery = new Map(opts.anchors.map((a) => [a.query, a]));
  const estimates = opts.keywords.map((keyword): VolumeEstimate => {
    const g = gscByQuery.get(keyword);
    const fromGsc = g && g.position <= 5 ? monthlyFromGsc(g) : null;
    if (fromGsc != null) {
      return { keyword, monthly: Math.round(fromGsc), low: Math.round(fromGsc * 0.8), high: Math.round(fromGsc * 1.25), relative: rel.get(keyword) ?? null, method: "gsc", confidence: "high" };
    }
    // Impressions prove at least that many searches, whatever the position.
    const gscFloor = g && g.days > 0 ? Math.round((g.impressions * 30) / g.days) : 0;
    const r = rel.get(keyword);
    if (r == null) {
      const method = failed.has(keyword) ? "trends-error" : gscFloor > 0 ? "gsc-floor" : "below-trends-floor";
      // Unresolved at the smallest pivot means under MIN_SIGNAL% of that pivot.
      const ceiling = scale && method === "below-trends-floor" ? Math.max(1, Math.round(ladderInfo.lastPivotRel * scale * (MIN_SIGNAL / 100))) : null;
      return { keyword, monthly: null, low: gscFloor, high: ceiling, relative: null, method, confidence: "low" };
    }
    if (scale == null) {
      return { keyword, monthly: null, low: gscFloor || null, high: null, relative: r, method: "uncalibrated", confidence: "low" };
    }
    const m = Math.max(r * scale, gscFloor);
    return { keyword, monthly: Math.round(m), low: Math.max(Math.round(m / band), gscFloor), high: Math.max(Math.round(m * band), Math.round(m)), relative: r, method: "trends", confidence: anchorsUsed.length >= 3 && band < 2.5 ? "medium" : "low" };
  });
  return { estimates, scale, anchorsUsed, rateLimited: !!ladderInfo.rateLimited };
}

/* ---------------- Live Google Trends + Autocomplete clients ---------------- */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripXssi = (t: string) => JSON.parse(t.slice(t.indexOf("{")));

/** Google Trends client (public web endpoints, rate-limited and retried). */
export function createTrendsFetcher(opts: { geo?: string; time?: string; delayMs?: number; cachePath?: string; cacheDays?: number } = {}): TrendsFetcher {
  const geo = opts.geo ?? "IN";
  const time = opts.time ?? "today 12-m";
  const delayMs = opts.delayMs ?? 1500;
  let cookie = "";
  const get = async (url: string): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!cookie) {
        const home = await fetch(`https://trends.google.com/trends/?geo=${geo}`, { headers: { "User-Agent": UA } });
        cookie = (home.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
      }
      await sleep(delayMs);
      const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie } });
      if (res.ok) return res.text();
      if (res.status === 429) { cookie = ""; await sleep(delayMs * 2 ** (attempt + 2)); continue; }
      throw new Error(`Google Trends HTTP ${res.status}`);
    }
    throw new Error("Google Trends rate limit: retries exhausted");
  };
  const cachePath = opts.cachePath ?? path.join(os.homedir(), ".seoforge", "trends-cache.json");
  const maxAge = (opts.cacheDays ?? 7) * 86_400_000;
  let cache: Record<string, { at: number; means: number[] }> = {};
  try { cache = JSON.parse(readFileSync(cachePath, "utf-8")); } catch { /* first run */ }
  const live = fetchLive;
  return async (keywords) => {
    const key = `${geo}|${time}|${keywords.join("|")}`;
    const hit = cache[key];
    if (hit && Date.now() - hit.at < maxAge) return hit.means;
    const means = await live(keywords);
    cache[key] = { at: Date.now(), means };
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache));
    return means;
  };
  async function fetchLive(keywords: string[]): Promise<number[]> {
    const req = { comparisonItem: keywords.map((keyword) => ({ keyword, geo, time })), category: 0, property: "" };
    const explore = stripXssi(await get(`https://trends.google.com/trends/api/explore?hl=en-US&tz=-330&req=${encodeURIComponent(JSON.stringify(req))}`));
    const w = explore.widgets?.find((x: { id: string }) => x.id === "TIMESERIES");
    if (!w) throw new Error("Google Trends: no timeseries widget");
    const data = stripXssi(await get(`https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-330&req=${encodeURIComponent(JSON.stringify(w.request))}&token=${w.token}`));
    const rows: { value: number[] }[] = data.default.timelineData ?? [];
    if (!rows.length) return keywords.map(() => 0);
    return keywords.map((_, i) => rows.reduce((s, r) => s + (r.value[i] ?? 0), 0) / rows.length);
  }
}

/** Google Autocomplete suggestions — real queries people type, used to discover keywords. */
export async function autocomplete(seed: string, opts: { gl?: string; hl?: string; expand?: boolean } = {}): Promise<string[]> {
  const gl = opts.gl ?? "in"; const hl = opts.hl ?? "en";
  const one = async (q: string): Promise<string[]> => {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": UA } });
    if (!res.ok) return [];
    const j = JSON.parse(await res.text());
    return Array.isArray(j?.[1]) ? j[1] : [];
  };
  const out = new Set(await one(seed));
  if (opts.expand) {
    for (const c of "abcdefghijklmnopqrstuvwxyz") {
      for (const s of await one(`${seed} ${c}`)) out.add(s);
      await sleep(200);
    }
  }
  return [...out];
}
