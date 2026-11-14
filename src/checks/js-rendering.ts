/**
 * JavaScript SEO: compare the raw HTML response with the rendered DOM (render
 * mode only). Screaming Frog's "JavaScript" tab parity. Grounded in Google's
 * JavaScript SEO basics:
 *  - Google may skip rendering a page whose raw HTML carries noindex, so JS
 *    that removes noindex does not help (developers.google.com/search/docs/
 *    crawling-indexing/javascript/javascript-seo-basics).
 *  - Canonical / robots set by JS must not conflict with the raw HTML.
 *  - Links and content that only exist after rendering are discovered later
 *    (second wave) or not at all by crawlers that don't render.
 */
import * as cheerio from "cheerio";
import { AuditIssue } from "../types.js";
import { extractVisibleText, countWords } from "../crawl/link-extractor.js";

export interface RenderSnapshot {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  h1: string;
  links: Set<string>;
  words: number;
}

export function snapshot($: cheerio.CheerioAPI, baseUrl: string): RenderSnapshot {
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) return;
    try {
      const u = new URL(href, baseUrl);
      u.hash = "";
      links.add(u.href);
    } catch {
      /* invalid href */
    }
  });
  return {
    title: $("title").first().text().trim(),
    description: ($('meta[name="description" i]').attr("content") ?? "").trim(),
    canonical: ($('link[rel="canonical" i]').attr("href") ?? "").trim(),
    robots: ($('meta[name="robots" i]').attr("content") ?? "").toLowerCase().trim(),
    h1: $("h1").first().text().replace(/\s+/g, " ").trim(),
    links,
    words: countWords(extractVisibleText($)),
  };
}

export function compareRawAndRendered(raw: RenderSnapshot, rendered: RenderSnapshot, url: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const push = (id: string, name: string, severity: AuditIssue["severity"], message: string, details?: Record<string, unknown>) =>
    issues.push({ id, name, severity, category: "JavaScript", message, url, details });
  const noindex = (r: string) => /\bnoindex\b|\bnone\b/.test(r);

  if (noindex(raw.robots) && !noindex(rendered.robots)) {
    push(
      "js_removes_noindex",
      "noindex in raw HTML removed by JavaScript",
      "Error",
      "The raw HTML says noindex and JavaScript removes it. Google may skip rendering noindex pages, so this page is likely to stay out of the index.",
      { raw: raw.robots, rendered: rendered.robots }
    );
  } else if (!noindex(raw.robots) && noindex(rendered.robots)) {
    push("js_adds_noindex", "noindex added by JavaScript", "Warning", "JavaScript adds noindex after load. Crawlers that don't render will index the page; Google will drop it after rendering.", {
      raw: raw.robots,
      rendered: rendered.robots,
    });
  }

  if (raw.canonical && rendered.canonical && raw.canonical !== rendered.canonical) {
    push("js_changes_canonical", "Canonical changed by JavaScript", "Warning", `Raw HTML canonical "${raw.canonical}" becomes "${rendered.canonical}" after rendering. Conflicting canonicals make Google pick one itself.`, {
      raw: raw.canonical,
      rendered: rendered.canonical,
    });
  } else if (!raw.canonical && rendered.canonical) {
    push("js_only_canonical", "Canonical only present after rendering", "Notice", "The canonical link is injected by JavaScript. Put it in the server HTML so every crawler sees it.", {
      rendered: rendered.canonical,
    });
  }

  if (!raw.title && rendered.title) {
    push("js_only_title", "Title only present after rendering", "Warning", "The <title> is set by JavaScript. Crawlers and link previews that don't render see an empty title.");
  } else if (raw.title && rendered.title && raw.title !== rendered.title) {
    push("js_changes_title", "Title changed by JavaScript", "Notice", `Title "${raw.title}" becomes "${rendered.title}" after rendering.`, { raw: raw.title, rendered: rendered.title });
  }

  if (!raw.description && rendered.description) {
    push("js_only_description", "Meta description only present after rendering", "Notice", "The meta description is injected by JavaScript; non-rendering crawlers and social previews miss it.");
  }

  if (!raw.h1 && rendered.h1) {
    push("js_only_h1", "H1 only present after rendering", "Warning", "The main heading exists only after JavaScript runs.");
  }

  const jsOnlyLinks = [...rendered.links].filter((l) => !raw.links.has(l));
  if (jsOnlyLinks.length > 0 && jsOnlyLinks.length >= Math.max(5, rendered.links.size * 0.25)) {
    push(
      "js_only_links",
      "Links only discoverable after rendering",
      "Warning",
      `${jsOnlyLinks.length} of ${rendered.links.size} links appear only after JavaScript runs. Use real <a href> links in the server HTML so crawlers find these pages without rendering.`,
      { count: jsOnlyLinks.length, sample: jsOnlyLinks.slice(0, 10) }
    );
  }

  const added = rendered.words - raw.words;
  if (added >= 150 && rendered.words >= raw.words * 1.5) {
    push(
      "js_dependent_content",
      "Content relies on JavaScript",
      raw.words < 50 ? "Warning" : "Notice",
      `Raw HTML has ${raw.words} words; the rendered page has ${rendered.words}. Most content needs JavaScript, which delays or prevents indexing by crawlers that don't render.`,
      { rawWords: raw.words, renderedWords: rendered.words }
    );
  }

  return issues;
}

/** Entry point used by the page processor when both versions are available. */
export function jsRenderingIssues(rawHtml: string, rendered$: cheerio.CheerioAPI, url: string): AuditIssue[] {
  if (!rawHtml) return [];
  return compareRawAndRendered(snapshot(cheerio.load(rawHtml), url), snapshot(rendered$, url), url);
}
