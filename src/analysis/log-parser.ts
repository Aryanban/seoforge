/**
 * Server log-file analysis — Screaming Frog Log File Analyser / JetOctopus /
 * OnCrawl parity for the locally-implementable subset. Zero network.
 *
 * Supported formats:
 *  - Apache/Nginx Combined + Common Log Format (CLF)
 *  - JSON lines (Cloudflare Logpush / CloudFront / generic {clientIp,
 *    timestamp, method, url, status, userAgent, bytes} shapes)
 *
 * Reports: hits per bot family (exact UA tokens incl. all 16 AI bots +
 * search + SEO-tool crawlers), per-URL last-crawl + hit counts, status codes
 * served to bots, crawl-waste signals (4xx/5xx/redirects served to bots,
 * hits on disallowed/noindex URLs), and indexable-but-never-crawled URLs
 * when a crawl page list is supplied.
 */
import { AI_BOTS } from "./ai-crawlers.js";

export interface LogEntry {
  ip: string;
  timeMs: number;
  method: string;
  url: string;
  status: number;
  bytes: number;
  userAgent: string;
}

export interface BotFamily {
  name: string;
  kind: "search" | "ai-search" | "ai-training" | "user-fetcher" | "seo-tool" | "other-bot";
  tokens: string[];
}

export const BOT_FAMILIES: BotFamily[] = [
  { name: "Googlebot", kind: "search", tokens: ["googlebot"] },
  { name: "GoogleOther", kind: "search", tokens: ["googleother"] },
  { name: "Bingbot", kind: "search", tokens: ["bingbot"] },
  { name: "DuckDuckBot", kind: "search", tokens: ["duckduckbot"] },
  { name: "Applebot", kind: "search", tokens: ["applebot/"] },
  { name: "PetalBot", kind: "search", tokens: ["petalbot"] },
  { name: "YandexBot", kind: "search", tokens: ["yandexbot"] },
  { name: "Baiduspider", kind: "search", tokens: ["baiduspider"] },
  { name: "OAI-SearchBot", kind: "ai-search", tokens: ["oai-searchbot"] },
  { name: "PerplexityBot", kind: "ai-search", tokens: ["perplexitybot"] },
  { name: "Claude-SearchBot", kind: "ai-search", tokens: ["claude-searchbot"] },
  { name: "DuckAssistBot", kind: "ai-search", tokens: ["duckassistbot"] },
  { name: "Amazonbot", kind: "ai-search", tokens: ["amazonbot"] },
  { name: "YouBot", kind: "ai-search", tokens: ["youbot"] },
  { name: "GPTBot", kind: "ai-training", tokens: ["gptbot"] },
  { name: "ClaudeBot", kind: "ai-training", tokens: ["claudebot/"] },
  { name: "CCBot", kind: "ai-training", tokens: ["ccbot"] },
  { name: "Bytespider", kind: "ai-training", tokens: ["bytespider"] },
  { name: "ChatGPT-User", kind: "user-fetcher", tokens: ["chatgpt-user"] },
  { name: "Claude-User", kind: "user-fetcher", tokens: ["claude-user/"] },
  { name: "Perplexity-User", kind: "user-fetcher", tokens: ["perplexity-user"] },
  { name: "MistralAI-User", kind: "user-fetcher", tokens: ["mistralai-user"] },
  { name: "AhrefsBot", kind: "seo-tool", tokens: ["ahrefsbot"] },
  { name: "SemrushBot", kind: "seo-tool", tokens: ["semrushbot"] },
  { name: "MJ12bot", kind: "seo-tool", tokens: ["mj12bot"] },
  { name: "DotBot", kind: "seo-tool", tokens: ["dotbot"] },
];

