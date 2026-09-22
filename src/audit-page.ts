/**
 * Single-page audit — deep inspection of one URL (used by the `inspect`
 * command, the MCP `seoforge_inspect_url` tool, and the dashboard preview).
 */
import { PageAuditResult, AuditIssue, CanonicalPolicy, CoreWebVitals } from "./types.js";
import { fetchPage } from "./crawl/fetcher.js";
import { renderUrl } from "./crawl/renderer.js";
import { extractLinks, extractImages } from "./crawl/link-extractor.js";
import { normalizeUrl } from "./crawl/queue.js";
import { runPageChecks, Thresholds } from "./checks/registry.js";

export interface SinglePageOptions {
  expectedEntities?: string[];
  canonicalPolicy?: CanonicalPolicy;
  render?: boolean;
  timeoutMs?: number;
  thresholds?: Thresholds;
}

export interface SinglePageResult {
  page: PageAuditResult;
  issues: AuditIssue[];
}

export async function auditSinglePage(url: string, options: SinglePageOptions = {}): Promise<SinglePageResult> {
  const {
    expectedEntities = [],
    canonicalPolicy = "strict",
    render = false,
    timeoutMs = 15000,
    thresholds,
  } = options;

  let html = "";
  let finalUrl = url;
  let status = 0;
  let responseTimeMs = 0;
  let ttfbMs: number | undefined;
  let rendered = false;
  let headers: Record<string, string> = {};
  let cwv: CoreWebVitals | undefined;
  let isRedirect = false;
  let redirectChain: string[] = [];
  let isHttpToHttpsRedirect = false;

  if (render) {
    const renderedResult = await renderUrl(url, { timeoutMs });
    const raw = await fetchPage(url, { timeoutMs, method: "GET" });
    html = renderedResult.html || raw.html;
    finalUrl = renderedResult.finalUrl || raw.finalUrl || url;
    status = renderedResult.status || raw.status;
    responseTimeMs = raw.responseTimeMs;
    ttfbMs = raw.ttfbMs;
    rendered = !!renderedResult.html;
    headers = raw.headers;
    cwv = renderedResult.cwv;
    isRedirect = raw.redirected;
    redirectChain = raw.redirectChain;
    isHttpToHttpsRedirect = raw.requestedUrl.startsWith("http://") && raw.finalUrl.startsWith("https://");
  } else {
    const raw = await fetchPage(url, { timeoutMs, method: "GET" });
    html = raw.html;
    finalUrl = raw.finalUrl || url;
    status = raw.status;
    responseTimeMs = raw.responseTimeMs;
    ttfbMs = raw.ttfbMs;
    headers = raw.headers;
    isRedirect = raw.redirected;
    redirectChain = raw.redirectChain;
    isHttpToHttpsRedirect = raw.requestedUrl.startsWith("http://") && raw.finalUrl.startsWith("https://");
  }

  const links = html ? extractLinks(html, finalUrl) : { links: [], internalTargets: [], externalTargets: [] };
  const images = html ? extractImages(html, finalUrl) : [];

  const { page, issues } = runPageChecks({
    pageUrl: url,
    finalUrl,
    html,
    status,
    responseTimeMs,
    ttfbMs,
    depth: 0,
    rendered,
    headers,
    links,
    images,
    robots: null,
    options: {} as any,
    thresholds,
    expectedEntities,
    canonicalPolicy,
    cwv,
    sitemapUrls: new Set(),
    isRedirect,
    redirectChain,
    isHttpToHttpsRedirect,
  });

  return { page, issues };
}

export { normalizeUrl };
