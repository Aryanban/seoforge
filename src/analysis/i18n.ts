/**
 * Internationalisation checks: hreflang reciprocity + x-default + ISO codes.
 * Screaming Frog Hreflang Issues parity: missing return links, non-200
 * targets, noindex targets, unlinked targets, missing self-reference,
 * missing x-default, duplicate entries, invalid codes, relative URLs.
 * Sources: screamingfrog.co.uk/seo-spider/issues/hreflang/ + Google Search
 * Central localized-versions (reciprocated, fully-qualified, self-ref).
 */
export interface HreflangLink { lang: string; href: string; }
export interface HreflangSiteInput {
  pages: Map<string, HreflangLink[]>;
  pageInfo: Map<string, { status: number; isIndexable: boolean }>;
}
export interface HreflangIssue {
  id: string; name: string; severity: "Error" | "Warning" | "Notice";
  message: string; url: string; details?: Record<string, unknown>;
}
const VALID_LANG = /^[a-z]{2,3}(-[A-Za-z]{2,8})?$|^x-default$/;
function norm(u: string): string {
  try {
    const p = new URL(u); p.hash = "";
    let path = p.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${p.origin}${path}`.toLowerCase();
  } catch { return u.toLowerCase().trim(); }
}
export function auditHreflangSitewide(input: HreflangSiteInput): HreflangIssue[] {
  const issues: HreflangIssue[] = [];
  const { pages, pageInfo } = input;
  for (const [pageUrl, links] of pages.entries()) {
    if (links.length === 0) continue;
    for (const l of links) {
      if (!VALID_LANG.test(l.lang)) issues.push({ id: "hreflang_invalid_code", name: "Invalid hreflang language code", severity: "Warning", message: `hreflang value '${l.lang}' is not a valid ISO language/region code or x-default.`, url: pageUrl, details: { value: l.lang } });
      if (!/^https?:\/\//i.test(l.href)) issues.push({ id: "hreflang_relative_url", name: "hreflang uses a relative URL", severity: "Warning", message: `hreflang '${l.lang}' points to relative URL '${l.href}'. Google requires fully-qualified absolute URLs.`, url: pageUrl, details: { lang: l.lang, href: l.href } });
    }
    const selfNorm = norm(pageUrl);
    if (!links.some((l) => norm(l.href) === selfNorm)) issues.push({ id: "hreflang_missing_self", name: "hreflang missing self-reference", severity: "Warning", message: "Page has hreflang annotations but none reference the page itself. Every URL must include a self-referencing entry.", url: pageUrl });
    if (!links.some((l) => l.lang === "x-default")) issues.push({ id: "hreflang_missing_x_default", name: "hreflang missing x-default", severity: "Notice", message: "No x-default hreflang entry. Add one pointing at the fallback page for unmatched languages.", url: pageUrl });
    const seen = new Set<string>();
    for (const l of links) {
      if (seen.has(l.lang)) { issues.push({ id: "hreflang_duplicate_lang", name: "Duplicate hreflang language entry", severity: "Warning", message: `Language '${l.lang}' is declared more than once. Keep one entry per language/region.`, url: pageUrl, details: { lang: l.lang } }); break; }
      seen.add(l.lang);
    }
    for (const l of links) {
      const targetNorm = norm(l.href);
      let targetKey: string | undefined;
      for (const k of pages.keys()) { if (norm(k) === targetNorm) { targetKey = k; break; } }
      if (!targetKey) { issues.push({ id: "hreflang_unlinked_target", name: "hreflang target not crawled / unlinked", severity: "Warning", message: `hreflang '${l.lang}' points to '${l.href}', which was not found among crawled pages \u2014 it may be unlinked or blocked.`, url: pageUrl, details: { lang: l.lang, href: l.href } }); continue; }
      const back = pages.get(targetKey) || [];
      if (!back.some((b) => norm(b.href) === selfNorm)) issues.push({ id: "hreflang_missing_return", name: "hreflang missing return link", severity: "Error", message: `hreflang '${l.lang}' to '${l.href}' has no return link back. Annotations must be reciprocated or Google ignores them.`, url: pageUrl, details: { lang: l.lang, href: l.href } });
      const info = pageInfo.get(targetKey);
      if (info && info.status !== 200) issues.push({ id: "hreflang_target_non_200", name: "hreflang target returns non-200", severity: "Error", message: `hreflang '${l.lang}' target '${l.href}' returns HTTP ${info.status}. Alternate URLs must be live and indexable.`, url: pageUrl, details: { lang: l.lang, href: l.href, status: info.status } });
      else if (info && !info.isIndexable) issues.push({ id: "hreflang_target_noindex", name: "hreflang target not indexable", severity: "Error", message: `hreflang '${l.lang}' target '${l.href}' carries noindex. Alternate URLs must be indexable.`, url: pageUrl, details: { lang: l.lang, href: l.href } });
    }
  }
  return issues;
}
/** ISO 639 language codes for the 22 scheduled Indian languages + common region pairings. */
export const INDIA_LANGUAGES: Array<{ code: string; language: string; script: string }> = [
  { code: "hi", language: "Hindi", script: "Devanagari" },
  { code: "bn", language: "Bengali", script: "Bengali" },
  { code: "te", language: "Telugu", script: "Telugu" },
  { code: "mr", language: "Marathi", script: "Devanagari" },
  { code: "ta", language: "Tamil", script: "Tamil" },
  { code: "gu", language: "Gujarati", script: "Gujarati" },
  { code: "kn", language: "Kannada", script: "Kannada" },
  { code: "ml", language: "Malayalam", script: "Malayalam" },
  { code: "pa", language: "Punjabi", script: "Gurmukhi" },
  { code: "or", language: "Odia", script: "Odia" },
  { code: "as", language: "Assamese", script: "Bengali-Assamese" },
  { code: "ur", language: "Urdu", script: "Perso-Arabic" },
];
