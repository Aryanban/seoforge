/**
 * robots.txt compliance — parsing, allow/deny rules, crawl-delay.
 */
import robotsParser from "robots-parser";
import { fetchPage } from "./fetcher.js";

const USER_AGENT = "SEOForgeBot";

export interface RobotsCheckResult {
  accessible: boolean;
  rules: any | null;
  sitemaps: string[];
  crawlDelay?: number;
  raw?: string;
}

export async function fetchRobots(
  robotsUrl: string,
  timeoutMs = 8000
): Promise<RobotsCheckResult> {
  const res = await fetchPage(robotsUrl, { timeoutMs, method: "GET" });
  if (res.status !== 200 || !res.html) {
    return { accessible: res.status === 200, rules: null, sitemaps: [] };
  }

  const rules = (robotsParser as any)(robotsUrl, res.html);
  const sitemaps = (rules as any).getSitemaps ? (rules as any).getSitemaps() : [];
  const crawlDelay = rules.getCrawlDelay(USER_AGENT) ?? undefined;

  return {
    accessible: true,
    rules,
    sitemaps,
    crawlDelay,
    raw: res.html,
  };
}

export function isAllowed(robots: RobotsCheckResult | null, url: string): boolean {
  if (!robots?.rules) return true;
  const allowed = robots.rules.isAllowed(url, USER_AGENT);
  return allowed !== false;
}

export function isDisallowed(robots: RobotsCheckResult | null, url: string): boolean {
  if (!robots?.rules) return false;
  return robots.rules.isDisallowed(url, USER_AGENT) === true;
}
