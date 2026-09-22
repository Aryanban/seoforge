/**
 * Aggregates per-page issues into an Ahrefs-style grouped issue summary
 * with severity, affected-page counts, change deltas, and recommendations.
 */
import { AuditIssue, IssueSummary, IssueSeverity, PageAuditResult } from "../types.js";

export function buildIssueSummary(
  pages: PageAuditResult[],
  previousIssueCounts: Record<string, number> = {}
): IssueSummary[] {
  const issuesMap = new Map<
    string,
    {
      id: string;
      name: string;
      severity: IssueSeverity;
      category: Extract<
        AuditIssue,
        { category: any }
      >["category"];
      affectedUrls: Set<string>;
    }
  >();

  for (const page of pages) {
    for (const issue of page.auditIssues) {
      if (!issuesMap.has(issue.name)) {
        issuesMap.set(issue.name, {
          id: issue.id,
          name: issue.name,
          severity: issue.severity,
          category: issue.category,
          affectedUrls: new Set<string>(),
        });
      }
      issuesMap.get(issue.name)!.affectedUrls.add(page.url);
    }
  }

  const summary: IssueSummary[] = [];
  const currentCounts: Record<string, number> = {};

  for (const [name, data] of issuesMap.entries()) {
    const count = data.affectedUrls.size;
    currentCounts[name] = count;
    const prev = previousIssueCounts[name] ?? 0;
    const change = count - prev;

    summary.push({
      id: data.id,
      name,
      severity: data.severity,
      category: data.category,
      affectedPages: count,
      change,
      affectedUrls: Array.from(data.affectedUrls),
      recommendation: recommendationFor(data.id, name),
    });
  }

  // Include resolved issues (present in previous crawl, absent now)
  for (const [prevName, prevCount] of Object.entries(previousIssueCounts)) {
    if (currentCounts[prevName] === undefined && prevCount > 0) {
      const id = prevName.toLowerCase().replace(/[^a-z0-9]/g, "_");
      summary.push({
        id,
        name: prevName,
        severity: severityForName(prevName),
        category: categoryForName(prevName),
        affectedPages: 0,
        change: -prevCount,
        affectedUrls: [],
        recommendation: recommendationFor(id, prevName),
      });
    }
  }

  const weight = { Error: 3, Warning: 2, Notice: 1 };
  summary.sort((a, b) => {
    if (weight[a.severity] !== weight[b.severity]) return weight[b.severity] - weight[a.severity];
    return b.affectedPages - a.affectedPages;
  });

  return summary;
}

function severityForName(name: string): IssueSeverity {
  const n = name.toLowerCase();
  if (
    n.includes("orphan") ||
    n.includes("4xx") ||
    n.includes("5xx") ||
    n.includes("broken") ||
    n.includes("loop") ||
    n.includes("unreachable") ||
    n.includes("mixed content") ||
    n.includes("error")
  ) {
    return "Error";
  }
  if (
    n.includes("open graph") ||
    n.includes("h1") ||
    n.includes("word count") ||
    n.includes("3xx") ||
    n.includes("multiple") ||
    n.includes("latency") ||
    n.includes("redirect") ||
    n.includes("warning")
  ) {
    return "Warning";
  }
  return "Notice";
}

function categoryForName(name: string): any {
  const n = name.toLowerCase();
  if (n.includes("canonical") || n.includes("title") || n.includes("description") || n.includes("open graph") || n.includes("twitter") || n.includes("hreflang"))
    return "Meta";
  if (n.includes("h1") || n.includes("heading")) return "Headings";
  if (n.includes("word count") || n.includes("content")) return "Content";
  if (n.includes("link") || n.includes("anchor") || n.includes("orphan")) return "Links";
  if (n.includes("image") || n.includes("alt")) return "Images";
  if (n.includes("sitemap")) return "Sitemap";
  if (n.includes("robots")) return "Robots";
  if (n.includes("ttfb") || n.includes("latency") || n.includes("cwv") || n.includes("lcp") || n.includes("cls") || n.includes("inp"))
    return "Performance";
  if (n.includes("structured") || n.includes("schema")) return "StructuredData";
  if (n.includes("aeo") || n.includes("answer")) return "AEO";
  if (n.includes("redirect") || n.includes("4xx") || n.includes("5xx") || n.includes("noindex")) return "Indexability";
  return "Technical";
}

function recommendationFor(id: string, name: string): string {
  const rec = RECOMMENDATIONS[id] || RECOMMENDATIONS_BY_NAME[name];
  if (rec) return rec;
  return "Review the page and optimize according to Google Search Essentials and Bing Webmaster Guidelines.";
}

