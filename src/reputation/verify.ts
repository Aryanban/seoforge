/**
 * Verify candidate backlink/mention source pages.
 *
 * Ported from BeyondSEO `src/beyondseo/backlinks.py` (`verify_source`,
 * `check_sources`, `target_links`, `mention_evidence`). A supplied or
 * search-result URL is only a *candidate*: this module fetches the page and
 * looks for an actual link to the target host, and the brand in captured text.
 *
 * Uses SEOForge's own fetcher (+ optional Playwright render for script-heavy
 * pages) and cheerio, so it adds no new dependencies.
 */

import * as cheerio from "cheerio";
import { fetchPage } from "../crawl/fetcher.js";
import { isRenderAvailable, renderUrl } from "../crawl/renderer.js";
import { extractVisibleText } from "../crawl/link-extractor.js";
import { normalizeUrl } from "../crawl/queue.js";
import type {
  BrandMention,
  CheckSourcesResult,
  DiscoveryMeta,
  Representation,
  SourceRow,
  TargetLink,
  VerificationResult,
  VerifyOptions,
} from "./types.js";

/** Strip the leading www. from a hostname. */
export function host(url: string): string {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = "";
  }
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Pool common publishing-platform host families so one publisher cannot be
 * double-counted. Conservative, not a complete ownership database.
 */
export function publisherKey(url: string): string {
  const name = host(url);
  for (const suffix of ["medium.com", "dev.to", "forem.com", "substack.com", "blogspot.com"]) {
    if (name === suffix || name.endsWith(`.${suffix}`)) return suffix;
  }
  return name;
}

/** Resolve a possibly-relative href against its page and keep http(s) links. */
function absoluteHref(href: string, pageUrl: string): string | null {
  try {
    const resolved = new URL(href, pageUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.href;
  } catch {
    return null;
  }
}

/** All links on the page that point at the target host (www-insensitive). */
export function targetLinks(html: string, pageUrl: string, targetHost: string): TargetLink[] {
  const $ = cheerio.load(html);
  const out: TargetLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href") ?? "";
    const absolute = absoluteHref(raw, pageUrl);
    if (!absolute) return;
    if (host(absolute) !== targetHost) return;
    const key = `${absolute}|${$(el).text().trim()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const rel = ($(el).attr("rel") ?? "").split(/\s+/).filter(Boolean);
    out.push({ url: absolute, anchor: $(el).text().trim(), rel });
  });
  return out;
}

/**
 * Find brand names in captured text. Word boundaries prevent substring
 * matches; case-insensitive. Ports `mention_evidence`.
 */
export function mentionEvidence(text: string, names: string[]): BrandMention[] {
  const matches: BrandMention[] = [];
  const seen = new Set<string>();
  for (const name of [...new Set(names.map((n) => n.trim()).filter((n) => n))]) {
    if (seen.has(name)) continue;
    seen.add(name);
    const pattern = new RegExp(`(?<!\\w)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "i");
    const match = pattern.exec(text);
    if (match) {
      matches.push({
        name,
        excerpt: text.slice(Math.max(0, match.index - 90), match.index + name.length + 130),
      });
    }
  }
  return matches;
}

function isHtmlContentType(contentType: string | undefined): boolean {
  return !contentType || /html|xhtml|xml/i.test(contentType);
}

/**
 * Verify a single source page: fetch it, capture text and links, and classify
 * what was observed. Ports `verify_source` (without the redirect-host
 * expansion, which SEOForge's fetcher already follows).
 */
