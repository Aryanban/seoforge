/**
 * robots.txt compliance — parsing, allow/deny rules, crawl-delay.
 *
 * Matching is robots-parser (RFC 9309 longest match, wildcards, `$`). Two
 * things it does not do are handled here, following Google's reference parser
 * (github.com/google/robotstxt) and RFC 9309 §2.3.1:
 *  - Lenient lines: Google accepts common key typos ("disalow") and a missing
 *    colon ("user-agent FooBot"). normalizeRobotsTxt rewrites those first.
 *  - Status handling: 4xx = no rules (allow all); 5xx, 429 or unreachable =
 *    disallow all. Only the first 500 KiB are parsed.
 */
import robotsParser from "robots-parser";
import { fetchPage } from "./fetcher.js";

const USER_AGENT = "SEOForgeBot";
/** Google's parsing limit (RFC 9309 requires at least 500 KiB). */
export const ROBOTS_MAX_BYTES = 500 * 1024;

export interface RobotsCheckResult {
  accessible: boolean;
  /** 5xx, 429 or network error: crawlers must treat the whole site as disallowed. */
  unreachable?: boolean;
  status?: number;
  rules: any | null;
  sitemaps: string[];
  crawlDelay?: number;
  raw?: string;
}

// Key spellings Google's parser accepts (robots.cc: Validate*Key).
const KEY_ALIASES: Record<string, string> = {
  "user-agent": "user-agent",
  useragent: "user-agent",
  "user agent": "user-agent",
  allow: "allow",
  disallow: "disallow",
  dissallow: "disallow",
  dissalow: "disallow",
  disalow: "disallow",
  diasllow: "disallow",
  disallaw: "disallow",
  sitemap: "sitemap",
  "site-map": "sitemap",
  "crawl-delay": "crawl-delay",
};
// Longest first so "user agent" wins over a shorter prefix.
const ALIAS_KEYS = Object.keys(KEY_ALIASES).sort((a, b) => b.length - a.length);

/** Rewrite Google-accepted typos and missing colons into canonical lines; cap at 500 KiB. */
export function normalizeRobotsTxt(text: string): string {
  const capped = Buffer.byteLength(text) > ROBOTS_MAX_BYTES ? Buffer.from(text).subarray(0, ROBOTS_MAX_BYTES).toString() : text;
  return capped
    .split(/\r\n|\r|\n/)
    .map((line) => {
      const t = line.trim();
      const colon = t.indexOf(":");
      const key = colon > 0 ? KEY_ALIASES[t.slice(0, colon).trim().toLowerCase()] : undefined;
      if (key) return `${key}: ${t.slice(colon + 1).trim()}`;
      // Missing colon: "<key> <value>" (also covers "sitemap https://…", whose only colon is in the value)
      const lower = t.toLowerCase();
      const alias = ALIAS_KEYS.find((k) => lower.startsWith(k) && /^\s+\S/.test(t.slice(k.length)));
      return alias ? `${KEY_ALIASES[alias]}: ${t.slice(alias.length).trim()}` : line;
    })
    .join("\n");
}

export function parseRobots(robotsUrl: string, text: string): any {
  return (robotsParser as any)(robotsUrl, normalizeRobotsTxt(text));
}

export async function fetchRobots(robotsUrl: string, timeoutMs = 8000): Promise<RobotsCheckResult> {
  const res = await fetchPage(robotsUrl, { timeoutMs, method: "GET" });
  if (res.status === 0 || res.status === 429 || res.status >= 500) {
    return { accessible: false, unreachable: true, status: res.status, rules: null, sitemaps: [] };
  }
  if (res.status !== 200 || !res.html) {
    return { accessible: res.status === 200, status: res.status, rules: null, sitemaps: [] };
  }

  const rules = parseRobots(robotsUrl, res.html);
  const sitemaps = rules.getSitemaps ? rules.getSitemaps() : [];
  const crawlDelay = rules.getCrawlDelay(USER_AGENT) ?? undefined;

  return { accessible: true, status: res.status, rules, sitemaps, crawlDelay, raw: res.html };
}

export function isAllowed(robots: RobotsCheckResult | null, url: string): boolean {
  return !isDisallowed(robots, url);
}

export function isDisallowed(robots: RobotsCheckResult | null, url: string): boolean {
  if (robots?.unreachable) return true;
  if (!robots?.rules) return false;
  return robots.rules.isDisallowed(url, USER_AGENT) === true;
}
