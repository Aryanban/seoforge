/**
 * Link + image extraction from raw or rendered HTML.
 */
import * as cheerio from "cheerio";
import { LinkInfo, ImageInfo } from "../types.js";

const SKIP_PROTOCOLS = ["javascript:", "mailto:", "tel:", "data:", "blob:", "vbscript:"];

export interface HreflangPair {
  lang: string;
  href: string;
}

export interface ExtractedLinks {
  links: LinkInfo[];
  internalTargets: string[];
  externalTargets: string[];
  hreflang: HreflangPair[];
}

export function extractLinks(htmlOrCheerio: string | cheerio.CheerioAPI, pageUrl: string): ExtractedLinks {
  const $ = typeof htmlOrCheerio === "string" ? cheerio.load(htmlOrCheerio) : htmlOrCheerio;
  const links: LinkInfo[] = [];
  const internalTargets: string[] = [];
  const externalTargets: string[] = [];

  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    base = new URL("https://example.com");
  }
  // Internal = same origin as the page itself, even when <base href> points elsewhere (e.g. a CDN).
  const pageOrigin = base.origin;

  // Honor <base href>
  const baseHref = $("base").attr("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, base);
    } catch {
      /* keep original */
    }
  }

  $("a[href]").each((_, el) => {
    const rawHref = $(el).attr("href")?.trim();
    if (!rawHref) return;
    if (SKIP_PROTOCOLS.some((p) => rawHref.toLowerCase().startsWith(p))) return;
    if (rawHref.startsWith("#")) return;

    let resolved: URL;
    try {
      resolved = new URL(rawHref, base.href);
    } catch {
      return;
    }

    // Text, else the accessible name: aria-label, then image alt (Google uses alt as anchor text).
    const $el = $(el);
    const anchorText = (
      $el.text().trim() ||
      $el.attr("aria-label")?.trim() ||
      $el.find("img[alt]").first().attr("alt")?.trim() ||
      ""
    ).replace(/\s+/g, " ");
    const rel = $el.attr("rel")?.toLowerCase() || "";
    const relTokens = rel.split(/\s+/);
    const nofollow = relTokens.includes("nofollow") || relTokens.includes("sponsored") || relTokens.includes("ugc");
    const isInternal = resolved.origin === pageOrigin;

    links.push({
      source: pageUrl,
      target: resolved.href,
      rawHref,
      anchorText,
      rel,
      nofollow,
      isInternal,
      element: "a",
    });

    if (isInternal) internalTargets.push(resolved.href);
    else externalTargets.push(resolved.href);
  });

  const hreflang: HreflangPair[] = [];
  $("link[rel=\"alternate\"][hreflang]").each((_, el) => {
    const lang = $(el).attr("hreflang")?.trim();
    const href = $(el).attr("href")?.trim();
    if (lang && href) {
      try {
        hreflang.push({ lang, href: new URL(href, base.href).href });
      } catch { hreflang.push({ lang, href }); }
    }
  });

  return { links, internalTargets, externalTargets, hreflang };
}

export function extractImages(htmlOrCheerio: string | cheerio.CheerioAPI, pageUrl: string): ImageInfo[] {
  const $ = typeof htmlOrCheerio === "string" ? cheerio.load(htmlOrCheerio) : htmlOrCheerio;
  const images: ImageInfo[] = [];

  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    base = new URL("https://example.com");
  }

  $("img").each((_, el) => {
    const src = $(el).attr("src")?.trim() || $(el).attr("data-src")?.trim();
    if (!src) return;
    if (SKIP_PROTOCOLS.some((p) => src.toLowerCase().startsWith(p))) return;

    let resolved: URL;
    try {
      resolved = new URL(src, base.href);
    } catch {
      return;
    }

    const alt = $(el).attr("alt");
    const widthAttr = $(el).attr("width");
    const heightAttr = $(el).attr("height");
    const width = widthAttr ? parseInt(widthAttr, 10) : undefined;
    const height = heightAttr ? parseInt(heightAttr, 10) : undefined;

    // Detect image used as a link with no anchor text
    const parent = $(el).closest("a");
    const inLink = parent.length > 0 && !parent.text().trim();

    images.push({
      page: pageUrl,
      url: resolved.href,
      src,
      alt,
      width,
      height,
      hasDimensions: !!(width && height),
      inLink,
    });
  });

  return images;
}

