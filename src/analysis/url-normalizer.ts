/**
 * Enterprise URL Normalizer & Crawl Loop Shield — High accuracy URL canonicalization.
 * Strips marketing/tracking parameters while preserving functional state (pagination, filters).
 * Detects circular crawl traps (e.g. /category/category/category/...) to avoid infinite loops.
 */

const TRACKING_PARAMS = new Set([
  // Google / GA
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "gclsrc",
  "dclid",
  "_ga",
  "_gl",
  "_gid",
  // Meta / Facebook / Instagram
  "fbclid",
  "igshid",
  // Microsoft / Bing
  "msclkid",
  // Mailchimp / Email
  "mc_cid",
  "mc_eid",
  "spmailingid",
  // Generic trackers & session IDs
  "ref",
  "ref_src",
  "source",
  "trk",
  "sessionid",
  "jsessionid",
  "phpsessid",
  "aspsessionid",
  "yclid",
]);

export interface NormalizationOptions {
  stripTrackingParams?: boolean;
  stripAllParams?: boolean;
  sortParams?: boolean;
  lowercasePath?: boolean;
}

/**
 * Normalizes a URL for high-precision crawling and deduplication.
 */
export function cleanAndNormalizeUrl(rawUrl: string, options: NormalizationOptions = {}): string {
  const {
    stripTrackingParams = true,
    stripAllParams = false,
    sortParams = true,
    lowercasePath = true,
  } = options;

  try {
    const url = new URL(rawUrl);

    // Protocol & Hostname to lowercase
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();

    // Strip default ports
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }

    // Strip fragment/hash (#section)
    url.hash = "";

    // Normalize path
    let pathname = url.pathname;
    // Replace duplicate consecutive slashes
    pathname = pathname.replace(/\/{2,}/g, "/");

    // Remove trailing slash for non-root paths
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    if (lowercasePath) {
      pathname = pathname.toLowerCase();
    }
    url.pathname = pathname;

    // Handle query parameters
    if (stripAllParams) {
      url.search = "";
    } else if (stripTrackingParams && url.search) {
      const sp = url.searchParams;
      const keysToDelete: string[] = [];

      sp.forEach((_, key) => {
        const lowerKey = key.toLowerCase();
        if (TRACKING_PARAMS.has(lowerKey) || lowerKey.startsWith("utm_")) {
          keysToDelete.push(key);
        }
      });

      for (const k of keysToDelete) {
        sp.delete(k);
      }

      // Sort remaining functional parameters so ?b=1&a=2 becomes ?a=2&b=1
      if (sortParams) {
        sp.sort();
      }
    }

    return url.toString();
  } catch {
    // If not a parseable URL, fallback to minimal clean
    return rawUrl.trim().replace(/#.*$/, "").replace(/\/$/, "");
  }
}

/**
 * Detects if a URL has fallen into a repeated segment crawl loop.
 * E.g., /shop/shoes/shop/shoes/shop/shoes or /blog/category/blog/category
 */
export function isCrawlTrapLoop(url: string, maxSegmentRepetition = 2): boolean {
  // Fast path: must have at least 4 slashes after origin to have 4 path segments
  let slashCount = 0;
  for (let i = 8; i < url.length; i++) {
    if (url.charCodeAt(i) === 47 && ++slashCount >= 4) break;
  }
  if (slashCount < 4) return false;

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 4) return false;

    const counts = new Map<string, number>();
    for (const seg of segments) {
      const count = (counts.get(seg) || 0) + 1;
      if (count > maxSegmentRepetition) return true;
      counts.set(seg, count);
    }

    // Check for repeating n-gram patterns like [a, b, a, b]
    for (let len = 2; len <= Math.floor(segments.length / 2); len++) {
      for (let i = 0; i <= segments.length - len * 2; i++) {
        const p1 = segments.slice(i, i + len).join("/");
        const p2 = segments.slice(i + len, i + len * 2).join("/");
        if (p1 === p2) return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}
