/**
 * URL hygiene analysis — Screaming Frog "URL" tab + Sitebulb "URL" hints parity.
 *
 * Deterministic, zero-network. Rules sourced from:
 * - https://www.screamingfrog.co.uk/seo-spider/issues/url/
 *   (URL >115 chars; non-ASCII; underscores; uppercase; parameters; session IDs;
 *    duplicate internal paths; query strings; paginated URLs, unlinked)
 * - Sitebulb "This URL is non-secure / has parameters" hints (sitebulb.com/hints/)
 * - Google Search Central: keep URLs simple, avoid session IDs/parameters where
 *   possible (developers.google.com/search/docs/crawling-indexing/url-structure)
 */
export interface UrlHygieneInput {
  url: string;
  linksFound?: number; // incoming internal links (0 => unlinked hint context)
  isPaginated?: boolean;
}

export interface UrlHygieneResult {
  overLength: boolean;
  length: number;
  hasNonAscii: boolean;
  hasUnderscore: boolean;
  hasUppercase: boolean;
  hasParameters: boolean;
  paramCount: number;
  hasSessionId: boolean;
  hasQueryString: boolean;
  duplicateInternalPath: boolean; // same path segment repeated: /a/a/
  doubleSlash: boolean;
  trailingDot: boolean;
  findings: string[];
}

const SESSION_ID_PATTERNS = [
  /[?&](?:sid|sessionid|session_id|phpsessid|jsessionid|aspsessionid|sessid|sid_?[a-z]*)[=:][^&]+/i,
  /[?&](?:utm_[a-z]+|gclid|fbclid|msclkid|yclid|dclid|wbraid|gbraid)=[^&]*/i,
];

/** Screaming Frog "URL over 115 characters" cutoff (screamingfrog.co.uk/seo-spider/issues/url/). */
export const URL_MAX_LENGTH = 115;

export function analyzeUrlHygiene(input: UrlHygieneInput): UrlHygieneResult {
  const { url } = input;
  const findings: string[] = [];
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    return {
      overLength: false,
      length: url.length,
      hasNonAscii: /[^\x00-\x7F]/.test(url),
      hasUnderscore: false,
      hasUppercase: false,
      hasParameters: false,
      paramCount: 0,
      hasSessionId: false,
      hasQueryString: false,
      duplicateInternalPath: false,
      doubleSlash: false,
      trailingDot: false,
      findings: ["URL could not be parsed."],
    };
  }

  const length = url.length;
  const overLength = length > URL_MAX_LENGTH;
  if (overLength) findings.push(`URL is ${length} characters (over ${URL_MAX_LENGTH}-character hygiene limit).`);

  const path = parsed.pathname;
  const hasNonAscii = /[^\x00-\x7F]/.test(url);
  if (hasNonAscii) findings.push("URL contains non-ASCII characters; percent-encode or slugify to ASCII.");

  // Underscores vs hyphens: only the path slug portion counts (query values often legitimately contain _)
  const slugPart = path.split("/").filter(Boolean).join("/");
  const hasUnderscore = slugPart.includes("_");
  if (hasUnderscore) findings.push("URL path uses underscores; Google recommends hyphens (-) as word separators.");

  const hasUppercase = /[A-Z]/.test(path);
  if (hasUppercase) findings.push("URL path contains uppercase characters; lowercase canonical URLs to avoid duplicates.");

  const search = parsed.search || "";
  const hasQueryString = search.length > 1;
  const params = hasQueryString ? search.slice(1).split("&").filter(Boolean) : [];
  const paramCount = params.length;
  const hasParameters = paramCount > 0;
  if (hasParameters) findings.push(`URL carries ${paramCount} query parameter(s), which fragments crawl equity; canonicalise where possible.`);

  const hasSessionId = SESSION_ID_PATTERNS.some((re) => re.test(url));
  if (hasSessionId) findings.push("URL appears to contain a session ID or ad-click identifier; strip before indexing.");

  // Duplicate internal paths: /blog/blog/, /shop/shop/shoes etc.
  const segments = path.split("/").filter(Boolean).map((s) => s.toLowerCase());
  let duplicateInternalPath = false;
  for (let i = 1; i < segments.length; i++) {
    if (segments[i] === segments[i - 1]) {
      duplicateInternalPath = true;
      break;
    }
  }
  if (duplicateInternalPath) findings.push("URL repeats a path segment (e.g. /blog/blog/); collapse redundant folders.");

  const doubleSlash = /\/{2,}/.test(path);
  if (doubleSlash) findings.push("URL path contains a double slash; normalise to a single slash.");

  const trailingDot = parsed.hostname.endsWith(".");
  if (trailingDot) findings.push("Hostname ends with a trailing dot; normalise the canonical host.");

  return {
    overLength,
    length,
    hasNonAscii,
    hasUnderscore,
    hasUppercase,
    hasParameters,
    paramCount,
    hasSessionId,
    hasQueryString,
    duplicateInternalPath,
    doubleSlash,
    trailingDot,
    findings,
  };
}
