/**
 * Deterministic "AI" recommendation engine.
 *
 * Generates per-issue fix documentation (why it matters / how to fix /
 * before-after / priority / effort) with zero LLM, zero network, zero cost.
 * Every doc is templated from the actual affected URLs and page data.
 */
import { IssueSummary, IssueSeverity, RecommendationDoc } from "../types.js";
import { buildFixDoc, FixLibraryEntry } from "./fix-docs.js";

export { buildFixDoc };

export type Priority = "Critical" | "High" | "Medium" | "Low";

export function priorityFor(severity: IssueSeverity, affectedPages: number): Priority {
  if (severity === "Error") return affectedPages >= 10 ? "Critical" : "High";
  if (severity === "Warning") return affectedPages >= 10 ? "High" : "Medium";
  return "Low";
}

export function effortFor(entry: FixLibraryEntry | undefined): "S" | "M" | "L" {
  return entry?.effort ?? "S";
}

/**
 * Convert a grouped issue summary into a full recommendation document set.
 */
export function generateRecommendations(issues: IssueSummary[], maxUrls = 20): RecommendationDoc[] {
  const docs: RecommendationDoc[] = [];

  for (const issue of issues) {
    if (issue.affectedPages === 0 && issue.change >= 0) continue;
    const entry = FIX_LIBRARY[issue.id];
    const priority = priorityFor(issue.severity, issue.affectedPages);
    const effort = effortFor(entry);

    docs.push({
      id: `rec_${issue.id}`,
      issueId: issue.id,
      name: issue.name,
      severity: issue.severity,
      category: issue.category,
      affectedPages: issue.affectedPages,
      change: issue.change,
      priority,
      effort,
      recommendation: issue.recommendation,
      markdown: buildFixDoc(issue, entry, maxUrls),
    });
  }

  const order: Record<Priority, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  docs.sort((a, b) => {
    if (order[a.priority] !== order[b.priority]) return order[b.priority] - order[a.priority];
    return b.affectedPages - a.affectedPages;
  });

  return docs;
}

/**
 * Build the consolidated AI fix-backlog markdown for a whole crawl.
 */
