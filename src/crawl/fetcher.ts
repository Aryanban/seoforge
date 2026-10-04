/**
 * HTTP fetcher with timeout, TTFB timing, and redirect tracking.
 */

const DEFAULT_UA = "Mozilla/5.0 (compatible; SEOForgeBot/2.0; +https://github.com/Aryanban/seoforge)";

export interface FetchResult {
  status: number;
  ok: boolean;
  html: string;
  headers: Record<string, string>;
  responseTimeMs: number;
  ttfbMs: number;
  finalUrl: string;
  requestedUrl: string;
  redirected: boolean;
  redirectChain: string[];
  contentType?: string;
  contentLengthBytes?: number;
  errorMessage?: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  userAgent?: string;
  method?: "GET" | "HEAD";
  followRedirects?: boolean;
  maxRedirects?: number;
}

export async function fetchPage(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const {
    timeoutMs = 15000,
    userAgent = DEFAULT_UA,
    method = "GET",
    followRedirects = true,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  let ttfb = 0;

  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: followRedirects ? "follow" : "manual",
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });
    ttfb = Date.now() - start;

    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    let html = "";
    if (method === "GET") {
      html = await res.text();
    }
    const responseTimeMs = Date.now() - start;

    const redirectChain = followRedirects ? extractManualChain(res.url, url) : [url, res.url];

    return {
      status: res.status,
      ok: res.ok,
      html,
      headers,
      responseTimeMs,
      ttfbMs: ttfb,
      finalUrl: res.url || url,
      requestedUrl: url,
      redirected: res.redirected || res.url !== url,
      redirectChain: Array.from(new Set(redirectChain)),
      contentType: headers["content-type"],
      contentLengthBytes: headers["content-length"] ? parseInt(headers["content-length"], 10) : html.length,
    };
  } catch (err: any) {
    const responseTimeMs = Date.now() - start;
    const isAbort = err.name === "AbortError";
    return {
      status: 0,
      ok: false,
      html: "",
      headers: {},
      responseTimeMs,
      ttfbMs: ttfb || responseTimeMs,
      finalUrl: url,
      requestedUrl: url,
      redirected: false,
      redirectChain: [url],
      errorMessage: isAbort ? `Request timed out after ${timeoutMs}ms` : err.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractManualChain(finalUrl: string, requestedUrl: string): string[] {
  if (finalUrl && finalUrl !== requestedUrl) return [requestedUrl, finalUrl];
  return [requestedUrl];
}

export { DEFAULT_UA };
