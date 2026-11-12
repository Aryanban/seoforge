/**
 * HTTP fetcher with timeout, TTFB timing, and redirect tracking.
 */
import { Agent } from "undici";
import * as dns from "node:dns";

const DEFAULT_UA = "Mozilla/5.0 (compatible; SEOForgeBot/2.0; +https://github.com/Aryanban/seoforge)";

// High-performance in-memory DNS cache to eliminate libuv threadpool contention
interface DnsEntry {
  address: string | dns.LookupAddress[];
  family: number;
  expires: number;
}
const dnsCache = new Map<string, DnsEntry>();
const DNS_TTL_MS = 60_000;

function cachedLookup(
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void
): void {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? {} : options;
  const isAll = opts && typeof opts === "object" && opts.all;
  const cacheKey = `${hostname}:${isAll ? "all" : "single"}`;

  const entry = dnsCache.get(cacheKey);
  if (entry && Date.now() < entry.expires) {
    if (isAll) return cb(null, entry.address);
    return cb(null, entry.address as string, entry.family);
  }

  dns.lookup(hostname, opts, (err, address, family) => {
    if (!err && address) {
      dnsCache.set(cacheKey, {
        address,
        family: family || 4,
        expires: Date.now() + DNS_TTL_MS,
      });
      if (dnsCache.size > 5000) {
        const now = Date.now();
        for (const [k, v] of dnsCache) {
          if (v.expires < now) dnsCache.delete(k);
        }
      }
    }
    if (isAll) cb(err, address);
    else cb(err, address, family);
  });
}

// Persistent keep-alive connection pool across all crawl requests
const crawlerDispatcher = new Agent({
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 120000,
  connections: 128,
  pipelining: 1,
  connect: { lookup: cachedLookup },
});

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
  /** Status code of the first redirect hop (when redirected). */
  redirectStatusCode?: number;
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
    maxRedirects = 10,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  let ttfb = 0;

  // Manual redirect walk so the FULL chain + per-hop status codes are known.
  // fetch()'s transparent "follow" mode hides intermediate hops, which made
  // redirect_chain_long under-count and hid 302-vs-301 classification.
  const chain: string[] = [url];
  let current = url;
  let hops = 0;
  let firstRedirectCode: number | undefined;

  try {
    while (true) {
      const hopStart = Date.now();
      const res = await fetch(current, {
        method,
        signal: controller.signal,
        redirect: "manual",
        dispatcher: crawlerDispatcher,
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "keep-alive",
        },
      } as any);
      const hopTtfb = Date.now() - hopStart;
      ttfb = ttfb || hopTtfb;

      const status = res.status;
      const location = res.headers.get("location");
      const isRedirect = status >= 300 && status < 400 && !!location;

      if (!isRedirect || !followRedirects) {
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });

        let html = "";
        const cType = (res.headers.get("content-type") || "").toLowerCase();
        const isHtmlOrXml = /text\/html|application\/xhtml\+xml|application\/xml|text\/xml/i.test(cType);
        const cLength = parseInt(res.headers.get("content-length") || "0", 10);

        if (method === "GET" && status < 400) {
          if (!isHtmlOrXml && /image\/|video\/|audio\/|application\/pdf|application\/zip|font\//.test(cType)) {
            html = "";
          } else if (cLength > 10 * 1024 * 1024) {
            html = "";
          } else {
            try {
              html = await res.text();
            } catch {
              html = "";
            }
          }
        } else if (method === "GET") {
          // Still drain error bodies (bounded) for diagnostics; not audited.
          try {
            html = (await res.text()).slice(0, 65536);
          } catch {
            html = "";
          }
        }
        const responseTimeMs = Date.now() - start;

        return {
          status,
          ok: res.ok,
          html,
          headers,
          responseTimeMs,
          ttfbMs: ttfb,
          finalUrl: current,
          requestedUrl: url,
          redirected: chain.length > 1,
          redirectChain: Array.from(new Set(chain)),
          redirectStatusCode: firstRedirectCode,
          contentType: headers["content-type"],
          contentLengthBytes: headers["content-length"] ? parseInt(headers["content-length"], 10) : html.length,
        };
      }

      // Follow one hop manually
      if (firstRedirectCode === undefined) firstRedirectCode = status;
      hops++;
      if (hops > maxRedirects) {
        const responseTimeMs = Date.now() - start;
        return {
          status: 310,
          ok: false,
          html: "",
          headers: {},
          responseTimeMs,
          ttfbMs: ttfb || responseTimeMs,
          finalUrl: current,
          requestedUrl: url,
          redirected: true,
          redirectChain: Array.from(new Set(chain)),
          redirectStatusCode: firstRedirectCode,
          errorMessage: `Too many redirects (>${maxRedirects} hops)`,
        };
      }
      try {
        current = new URL(location!, current).href;
      } catch {
        const responseTimeMs = Date.now() - start;
        return {
          status,
          ok: false,
          html: "",
          headers: {},
          responseTimeMs,
          ttfbMs: ttfb || responseTimeMs,
          finalUrl: current,
          requestedUrl: url,
          redirected: true,
          redirectChain: Array.from(new Set(chain)),
          redirectStatusCode: firstRedirectCode,
          errorMessage: `Invalid redirect Location header: ${location}`,
        };
      }
      if (chain.includes(current)) {
        chain.push(current);
        const responseTimeMs = Date.now() - start;
        return {
          status: 311,
          ok: false,
          html: "",
          headers: {},
          responseTimeMs,
          ttfbMs: ttfb || responseTimeMs,
          finalUrl: current,
          requestedUrl: url,
          redirected: true,
          redirectChain: Array.from(new Set(chain)),
          redirectStatusCode: firstRedirectCode,
          errorMessage: `Redirect loop detected: ${chain.join(" → ")}`,
        };
      }
      chain.push(current);
      // 301/302/303 historically rewrite POST→GET; crawler only uses GET/HEAD.
    }
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
      finalUrl: current,
      requestedUrl: url,
      redirected: chain.length > 1,
      redirectChain: Array.from(new Set(chain)),
      redirectStatusCode: firstRedirectCode,
      errorMessage: isAbort ? `Request timed out after ${timeoutMs}ms` : err.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function closeCrawlerPool(): void {
  crawlerDispatcher.destroy();
}

export { DEFAULT_UA, crawlerDispatcher, closeCrawlerPool };
