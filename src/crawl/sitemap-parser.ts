/**
 * XML sitemap parsing — supports sitemap indexes (nested), lastmod, changefreq, priority.
 */
import { XMLParser } from "fast-xml-parser";
import { SitemapEntry } from "../types.js";
import { fetchPage } from "./fetcher.js";

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

  async function parseOne(url: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    if (entries.length >= limit) return;

    const res = await fetchPage(url, { timeoutMs, method: "GET" });
    if (res.status !== 200 || !res.html) {
      if (depth === 0) return; // accessibility reported by caller
      errors.push(`Sitemap ${url} returned HTTP ${res.status}`);
      return;
    }

    let parsed: any;
    try {
      parsed = xmlParser.parse(res.html);
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
        entries.push({
          url: loc,
          lastmod: item.lastmod,
          changefreq: item.changefreq,
          priority: typeof item.priority === "string" ? parseFloat(item.priority) : item.priority,
          source: url,
        });
      }
    }
  }

  const res = await fetchPage(sitemapUrl, { timeoutMs, method: "GET" });
  const accessible = res.status === 200 && !!res.html;
  if (accessible) {
    await parseOne(sitemapUrl, 0);
  }

  return {
    accessible,
    urlCount: entries.length,
    entries,
    sitemapIndexUrls,
    hasSitemapIndex: sitemapIndexUrls.length > 0,
    errors,
  };
}
