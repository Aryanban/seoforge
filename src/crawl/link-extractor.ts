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

    const anchorText = $(el).text().trim().replace(/\s+/g, " ");
    const rel = $(el).attr("rel")?.toLowerCase() || "";
    const nofollow = rel.includes("nofollow") || rel.includes("sponsored") || rel.includes("ugc");
    const isInternal = resolved.origin === base.origin;

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
      else if (node.children && !VISIBLE_TEXT_SKIP.has(String(node.name).toLowerCase())) walk(node.children);
    }
  };
  walk(htmlOrCheerio("body").toArray().flatMap((b: any) => b.children ?? []));
  const text = parts.join("").replace(/\s+/g, " ").trim();
  visibleTextCache.set(htmlOrCheerio, text);
  return text;
}

const VISIBLE_TEXT_SKIP = new Set(["script", "style", "noscript", "svg", "link", "meta", "template"]);
const visibleTextCache = new WeakMap<object, string>();

export function countWords(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
