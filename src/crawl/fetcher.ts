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
  // Negotiate HTTP/2 via ALPN where the server offers it (Googlebot does too);
  // falls back to HTTP/1.1 keep-alive otherwise.
  allowH2: true,
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
  /** Undecoded body, when FetchOptions.bytes is set. */
  bytes?: Buffer;
}

export interface FetchOptions {
  timeoutMs?: number;
  userAgent?: string;
  method?: "GET" | "HEAD";
  followRedirects?: boolean;
  maxRedirects?: number;
  /** GET for the status only: cancel the body stream instead of downloading it. */
  discardBody?: boolean;
  /** Keep the raw body bytes (gzip files) and raise the size cap to this many bytes. */
  bytes?: number;
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
        let bytes: Buffer | undefined;
        let bodyBytes: number | undefined;
        const cType = (res.headers.get("content-type") || "").toLowerCase();
        const isHtmlOrXml = /text\/html|application\/xhtml\+xml|application\/xml|text\/xml/i.test(cType);
        const cLength = parseInt(res.headers.get("content-length") || "0", 10);

        if (options.discardBody) {
          await res.body?.cancel().catch(() => {});
        } else if (options.bytes && method === "GET" && status < 400) {
          if (cLength > options.bytes) {
            await res.body?.cancel().catch(() => {});
          } else {
            bytes = Buffer.from(await res.arrayBuffer());
            if (bytes.length > options.bytes) bytes = undefined;
            else html = bytes.toString("utf8");
          }
        } else if (method === "GET" && status < 400) {
          if (
            (!isHtmlOrXml && /image\/|video\/|audio\/|application\/pdf|application\/zip|font\//.test(cType)) ||
            cLength > MAX_BODY_BYTES
          ) {
            // Cancel, don't abandon: an unread body pins the keep-alive socket.
            await res.body?.cancel().catch(() => {});
          } else {
            const body = await readCapped(res, MAX_BODY_BYTES);
            html = decodeBody(body.bytes, cType);
            bodyBytes = body.bytes.length;
          }
        } else if (method === "GET") {
          // Still drain error bodies (bounded) for diagnostics; not audited.
          html = decodeBody((await readCapped(res, 65536)).bytes, cType);
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
          // Bytes on the wire after decompression; html.length would count UTF-16 units.
          contentLengthBytes: headers["content-length"]
            ? parseInt(headers["content-length"], 10)
            : bodyBytes ?? bytes?.length ?? Buffer.byteLength(html),
          bytes,
        };
      }

      // Follow one hop manually. Release the redirect body first so undici can
      // reuse the socket for the next hop instead of opening a new connection.
      await res.body?.cancel().catch(() => {});
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

const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Read at most `max` bytes, then cancel the stream. Bounds memory when a server
 * omits Content-Length (chunked) and streams an unexpectedly large body.
 */
async function readCapped(res: Response, max: number): Promise<{ bytes: Buffer; truncated: boolean }> {
  if (!res.body) return { bytes: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      if (total >= max) {
        await reader.cancel().catch(() => {});
        return { bytes: Buffer.concat(chunks).subarray(0, max), truncated: true };
      }
    }
  } catch {
    /* connection dropped mid-body: keep what arrived */
  }
  return { bytes: Buffer.concat(chunks), truncated: false };
}

/**
 * Decode with the charset from Content-Type, else a <meta charset> in the first
 * 2 KB (HTML spec prescan), else UTF-8. res.text() always assumes UTF-8, which
 * garbles titles/text on windows-1252, Shift_JIS, GBK, etc. sites.
 */
export function decodeBody(bytes: Uint8Array, contentType: string): string {
  let label = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!label) {
    const head = Buffer.from(bytes.subarray(0, 2048)).toString("latin1");
    label = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(label || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function closeCrawlerPool(): void {
  crawlerDispatcher.destroy();
}

export { DEFAULT_UA, crawlerDispatcher, closeCrawlerPool };