export function extractVisibleText(htmlOrCheerio: string | cheerio.CheerioAPI): string {
  if (typeof htmlOrCheerio === "string") {
    const $ = cheerio.load(htmlOrCheerio);
    $("script, style, noscript, svg, link, meta, template").remove();
    return $("body").text().replace(/\s+/g, " ").trim();
  }
  // Non-mutating walk (no DOM clone) + per-document cache: the crawler and the
  // word-count check both ask for this text, so it is computed once per page.
  const cached = visibleTextCache.get(htmlOrCheerio);
  if (cached !== undefined) return cached;
  const parts: string[] = [];
  const walk = (nodes: any[]): void => {
    for (const node of nodes) {
      if (node.type === "text") parts.push(node.data);
      else if (node.children && !VISIBLE_TEXT_SKIP.has(String(node.name).toLowerCase())) {
        walk(node.children);
        if (BLOCK_TAGS.has(String(node.name).toLowerCase())) parts.push(" ");
      }
    }
  };
  walk(htmlOrCheerio("body").toArray().flatMap((b: any) => b.children ?? []));
  const text = parts.join("").replace(/\s+/g, " ").trim();
  visibleTextCache.set(htmlOrCheerio, text);
  return text;
}

const VISIBLE_TEXT_SKIP = new Set(["script", "style", "noscript", "svg", "link", "meta", "template"]);
const visibleTextCache = new WeakMap<object, string>();
// Block boundaries separate words: "<h1>Title</h1><p>Body</p>" is two words, not "TitleBody".
const BLOCK_TAGS = new Set(
  "address article aside blockquote br dd details div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul option button label".split(" ")
);

// Page chrome left out of main content (Screaming Frog's default content area
// also excludes nav and footer). Elements and their ARIA landmark roles.
const CHROME_TAGS = new Set(["nav", "header", "footer", "aside"]);
const CHROME_ROLES = new Set(["navigation", "banner", "contentinfo", "complementary", "search"]);
const mainTextCache = new WeakMap<object, string>();

/**
 * Main-content text for word count and duplicate detection: the single
 * <main>/[role=main] element when there is one, else <body> without
 * header/nav/footer/aside landmarks. Falls back to all visible text when that
 * leaves nothing. Cheap DOM heuristic, no Readability/jsdom on the hot path.
 */
export function extractMainText($: cheerio.CheerioAPI): string {
  const cached = mainTextCache.get($);
  if (cached !== undefined) return cached;
  const main = $('main, [role="main"]');
  const roots = main.length === 1 ? main.toArray() : $("body").toArray();
  const parts: string[] = [];
  const walk = (nodes: any[]): void => {
    for (const node of nodes) {
      if (node.type === "text") {
        parts.push(node.data);
        continue;
      }
      if (!node.children) continue;
      const name = String(node.name).toLowerCase();
      if (VISIBLE_TEXT_SKIP.has(name)) continue;
      // Inside <main>, keep its own <header> (often the H1); drop nav/aside/footer.
      if (CHROME_TAGS.has(name) && !(main.length === 1 && name === "header")) continue;
      if (CHROME_ROLES.has(String(node.attribs?.role ?? "").toLowerCase())) continue;
      walk(node.children);
      if (BLOCK_TAGS.has(name)) parts.push(" ");
    }
  };
  walk(roots.flatMap((r: any) => r.children ?? []));
  const text = parts.join("").replace(/\s+/g, " ").trim() || extractVisibleText($);
  mainTextCache.set($, text);
  return text;
}

export function countWords(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
