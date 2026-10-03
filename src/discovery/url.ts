/**
 * URL normalization for discovery candidates.
 *
 * Ports the candidate-facing parts of BeyondSEO `network.normalize_url`:
 * preserve path case, query order and non-default ports so distinct pages
 * stay distinct, while collapsing the noise (fragment, default port,
 * tracking parameters) that would split one page into many candidates.
 */

const TRACKING_PARAMS = new Set(["gclid", "dclid", "fbclid", "msclkid", "_ga", "mc_cid", "mc_eid"]);

/** Strip the leading www. from a hostname; "" for unusable input. */
export function discoveryHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isTrackingParam(rawKey: string): boolean {
  const key = rawKey.toLowerCase();
  return key.startsWith("utm_") || TRACKING_PARAMS.has(key);
}

/**
 * Normalize a candidate URL, or return null when it is not usable
 * http(s) address. Preserves query order and repetitions, drops only
 * fragments, default ports and tracking parameters.
 */
export function normalizeCandidateUrl(value: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Reject control characters and backslashes the way the original does.
  if (/[\u0000-\u001f\\]/.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname.replace(/\.$/, "").toLowerCase();
  if (!host) return null;
  const port = parsed.port ? `:${parsed.port}` : "";
  const pathname = parsed.pathname || "/";

  const kept: string[] = [];
  for (const [key, val] of parsed.searchParams) {
    if (isTrackingParam(key)) continue;
    kept.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
  }
  const search = kept.length > 0 ? `?${kept.join("&")}` : "";
  return `${parsed.protocol}//${host}${port}${pathname}${search}`;
}