export function generateFixBacklogMarkdown(docs: RecommendationDoc[]): string {
  const lines: string[] = [];
  lines.push("# SEOForge AI Fix Backlog");
  lines.push("*Prioritized, deterministic remediation plan — sorted by impact*");
  lines.push("");
  lines.push(`**Total recommendations:** ${docs.length}`);
  const critical = docs.filter((d) => d.priority === "Critical").length;
  const high = docs.filter((d) => d.priority === "High").length;
  lines.push(`**Critical:** ${critical} · **High:** ${high}`);
  lines.push("");

  for (const doc of docs) {
    lines.push(`## ${doc.name}`);
    lines.push("");
    lines.push(`**Priority:** ${doc.priority} · **Effort:** ${doc.effort} · **Severity:** ${doc.severity} · **Affected pages:** ${doc.affectedPages}`);
    lines.push("");
    lines.push(doc.markdown);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Fix library — deterministic content per issue class                 */
/* ------------------------------------------------------------------ */

export const FIX_LIBRARY: Record<string, FixLibraryEntry> = {
  broken_link_404: {
    effort: "M",
    impact:
      "A 404 wastes crawl budget and, more importantly, any internal link equity pointing at the URL is discarded. Users hitting the link get a dead end, which raises bounce rate and erodes trust signals that search engines measure.",
    steps: [
      "Map every internal link pointing at the 404 URL (listed under Affected pages).",
      "Decide: restore the page, or 301-redirect to the closest live equivalent.",
      "Update the internal links to point directly at the final destination.",
      "Submit the corrected URLs to IndexNow so Bing/Yandex re-crawl promptly.",
    ],
    beforeAfter: {
      before: '<a href="/old-page">View pricing</a>  →  HTTP 404',
      after: '<a href="/pricing">View pricing</a>  →  HTTP 200',
    },
  },
  broken_internal_link: {
    effort: "M",
    impact:
      "Broken internal links sever the crawl path to content and leak link equity. Search engines treat large volumes of broken links as a site-quality signal.",
    steps: [
      "Follow the affected links to confirm the failing status code.",
      "Restore the target, or 301 it to the nearest relevant live URL.",
      "Rewrite the links to the final URL (no hop).",
    ],
  },
  broken_external_link: {
    effort: "S",
    impact:
      "Linking to dead external resources degrades user trust. Search engines may interpret a high broken-external ratio as neglect.",
    steps: [
      "Verify each flagged target manually.",
      "Replace with an authoritative live alternative, or remove the link.",
    ],
  },
  orphan_page: {
    effort: "S",
    impact:
      "Orphan pages receive no internal link equity, so crawlers discover them only via the sitemap and they rank poorly. This is one of the most common causes of 'good content, no traffic'.",
    steps: [
      "Add a contextual dofollow link to the orphan URL from a topically related, frequently crawled page.",
      "Also link it from navigation, a hub/index page, or the footer if appropriate.",
      "Re-run the crawl to confirm at least 2 incoming internal links.",
    ],
  },
  redirect_3xx: {
    effort: "S",
    impact:
      "Each redirect hop costs crawl budget and adds latency; link equity is diluted slightly per hop. Chains also slow the user's first paint.",
    steps: [
      "Identify the final destination URL.",
      "Point all internal links and the sitemap entry directly at the final URL.",
      "Keep the 301 itself so old external links still resolve.",
    ],
  },
  redirect_chain_long: {
    effort: "M",
    impact:
      "Long chains amplify latency and equity loss, and crawlers may abandon the chain before reaching the destination.",
    steps: [
      "Trace the full chain (shown in the issue details).",
      "Rewrite server rules so the first URL 301s straight to the last URL.",
      "Update internal links to the final URL.",
    ],
  },
  redirect_loop: {
    effort: "M",
    impact:
      "A redirect loop makes the page completely unreachable for users and crawlers. It is a hard error and must be fixed immediately.",
    steps: [
      "Inspect the server redirect rules that mutually reference each other.",
      "Break the cycle by pointing one rule at the true final URL.",
      "Purge any CDN/cache layer that may have cached the loop.",
    ],
  },
  title_missing: {
    effort: "S",
    impact:
      "The title is the single strongest on-page ranking signal and the clickable headline in search results. Without it, Google synthesizes one (usually poorly).",
    steps: [
      "Write a unique 15–60 character title.",
      "Place the primary keyword near the start.",
      "Append the brand suffix consistently (e.g. ' | Webforge').",
    ],
    beforeAfter: {
      before: "<title>Home</title>",
      after: "<title>Dholera SIR Land Price Map — Live Plot Rates | DholeraMap</title>",
    },
  },
  meta_desc_missing: {
    effort: "S",
    impact:
      "Meta descriptions control the search-result snippet. Without one, Google auto-generates text from page content, which rarely converts.",
    steps: [
      "Write a unique 70–160 character summary.",
      "Include the target keyword and a clear value proposition.",
      "Avoid duplicating descriptions across pages.",
    ],
  },
  canonical_missing: {
    effort: "S",
    impact:
      "Without a canonical tag, URL variants (query strings, trailing slashes, http/https) can be indexed as duplicate pages, splitting ranking signals.",
    steps: [
      "Add <link rel='canonical' href='[preferred URL]'> to the <head>.",
      "Ensure the preferred URL is the one you want indexed.",
    ],
    beforeAfter: {
      before: "<head> … no canonical … </head>",
      after: "<link rel='canonical' href='https://example.com/page' />",
    },
  },
  canonical_mismatch: {
    effort: "S",
    impact:
      "A canonical pointing elsewhere tells Google the current URL is a duplicate. If unintentional, the page may vanish from the index.",
    steps: [
      "Compare the declared canonical with the live URL.",
      "Point the canonical at the requested URL, or 301 to the canonical version and update all links.",
    ],
  },
  og_tags_incomplete: {
    effort: "S",
    impact:
      "Open Graph tags control the link preview on social platforms and many AI answer engines that render cards. Missing tags cause blank or broken previews.",
    steps: [
      "Add og:title, og:description, og:url and og:image (1200×630).",
      "Add og:type and og:site_name.",
      "Validate with a social preview debugger.",
    ],
  },
  h1_missing: {
    effort: "S",
    impact:
      "The H1 declares the page's topic. Search engines and AI extractors use it as the primary semantic anchor; its absence weakens relevance signals.",
    steps: [
      "Add exactly one descriptive <h1> in the visible <body>.",
      "Mirror the title's keyword intent without duplicating it verbatim.",
      "If the H1 only exists inside <noscript>, move it into the primary DOM.",
    ],
  },
  h1_multiple: {
    effort: "S",
    impact: "Multiple H1s dilute the topical signal and can confuse heading-based extractors.",
    steps: ["Keep the primary H1.", "Demote the others to <h2>."],
  },
  low_word_count: {
    effort: "L",
    impact:
      "Thin pages rarely rank because they lack the topical depth and keyword coverage that satisfy search intent. Google's helpful-content system penalizes shallow text.",
    steps: [
      "Identify the user intent behind the target keyword.",
      "Expand to 250–350+ words of original, useful content.",
      "Add examples, comparisons, and a table where relevant.",
    ],
  },
  image_missing_alt: {
    effort: "S",
    impact:
      "Alt text is required for accessibility (WCAG) and is the primary signal for Google Images. Decorative images may use alt=\"\" but meaningful images must be described.",
    steps: [
      "Audit the flagged images.",
      "Write concise descriptive alt text (≤ 12 words).",
      'Use alt="" only for purely decorative images.',
    ],
  },
  image_missing_dimensions: {
    effort: "S",
    impact:
      "Images without width/height force the browser to reflow once loaded, worsening Cumulative Layout Shift (a Core Web Vital).",
    steps: [
      "Add width and height attributes to <img> tags.",
      "Or set aspect-ratio in CSS.",
    ],
  },
  slow_ttfb: {
    effort: "M",
    impact:
      "Time to First Byte above 800ms delays everything downstream and correlates with poorer rankings. It is the cheapest Core Web Vitals win.",
    steps: [
      "Add a CDN / edge cache for HTML.",
      "Enable full-page caching and object caching.",
      "Profile and optimize slow database queries / origin compute.",
    ],
  },
  high_latency: {
    effort: "M",
    impact: "Slow pages reduce crawl coverage and conversion; search engines sample slow sites less often.",
    steps: ["Cache HTML where possible.", "Shrink payload size.", "Upgrade hosting or add a CDN."],
  },
  mixed_content: {
    effort: "S",
    impact:
      "Modern browsers block insecure subresources on HTTPS pages, breaking scripts, styles, and images and damaging both UX and trust.",
    steps: [
      "Rewrite every http:// asset reference to https://.",
      "Host third-party assets on your own HTTPS origin or switch providers.",
    ],
  },
  schema_missing: {
    effort: "M",
    impact:
      "Structured data unlocks rich results (FAQ, breadcrumbs, ratings) and is increasingly read by AI answer engines to build entity graphs.",
    steps: [
      "Choose the primary entity type for the page.",
      "Emit JSON-LD in the <head> per schema.org.",
      "Validate with the Rich Results Test.",
    ],
  },
  schema_google_rich_results_error: {
    effort: "M",
    impact: "Entities that fail Google's rich-results validation lose their enhanced snippet eligibility.",
    steps: [
      "Read the flagged property in the issue message.",
      "Add the required property per Google's documentation.",
      "Re-test until the Rich Results Test passes.",
    ],
  },
  low_aeo_score: {
    effort: "M",
    impact:
      "A low AEO score means AI answer engines (Google AI Overviews, Perplexity, ChatGPT Search) are unlikely to cite this page as a source.",
    steps: [
      "Add a 40–55 word direct-answer paragraph after the H1.",
      "Add FAQPage JSON-LD with question/answer pairs.",
      "Include a comparison table — extractors strongly prefer tabular data.",
    ],
  },
  aeo_no_definition_snippet: {
    effort: "S",
    impact:
      "AI engines extract concise declarative answers. Without a clear definition paragraph near the top, the page cannot be surfaced as a cited source.",
    steps: [
      "Write a 40–55 word answer to the page's core question.",
      "Place it immediately after the H1 or first H2.",
      "Lead with the entity name, not filler.",
    ],
  },
  not_in_sitemap: {
    effort: "S",
    impact: "Indexable pages absent from the sitemap are discovered more slowly and are harder to monitor at scale.",
    steps: ["Add the URL to the XML sitemap.", "Re-submit the sitemap in search consoles and via IndexNow."],
  },
  orphan_in_sitemap: {
    effort: "S",
    impact:
      "URLs listed only in the sitemap receive no internal link equity and usually fail to rank — a classic 'indexed but invisible' pattern.",
    steps: ["Add an internal contextual link from a related page.", "Keep the sitemap entry as a secondary discovery path."],
  },
  internal_nofollow: {
    effort: "S",
    impact: "Nofollow on internal links blocks equity flow and signals distrust of your own pages.",
    steps: ['Remove rel="nofollow" from internal links.', 'Reserve nofollow/sponsored/ugc for untrusted external links.'],
  },
  too_many_links: {
    effort: "M",
    impact: "Pages with 100+ links dilute equity per link and reduce crawl efficiency.",
    steps: ["Split long lists across paginated pages.", "Remove low-value links from footers and sidebars."],
  },
  generic_anchor_text: {
    effort: "S",
    impact: "Generic anchors ('click here') carry no keyword context and are ignored by AI extractors.",
    steps: ['Rewrite anchors as descriptive phrases, e.g. "compare Dholera plot rates".'],
  },
  blocked_by_robots: {
    effort: "S",
    impact: "A robots.txt disallow prevents crawling entirely; the page cannot be indexed or audited.",
    steps: [
      "Confirm the disallow rule is intentional.",
      "If the page should be public, remove or narrow the rule.",
    ],
  },
  insecure_http_page: {
    effort: "M",
    impact: "HTTP pages are flagged insecure in browsers and receive no ranking benefit; Google indexes HTTPS by default.",
    steps: ["Provision TLS.", "Redirect all HTTP to HTTPS.", "Update internal links and the sitemap."],
  },
  noindex_meta_tag: {
    effort: "S",
    impact: "A noindex tag removes the page from search results entirely.",
    steps: ["Remove the tag if the page should be indexed.", "Otherwise, verify the exclusion is intentional."],
  },
};