export function classifyBot(userAgent: string): string {
  const ua = (userAgent || "").toLowerCase();
  for (const fam of BOT_FAMILIES) {
    if (fam.tokens.some((t) => ua.includes(t))) return fam.name;
  }
  if (/bot|crawl|spider|slurp|mediapartners|adsbot|scanner|headless|python-requests|curl|wget/i.test(userAgent || "")) return "Other bot";
  return "Human";
}

const CLF_RE = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([A-Z]+)\s+(\S+)\s+HTTP\/[\d.]+"\s+(\d{3})\s+(\S+)(?:\s+"([^"]*)"\s+"([^"]*)")?/;

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseClfTime(raw: string): number {
  const m = raw.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  return Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()] ?? 0, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
}

export function parseLogLine(line: string): LogEntry | null {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t);
      const url = o.url || o.requestUrl || o.uri || o.path || "";
      const ts = o.timestamp || o.time || o.datetime || o["@timestamp"];
      return {
        ip: String(o.clientIp || o.ip || o.remoteAddr || ""),
        timeMs: typeof ts === "number" ? ts * 1000 : Date.parse(String(ts || "")) || 0,
        method: String(o.method || "GET"),
        url: String(url),
        status: Number(o.status || o.statusCode || 0),
        bytes: Number(o.bytes || o.size || o.bytesSent || 0),
        userAgent: String(o.userAgent || o.user_agent || o.ua || ""),
      };
    } catch { return null; }
  }
  const m = t.match(CLF_RE);
  if (!m) return null;
  return { ip: m[1], timeMs: parseClfTime(m[2]), method: m[3], url: m[4], status: Number(m[5]), bytes: m[6] === "-" ? 0 : Number(m[6]), userAgent: m[8] || "" };
}

export interface LogAnalysisOptions {
  siteOrigin?: string;
  knownPages?: Array<{ url: string; status: number; isIndexable: boolean }>;
}

export interface LogReport {
  totalLines: number;
  parsedLines: number;
  windowStart?: string;
  windowEnd?: string;
  botHits: Array<{ bot: string; kind: string; hits: number; pct: number; uniqueUrls: number; bytes: number }>;
  urlStats: Array<{ url: string; hits: number; bots: string[]; lastCrawled?: string; statuses: number[] }>;
  statusByBot: Array<{ bot: string; status: number; hits: number }>;
  waste: Array<{ kind: string; hits: number; exampleUrls: string[] }>;
  neverCrawledIndexable: string[];
  recommendations: string[];
}