export async function verifySource(
  sourceUrl: string,
  targetHost: string,
  options: VerifyOptions = {},
): Promise<VerificationResult> {
  const { brand = "", aliases = [], render = false, timeoutMs } = options;
  const names = [brand, ...aliases];

  let representation: Representation = "raw_html";
  const fetched = await fetchPage(sourceUrl, { timeoutMs });
  let html = fetched.html;
  let finalUrl = fetched.finalUrl;
  let status = fetched.status;
  const errorMessage = fetched.errorMessage ?? "";

  const usableHttp = fetched.ok && status >= 200 && status < 300 && html.length > 0;

  // Script-heavy pages may add their links after initial HTML. When nothing was
  // found and a render pass is available, re-capture the DOM (like BeyondSEO's
  // auto browser fallback).
  let links: TargetLink[] = [];
  let text = "";
  let title = "";
  if (usableHttp && isHtmlContentType(fetched.contentType)) {
    links = targetLinks(html, finalUrl, targetHost);
    text = extractVisibleText(html);
    const $ = cheerio.load(html);
    title = $("title").first().text().trim();
    const scriptHeavy = html.includes("<script");
    if (links.length === 0 && scriptHeavy && (render || (await isRenderAvailable()))) {
      const rendered = await renderUrl(sourceUrl, { timeoutMs });
      if (!rendered.errorMessage && rendered.html.length > 0) {
        html = rendered.html;
        finalUrl = rendered.finalUrl || finalUrl;
        status = rendered.status || status;
        links = targetLinks(html, finalUrl, targetHost);
        text = extractVisibleText(html);
        const $r = cheerio.load(html);
        title = $r("title").first().text().trim();
        representation = "rendered_dom";
      }
    }
  } else if (!usableHttp) {
    representation = "not_captured";
  }

  const missingContent = usableHttp && text.trim().length === 0;
  const usable = usableHttp && !missingContent;
  const mentions = usable ? mentionEvidence(text, names) : [];

  let verification: VerificationResult["verification"];
  if (usable && links.length > 0) {
    verification = "link_observed";
  } else if (usable) {
    verification = "no_link_in_captured_content";
  } else {
    verification = "unverified_access";
  }

  return {
    source_url: sourceUrl,
    final_url: finalUrl,
    status,
    checked_at: new Date().toISOString(),
    verification,
    representation,
    coverage_limited: !usable,
    target_links: usable ? links : [],
    brand_mentions: mentions,
    mention_status: mentions.length > 0 ? "observed_in_page" : usable ? "not_observed_in_capture" : "unverified",
    error: errorMessage,
    title,
    main_excerpt: text.slice(0, 500),
    discovery: {},
    missing_content_candidate: missingContent,
  };
}

/** Parse supplied source rows. Requires a `URL` column. Ports `source_rows`. */
export function sourceRows(rows: SourceRow[]): SourceRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Source list has no URLs.");
  }
  const out = new Map<string, SourceRow>();
  for (const row of rows) {
    const url = typeof row.URL === "string" ? normalizeUrl(row.URL) : "";
    if (!url) {
      throw new Error("Source list needs a URL column with valid http(s) addresses.");
    }
    const existing = out.get(url);
    if (existing) {
      const provenance = row.discovery?.provenance ?? [];
      const merged: DiscoveryMeta[] = [
        ...(existing.discovery?.provenance ?? []),
        ...provenance,
      ].filter((p, i, arr) => arr.indexOf(p) === i);
      out.set(url, {
        ...existing,
        discovery: { ...existing.discovery, ...row.discovery, provenance: merged },
      });
      continue;
    }
    const { URL: _url, discovery: _discovery, ...rest } = row;
    const meta: DiscoveryMeta = row.discovery ?? {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined && value !== null && value !== "" && !(key in meta)) {
        meta[key] = value;
      }
    }
    out.set(url, { URL: url, discovery: meta });
  }
  return [...out.values()];
}

/**
 * Verify a list of candidate sources against a target. Bounded by `limit`
 * (default 30, max 500). Ports `check_sources`.
 */
export async function checkSources(
  rows: SourceRow[],
  target: string,
  options: VerifyOptions = {},
): Promise<CheckSourcesResult> {
  const limit = options.limit ?? 30;
  if (limit < 1 || limit > 500) {
    throw new Error("Supply a source limit from 1 to 500.");
  }
  const inputs = sourceRows(rows);
  const targetHost = host(target);
  const results: VerificationResult[] = [];
  for (const row of inputs.slice(0, limit)) {
    const verified = await verifySource(row.URL, targetHost, options);
    verified.discovery = row.discovery ?? {};
    results.push(verified);
  }
  return {
    target,
    brand: options.brand ?? "",
    checked_at: new Date().toISOString(),
    sources_supplied: inputs.length,
    sources_checked: results.length,
    sources_remaining: Math.max(0, inputs.length - results.length),
    observed_link_pages: results.filter((r) => r.verification === "link_observed").length,
    observed_mention_pages: results.filter((r) => r.brand_mentions.length > 0).length,
    unverified_pages: results.filter((r) => r.verification === "unverified_access").length,
    results,
    note: "A supplied/search-result URL is a candidate. Links and mentions are verified separately in captured content. This is a bounded sample, not a complete backlink count or proof of indexing, endorsement or ranking value.",
  };
}
