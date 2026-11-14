/**
 * XML sitemap parsing — supports sitemap indexes (nested), lastmod, changefreq, priority.
 */
import { XMLParser } from "fast-xml-parser";
import { gunzipSync } from "node:zlib";
import { SitemapEntry } from "../types.js";
import { fetchPage, FetchResult } from "./fetcher.js";

/** sitemaps.org protocol limits per sitemap file (uncompressed). */
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;
export const SITEMAP_MAX_URLS = 50_000;
// W3C Datetime (www.w3.org/TR/NOTE-datetime): YYYY, YYYY-MM, YYYY-MM-DD, or a date with hh:mm[:ss[.s]] and a time zone.
const W3C_DATETIME = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d))?)?)?$/;
const FUTURE_SKEW_MS = 24 * 3600 * 1000;

/** Problem with a <lastmod> value, or null when it is valid. */
export function lastmodProblem(value: unknown, now = Date.now()): "invalid" | "future" | null {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value).trim();
  if (!W3C_DATETIME.test(v) || Number.isNaN(Date.parse(v))) return "invalid";
  return Date.parse(v) > now + FUTURE_SKEW_MS ? "future" : null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export interface SitemapParseResult {
  accessible: boolean;
  urlCount: number;
  entries: SitemapEntry[];
  sitemapIndexUrls: string[];
  hasSitemapIndex: boolean;
  errors: string[];
}

export async function parseSitemap(
  sitemapUrl: string,
  options: { followIndex?: boolean; maxDepth?: number; limit?: number; timeoutMs?: number } = {}
): Promise<SitemapParseResult> {
  const { followIndex = true, maxDepth = 3, limit = 100000, timeoutMs = 12000 } = options;
  const entries: SitemapEntry[] = [];
  const sitemapIndexUrls: string[] = [];
  const errors: string[] = [];
  const visited = new Set<string>([sitemapUrl]);

  async function parseOne(url: string, depth: number, first?: FetchResult): Promise<void> {
    if (depth > maxDepth) return;
    if (entries.length >= limit) return;

    const res = first ?? (await fetchPage(url, { timeoutMs, method: "GET", bytes: SITEMAP_MAX_BYTES }));
    if (res.status !== 200) {
      if (depth > 0) errors.push(`Sitemap ${url} returned HTTP ${res.status}`);
      return;
    }
    if (!res.bytes) {
      errors.push(`Sitemap ${url} is larger than 50 MB (the sitemaps.org limit)`);
      return;
    }
    let xmlText: string;
    // Gzipped sitemaps arrive as raw bytes (magic 0x1f 0x8b); Content-Encoding gzip is already decoded by fetch.
    if (res.bytes[0] === 0x1f && res.bytes[1] === 0x8b) {
      try {
        xmlText = gunzipSync(res.bytes, { maxOutputLength: SITEMAP_MAX_BYTES }).toString("utf8");
      } catch (err: any) {
        errors.push(
          err?.code === "ERR_BUFFER_TOO_LARGE"
            ? `Sitemap ${url} is larger than 50 MB uncompressed (the sitemaps.org limit)`
            : `Sitemap ${url} could not be decompressed: ${err.message}`
        );
        return;
      }
    } else {
      xmlText = res.html;
    }

    let parsed: any;
    try {
      parsed = xmlParser.parse(xmlText);
    } catch (err: any) {
      errors.push(`Sitemap ${url} contains invalid XML: ${err.message}`);
      return;
    }

    // Sitemap index → recurse
    if (parsed?.sitemapindex?.sitemap) {
      const idx = Array.isArray(parsed.sitemapindex.sitemap)
        ? parsed.sitemapindex.sitemap
        : [parsed.sitemapindex.sitemap];
      for (const item of idx) {
        const loc = typeof item === "string" ? item : item?.loc;
        if (!loc) continue;
        if (!visited.has(loc) && sitemapIndexUrls.length < 500) {
          visited.add(loc);
          sitemapIndexUrls.push(loc);
          if (followIndex) await parseOne(loc, depth + 1);
        }
      }
      return;
    }

    // Regular URL set
    if (parsed?.urlset?.url) {
      const list = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];
      if (list.length > SITEMAP_MAX_URLS) {
        errors.push(`Sitemap ${url} lists ${list.length} URLs; the sitemaps.org limit is ${SITEMAP_MAX_URLS} per file`);
      }
      const badLastmod = { invalid: [] as string[], future: [] as string[] };
      for (const item of list) {
        if (entries.length >= limit) break;
        if (typeof item === "string") {
          entries.push({ url: item, source: url });
          continue;
        }
        const loc = item?.loc;
        if (!loc) {
          errors.push(`Sitemap ${url} contains a <url> entry without <loc>`);
          continue;
        }
        const problem = lastmodProblem(item.lastmod);
        if (problem) badLastmod[problem].push(String(item.lastmod));
        entries.push({
          url: loc,
          lastmod: item.lastmod,
          changefreq: item.changefreq,
          priority: typeof item.priority === "string" ? parseFloat(item.priority) : item.priority,
          source: url,
        });
      }
      if (badLastmod.invalid.length) {
        errors.push(`Sitemap ${url} has ${badLastmod.invalid.length} <lastmod> values that are not W3C Datetime (e.g. "${badLastmod.invalid[0]}"); Google ignores them`);
      }
      if (badLastmod.future.length) {
        errors.push(`Sitemap ${url} has ${badLastmod.future.length} <lastmod> dates in the future (e.g. "${badLastmod.future[0]}"); Google trusts lastmod only when it is accurate`);
      }
    }
  }

  const res = await fetchPage(sitemapUrl, { timeoutMs, method: "GET", bytes: SITEMAP_MAX_BYTES });
  const accessible = res.status === 200 && res.bytes !== undefined && res.bytes.length > 0;
  if (res.status === 200) await parseOne(sitemapUrl, 0, res);

  return {
    accessible,
    urlCount: entries.length,
    entries,
    sitemapIndexUrls,
    hasSitemapIndex: sitemapIndexUrls.length > 0,
    errors,
  };
}