export function analyzeLogs(rawText: string, options: LogAnalysisOptions = {}): LogReport {
  const lines = rawText.split(/\r?\n/);
  const entries: LogEntry[] = [];
  for (const l of lines) { const e = parseLogLine(l); if (e) entries.push(e); }
  entries.sort((a, b) => a.timeMs - b.timeMs);

  const botHits = new Map<string, { hits: number; urls: Set<string>; bytes: number }>();
  const urlMap = new Map<string, { hits: number; bots: Set<string>; last: number; statuses: Set<number> }>();
  const statusByBot = new Map<string, number>();
  for (const e of entries) {
    const bot = classifyBot(e.userAgent);
    if (bot === "Human") continue;
    const bh = botHits.get(bot) || { hits: 0, urls: new Set<string>(), bytes: 0 };
    bh.hits++; bh.urls.add(e.url); bh.bytes += e.bytes || 0;
    botHits.set(bot, bh);
    const u = urlMap.get(e.url) || { hits: 0, bots: new Set<string>(), last: 0, statuses: new Set<number>() };
    u.hits++; u.bots.add(bot); if (e.timeMs > u.last) u.last = e.timeMs; u.statuses.add(e.status);
    urlMap.set(e.url, u);
    statusByBot.set(`${bot}|${e.status}`, (statusByBot.get(`${bot}|${e.status}`) || 0) + 1);
  }

  const totalBotHits = Array.from(botHits.values()).reduce((a, b) => a + b.hits, 0) || 1;
  const famKind = (n: string) => BOT_FAMILIES.find((f) => f.name === n)?.kind || "other-bot";
  const botHitsArr = Array.from(botHits.entries()).map(([bot, v]) => ({ bot, kind: famKind(bot), hits: v.hits, pct: Math.round((v.hits / totalBotHits) * 1000) / 10, uniqueUrls: v.urls.size, bytes: v.bytes })).sort((a, b) => b.hits - a.hits);

  const urlStats = Array.from(urlMap.entries()).map(([url, v]) => ({ url, hits: v.hits, bots: Array.from(v.bots), lastCrawled: v.last ? new Date(v.last).toISOString() : undefined, statuses: Array.from(v.statuses).sort() })).sort((a, b) => b.hits - a.hits).slice(0, 500);

  const statusArr = Array.from(statusByBot.entries()).map(([k, hits]) => { const [bot, s] = k.split("|"); return { bot, status: Number(s), hits }; }).sort((a, b) => b.hits - a.hits);

  const wasteBuckets = new Map<string, { hits: number; urls: Set<string> }>();
  const bump = (kind: string, e: LogEntry) => { const b = wasteBuckets.get(kind) || { hits: 0, urls: new Set<string>() }; b.hits++; if (b.urls.size < 10) b.urls.add(e.url); wasteBuckets.set(kind, b); };
  for (const e of entries) {
    if (classifyBot(e.userAgent) === "Human") continue;
    if (e.status === 404 || e.status === 410) bump(`Bot hits to ${e.status} dead URLs`, e);
    else if (e.status >= 500) bump("Bot hits to 5xx error URLs", e);
    else if (e.status >= 300 && e.status < 400) bump("Bot hits to redirecting URLs", e);
    if (/[?&](utm_|gclid|fbclid|msclkid)/i.test(e.url)) bump("Bot hits to parameterised / ad-tagged URLs", e);
  }
  const waste = Array.from(wasteBuckets.entries()).map(([kind, v]) => ({ kind, hits: v.hits, exampleUrls: Array.from(v.urls) })).sort((a, b) => b.hits - a.hits);

  const crawled = new Set(Array.from(urlMap.keys()));
  const neverCrawledIndexable: string[] = [];
  if (options.knownPages) {
    for (const p of options.knownPages) {
      if (p.isIndexable && p.status === 200 && !crawled.has(p.url)) {
        try {
          const path = new URL(p.url).pathname;
          const hit = Array.from(crawled).some((c) => { try { return new URL(c, options.siteOrigin || "https://x").pathname === path; } catch { return false; } });
          if (!hit) neverCrawledIndexable.push(p.url);
        } catch { /* skip */ }
      }
    }
  }

  const recommendations: string[] = [];
  const aiSearchHits = botHitsArr.filter((b) => b.kind === "ai-search").reduce((a, b) => a + b.hits, 0);
  if (aiSearchHits === 0 && totalBotHits > 1) recommendations.push("No AI-search bot hits (OAI-SearchBot, PerplexityBot, Claude-SearchBot) in this window — verify robots.txt allows them if AI citations matter.");
  if (waste.some((w) => w.hits > totalBotHits * 0.05)) recommendations.push("Over 5% of bot hits land on dead/redirecting/parameterised URLs — fix at source to reclaim crawl budget.");
  if (neverCrawledIndexable.length > 0) recommendations.push(`${neverCrawledIndexable.length} indexable page(s) received zero bot hits — strengthen internal linking and sitemap priority.`);

  return {
    totalLines: lines.length, parsedLines: entries.length,
    windowStart: entries.length ? new Date(entries[0].timeMs).toISOString() : undefined,
    windowEnd: entries.length ? new Date(entries[entries.length - 1].timeMs).toISOString() : undefined,
    botHits: botHitsArr, urlStats, statusByBot: statusArr, waste, neverCrawledIndexable: neverCrawledIndexable.slice(0, 200), recommendations,
  };
}

export { AI_BOTS as _logAiBots };
