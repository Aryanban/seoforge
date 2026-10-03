/**
 * Search-result parsers.
 *
 * Ports BeyondSEO `discovery.parse_search`. The contract is strict on
 * purpose: a parser must *recognize* the structure it was given. An
 * arbitrary 200 response with no recognizable result markup is
 * `parse_failed`, never silently-zero-results — because "we could not read
 * it" and "there genuinely are none" are different facts.
 */

import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { normalizeCandidateUrl } from "./url.js";
import type { AttemptStatus, SearchResultRow } from "./types.js";

export type ParseOutcome = [
  status: AttemptStatus,
  rows: SearchResultRow[],
  evidence: string,
];

const HTML_SELECTORS: Record<string, string> = {
  "duckduckgo-html": "a.result__a",
  bing: "li.b_algo h2 a",
  google: "a:has(h3)",
};

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  textNodeName: "#text",
});

/** Recognize supported structures; an arbitrary 200 page is not zero results. */
export function parseSearch(body: string | Buffer, provider: string): ParseOutcome {
  const text = Buffer.isBuffer(body) ? body.toString("utf-8") : body;

  if (provider === "bing-rss") {
    return parseRss(text);
  }

  const $ = cheerio.load(text);
  if ($("#challenge-form, form[action*='anomaly'], #captcha-form").length > 0) {
    return ["provider_challenge", [], "Search response contains a challenge form."];
  }

  const selector = HTML_SELECTORS[provider.toLowerCase()];
  if (!selector) {
    return ["parse_failed", [], `Unsupported saved search format: ${provider}`];
  }

  const rows: Array<{ url: string; title: string; snippet: string }> = [];
  $(selector).each((_, el) => {
    const $a = $(el);
    const raw = $a.attr("href") ?? "";
    const resolved = resolveResultUrl(raw, provider);
    if (!resolved) return;
    const container = $a.closest(".result");
    const snippet = container.length ? container.find(".result__snippet").text().trim() : "";
    rows.push({
      url: resolved,
      title: $a.text().replace(/\s+/g, " ").trim(),
      snippet,
    });
  });

  if (rows.length === 0) {
    const empty = $(".no-results, .no-results__message, #b_results .b_no").first();
    if (empty.length) {
      return ["empty_results", [], empty.text().replace(/\s+/g, " ").trim().slice(0, 500)];
    }
    return [
      "parse_failed",
      [],
      "No supported result structure or explicit empty-results marker.",
    ];
  }

  const valid: SearchResultRow[] = [];
  rows.forEach((row, i) => {
    const url = normalizeCandidateUrl(row.url);
    if (url) valid.push({ ...row, url, result_order: i + 1 });
  });
  if (valid.length === 0) {
    return ["parse_failed", [], "Result structures found, but no valid destination URLs."];
  }
  return ["results", valid, ""];
}

/**
 * Unwrap search-engine redirect wrappers (Google /url?q=, DuckDuckGo uddg)
 * to the destination URL; resolve relative hrefs against the search host.
 */
function resolveResultUrl(raw: string, provider: string): string | null {
  try {
    const parsed = new URL(raw, "https://www.google.com/");
    if (provider === "google" && parsed.pathname === "/url") {
      return parsed.searchParams.get("q") ?? parsed.searchParams.get("url") ?? raw;
    }
    if (provider === "duckduckgo-html" && parsed.searchParams.has("uddg")) {
      return parsed.searchParams.get("uddg") ?? raw;
    }
    return new URL(raw, "https://html.duckduckgo.com/").href;
  } catch {
    return null;
  }
}

/** Parse a Bing RSS search response. */
function parseRss(text: string): ParseOutcome {
  const upper = text.toUpperCase();
  if (upper.includes("<!DOCTYPE") || upper.includes("<!ENTITY")) {
    return ["parse_failed", [], "Unsupported XML declarations"];
  }
  let doc: unknown;
  try {
    doc = xmlParser.parse(text);
  } catch (err) {
    return ["parse_failed", [], (err as Error).message];
  }
  const channel = (doc as { rss?: { channel?: Record<string, unknown> } })?.rss?.channel;
  if (!channel) return ["parse_failed", [], "Expected RSS channel"];
  const items = channel.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  if (list.length === 0) {
    return ["empty_results", [], "Recognized RSS channel contains no items."];
  }
  const rows: SearchResultRow[] = [];
  list.forEach((item, i) => {
    const obj = item as Record<string, unknown>;
    rows.push({
      url: typeof obj.link === "string" ? obj.link : "",
      title: typeof obj.title === "string" ? obj.title : "",
      snippet: typeof obj.description === "string" ? obj.description : "",
      result_order: i + 1,
    });
  });
  const valid = rows.filter((row) => normalizeCandidateUrl(row.url));
  if (valid.length === 0) {
    return ["parse_failed", [], "Result structures found, but no valid destination URLs."];
  }
  return ["results", valid, ""];
}
