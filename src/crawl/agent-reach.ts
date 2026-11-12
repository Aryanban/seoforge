/**
 * Agent Reach integration for SEOForge.
 *
 * Provides high-efficiency scraping and anti-bot bypass using Agent Reach:
 * - Login-walled platforms (Reddit, Twitter/X, LinkedIn, Xiaohongshu)
 * - Video platforms & subtitles (YouTube, Bilibili)
 * - Clean structured platform data (GitHub, Xueqiu, V2EX)
 * - Anti-bot / JS / dynamic web fallback via CloakBrowser / Jina / Exa
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FetchResult } from "./fetcher.js";

const execFileAsync = promisify(execFile);

export interface AgentReachItem {
  title?: string | null;
  url?: string | null;
  author?: string | null;
  published_at?: string | null;
  text?: string | null;
  raw?: any;
}

export interface AgentReachReadResult {
  schema_version?: number;
  ok: boolean;
  channel?: string;
  action?: string;
  backend?: string;
  items?: AgentReachItem[];
  meta?: {
    elapsed_ms?: number;
    attempts?: Array<{ backend: string; result: string }>;
    update?: any;
  };
  error?: {
    code: string;
    message: string;
    hint?: string;
  } | null;
  rawJson?: string;
}

export interface AgentReachDoctorResult {
  ok: boolean;
  version?: string;
  channels?: Array<{
    channel: string;
    level: string;
    status: string;
    problems: string[];
    hint: string;
  }>;
  tools?: Array<{
    tool: string;
    owner: string;
    version: string;
  }>;
  error?: string;
}

let cachedAvailability: boolean | null = null;

/**
 * Checks whether the `agent-reach` CLI is installed and executable in PATH.
 */
export async function isAgentReachAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) {
    return cachedAvailability;
  }
  try {
    const { stdout } = await execFileAsync("agent-reach", ["version"], { timeout: 3000 });
    const parsed = JSON.parse(stdout.trim());
    cachedAvailability = parsed.ok === true;
    return cachedAvailability;
  } catch {
    cachedAvailability = false;
    return false;
  }
}

/**
 * Resets cached availability check (useful for testing or after install).
 */
export function resetAgentReachAvailabilityCache(): void {
  cachedAvailability = null;
}

/**
 * Runs `agent-reach doctor` to report status of channels and installed tools.
 */
export async function agentReachDoctor(): Promise<AgentReachDoctorResult> {
  try {
    const { stdout } = await execFileAsync("agent-reach", ["doctor"], { timeout: 10000 });
    const parsed = JSON.parse(stdout.trim());
    if (parsed.ok && parsed.result) {
      return {
        ok: true,
        version: parsed.result.version,
        channels: parsed.result.channels,
        tools: parsed.result.tools,
      };
    }
    return {
      ok: false,
      error: parsed.error?.message || "Doctor check failed",
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err.message || "Failed to execute agent-reach doctor",
    };
  }
}

/**
 * Reads any URL using `agent-reach read <url>`.
 */
export async function agentReachRead(
  url: string,
  options: { timeoutMs?: number; channel?: string; backend?: string } = {},
): Promise<AgentReachReadResult> {
  const { timeoutMs = 25000, channel, backend } = options;
  const args: string[] = [];

  if (channel) {
    args.push(channel, "read", url);
  } else {
    args.push("read", url);
  }

  if (backend) {
    args.push("--backend", backend);
  }

  try {
    const { stdout } = await execFileAsync("agent-reach", args, { timeout: timeoutMs });
    const trimmed = stdout.trim();
    const parsed = JSON.parse(trimmed);
    return {
      ...parsed,
      rawJson: trimmed,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: {
        code: "EXEC_ERROR",
        message: err.message || "Failed to execute agent-reach read",
      },
    };
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Convert markdown links [text](url) to HTML anchors <a href="url">text</a>
 * and format paragraphs so link extraction and text analysis work seamlessly.
 */
function markdownToHtml(text: string): string {
  const withLinks = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, href) => {
    return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  });

  const paragraphs = withLinks
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");

  return paragraphs;
}

/**
 * Synthesizes HTML from Agent Reach structured items so that SEOForge's
 * link extractor, schema validator, and AEO checks can process the page.
 */
export function synthesizeHtmlFromReach(items: AgentReachItem[], fallbackTitle?: string): string {
  const first = items[0] || {};
  const pageTitle = first.title || fallbackTitle || "Scraped Content";
  const author = first.author;
  const publishedAt = first.published_at;

  const contentBlocks = items
    .map((it, idx) => {
      const itemTitle = it.title ? `<h2>${escapeHtml(it.title)}</h2>` : "";
      const itemAuthor = it.author ? `<div class="author">By ${escapeHtml(it.author)}</div>` : "";
      const itemDate = it.published_at ? `<time datetime="${escapeHtml(it.published_at)}">${escapeHtml(it.published_at)}</time>` : "";
      const body = it.text ? markdownToHtml(it.text) : "";
      return `<article id="item-${idx}">\n${itemTitle}\n${itemAuthor}\n${itemDate}\n<div class="content">${body}</div>\n</article>`;
    })
    .join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(pageTitle)}</title>
  ${author ? `<meta name="author" content="${escapeHtml(author)}">` : ""}
  ${publishedAt ? `<meta name="article:published_time" content="${escapeHtml(publishedAt)}">` : ""}
  <meta name="generator" content="agent-reach">
</head>
<body>
  <h1>${escapeHtml(pageTitle)}</h1>
  <main>
${contentBlocks}
  </main>
</body>
</html>`;
}

/**
 * Performs a fetch using Agent Reach and adapts the output to SEOForge's `FetchResult`.
 */
export async function agentReachFetch(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<FetchResult> {
  const start = Date.now();
  const reachRes = await agentReachRead(url, options);
  const responseTimeMs = Date.now() - start;

  if (!reachRes.ok || !reachRes.items || reachRes.items.length === 0) {
    const errorMsg = reachRes.error?.message || "Agent Reach failed to retrieve content";
    return {
      status: reachRes.error?.code === "NOT_FOUND" ? 404 : 502,
      ok: false,
      html: "",
      headers: {
        "x-fetched-by": "agent-reach",
        "x-reach-status": "error",
      },
      responseTimeMs,
      ttfbMs: responseTimeMs,
      finalUrl: url,
      requestedUrl: url,
      redirected: false,
      redirectChain: [url],
      errorMessage: errorMsg,
    };
  }

  const items = reachRes.items;
  const first = items[0];
  const finalUrl = first.url || url;
  const html = synthesizeHtmlFromReach(items, first.title || url);

  return {
    status: 200,
    ok: true,
    html,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-fetched-by": "agent-reach",
      "x-reach-channel": reachRes.channel || "unknown",
      "x-reach-backend": reachRes.backend || "unknown",
    },
    responseTimeMs,
    ttfbMs: reachRes.meta?.elapsed_ms || responseTimeMs,
    finalUrl,
    requestedUrl: url,
    redirected: finalUrl !== url,
    redirectChain: finalUrl !== url ? [url, finalUrl] : [url],
    contentType: "text/html; charset=utf-8",
    contentLengthBytes: Buffer.byteLength(html, "utf8"),
  };
}
