/**
 * Link + image extraction from raw or rendered HTML.
 */
import * as cheerio from "cheerio";
import { LinkInfo, ImageInfo } from "../types.js";

const SKIP_PROTOCOLS = ["javascript:", "mailto:", "tel:", "data:", "blob:", "vbscript:"];

export interface ExtractedLinks {
  links: LinkInfo[];
  internalTargets: string[];
  externalTargets: string[];
}

export function extractLinks(html: string, pageUrl: string): ExtractedLinks {
  const $ = cheerio.load(html);
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

  return { links, internalTargets, externalTargets };
}

export function extractImages(html: string, pageUrl: string): ImageInfo[] {
  const $ = cheerio.load(html);
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

export function extractVisibleText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, link, meta, template").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

export function countWords(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