export const RECOMMENDATIONS: Record<string, string> = {
  orphan_page:
    "Add internal dofollow links pointing to this URL from the navigation bar, footer, or parent index page.",
  orphan_in_sitemap:
    "Internal-link this URL from at least one indexed page so crawlers and users can reach it without the sitemap.",
  not_in_sitemap: "Add this indexable URL to the XML sitemap and submit the sitemap via search consoles / IndexNow.",
  single_incoming_link:
    "Cross-link this page from at least 2 other pages via contextual body links or navigation.",
  broken_link_404:
    "Restore the page or 301-redirect the URL to the closest live equivalent; update all internal links pointing to it.",
  client_error_4xx: "Fix the 4XX response or remove/redirect the URL; audit internal links that reference it.",
  server_error_5xx: "Investigate server logs for the failing route and restore service; monitor uptime.",
  page_unreachable: "Verify DNS and server availability; ensure the host is not blocking the SEOForge crawler UA.",
  redirect_3xx:
    "Update internal links to point directly to the destination URL without intermediate redirect hops.",
  redirect_chain_long: "Collapse the redirect chain into a single 301 hop to the final URL.",
  redirect_loop: "Break the redirect loop by correcting the conflicting redirect rules in server config.",
  http_to_https_redirect: "Ensure all internal links and search engine seed URLs strictly use https://.",
  insecure_http_page: "Provision an TLS certificate and serve the site exclusively over HTTPS.",
  noindex_meta_tag: "Remove the noindex directive if the page should be indexed.",
  noindex_x_robots_tag: "Remove the X-Robots-Tag: noindex header if the page should be indexed.",
  title_missing: "Add a unique, keyword-focused <title> of 15–60 characters.",
  title_too_long: "Shorten the title to ≤ 60 characters so it is not truncated in search results.",
  title_too_short: "Expand the title to 15–60 characters including the primary target keyword.",
  meta_desc_missing: "Write a unique meta description of 70–160 characters summarizing the page's value.",
  meta_desc_too_long: "Trim the meta description to ≤ 160 characters.",
  meta_desc_too_short: "Expand the meta description to 70–160 characters with a clear call to action.",
  canonical_missing: "Add <link rel='canonical'> pointing to the preferred indexable URL.",
  canonical_mismatch: "Make the canonical tag match the requested URL, or 301 to the canonical version.",
  og_tags_incomplete:
    "Ensure og:title, og:description, og:image (1200x630), and og:url are present in the <head>.",
  twitter_card_incomplete: "Add twitter:card, twitter:title, and twitter:image for rich social previews.",
  hreflang_missing: "Add hreflang attributes to alternate language links and a self-referencing entry.",
  hreflang_invalid: "Use valid ISO language/region codes (e.g. 'en', 'en-US') in hreflang values.",
  h1_missing: "Add a descriptive, single <h1> heading outside of <noscript> in the primary HTML DOM.",
  h1_multiple: "Keep exactly one <h1> per document; demote the others to <h2>.",
  h1_too_long: "Shorten the H1 to ≤ 12 words focused on the page's primary keyword.",
  h2_missing: "Add semantic <h2> subheadings to break content into scannable sections.",
  heading_hierarchy_skip: "Fix the heading order so levels progress logically (H1 → H2 → H3).",
  low_word_count: "Expand visible body text to at least 250–350 words of rich, relevant content.",
  generic_anchor_text: 'Replace generic anchors ("click here") with descriptive keyword-rich link text.',
  empty_anchor_text: "Add descriptive anchor text to every link (also fixes accessibility).",
  internal_nofollow: 'Remove rel="nofollow" from internal links so link equity flows within the site.',
  too_many_links: "Reduce link count below 100 per page or paginate hub/list pages.",
  image_missing_alt: "Add concise, descriptive alt text to every meaningful image.",
  image_missing_dimensions: "Add width and height attributes (or aspect-ratio CSS) to prevent layout shifts.",
  image_alt_too_long: "Shorten alt text to ≤ 12 words.",
  image_legacy_format: "Re-encode images as WebP/AVIF and serve via <picture> with fallbacks.",
  image_link_no_anchor: "Add alt text or adjacent descriptive text to image-based links.",
  slow_ttfb: "Optimize server response (caching, CDN, faster origin) to a TTFB under 800ms.",
  high_latency: "Reduce page response time below the configured threshold (caching, CDN, query tuning).",
  cwv_lcp_poor: "Optimize LCP: preload the hero image, reduce render-blocking JS/CSS, upgrade hosting.",
  cwv_cls_poor: "Reserve space for ads/images/embeds and avoid late-loading content above the fold.",
  cwv_inp_poor: "Reduce main-thread blocking: split long tasks, defer non-critical scripts.",
  mixed_content: "Rewrite all resource URLs to https:// or host the assets on your own HTTPS origin.",
  missing_security_headers: "Add CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy headers.",
  no_compression: "Enable gzip or brottli compression for HTML/text responses.",
  schema_missing: "Add Schema.org JSON-LD describing the page's primary entity.",
  schema_google_rich_results_error:
    "Fix the flagged property so the entity satisfies Google Rich Results requirements.",
  schema_org_validation_error: "Correct the schema.org property to use the expected typed object.",
  schema_malformed_jsonld: "Fix the JSON-LD syntax error so the structured data can be parsed.",
  schema_missing_expected: "Add the expected Schema.org entity types to the page's JSON-LD graph.",
  low_aeo_score:
    "Add a direct-answer paragraph, FAQ schema, and comparison tables to raise the AEO score above threshold.",
  aeo_no_definition_snippet:
    "Publish a 40–55 word declarative answer paragraph immediately after the H1/first H2.",
  blocked_by_robots:
    "If this URL should be crawled, remove the disallow rule in robots.txt or exclude it from internal links.",
};

const RECOMMENDATIONS_BY_NAME: Record<string, string> = {
  "Orphan page (has no incoming internal links)":
    "Add internal dofollow links pointing to this URL from the navigation bar, footer, or parent index page.",
  "Page has only one dofollow incoming internal link":
    "Cross-link this page from at least 2 other pages via contextual body links or navigation.",
  "Changed pages not submitted to IndexNow":
    "Submit updated URLs to Bing & Yandex using the IndexNow protocol key.",
};
