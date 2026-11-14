/**
 * CPU half of crawling one page: parse HTML once, extract links/images/text,
 * run every registered check, apply custom extractors. Pure and cloneable in
 * and out, so it runs either inline or on a worker thread (page-worker.ts).
 */
import * as cheerio from "cheerio";
import { AuditIssue, CoreWebVitals, ImageInfo, PageAuditResult } from "../types.js";
import { extractLinks, extractImages, extractMainText, ExtractedLinks } from "./link-extractor.js";
import { runPageChecks } from "../checks/registry.js";
import { extractCustomFields } from "../analysis/custom-extractor.js";
import { duplicateFeatures, DuplicateFeatures } from "../analysis/duplicates.js";

export interface PageTask {
  url: string;
  depth: number;
  sourceUrl?: string;
  finalUrl: string;
  html: string;
  status: number;
  responseTimeMs: number;
  ttfbMs?: number;
  rendered: boolean;
  headers: Record<string, string>;
  cwv?: CoreWebVitals;
  contentLengthBytes?: number;
  isRedirect: boolean;
  redirectChain: string[];
  isHttpToHttpsRedirect: boolean;
  redirectStatusCode?: number;
  /** Raw server HTML when html is the rendered DOM. */
  rawHtml?: string;
  axe?: import("./renderer.js").AxeViolation[];
  /** Resolved crawl options minus large seed lists (cloned per task). */
  options: any;
}

export interface PageTaskResult {
  page: PageAuditResult;
  issues: AuditIssue[];
  links: ExtractedLinks;
  images: ImageInfo[];
  /** Duplicate-detection hashes (instead of keeping the ~20 KB body text per page). */
  dup: DuplicateFeatures | null;
}

const EMPTY_SET = new Set<string>();

export function processPage(t: PageTask): PageTaskResult {
  const $ = t.html ? cheerio.load(t.html) : null;
  const links = $
    ? extractLinks($, t.finalUrl)
    : { links: [], internalTargets: [], externalTargets: [], hreflang: [] };
  const images = $ ? extractImages($, t.finalUrl) : [];
  const bodyText = $ ? extractMainText($) : "";
  const opts = t.options;

  const { page, issues } = runPageChecks({
    pageUrl: t.url,
    finalUrl: t.finalUrl,
    html: t.html,
    $: $ ?? undefined,
    status: t.status,
    responseTimeMs: t.responseTimeMs,
    ttfbMs: t.ttfbMs,
    depth: t.depth,
    rendered: t.rendered,
    headers: t.headers,
    links,
    images,
    // No check reads robots rules or the sitemap set; both stay on the main thread.
    robots: null,
    options: opts,
    thresholds: opts.thresholds,
    expectedEntities: opts.expectedEntities,
    canonicalPolicy: opts.canonicalPolicy,
    cwv: t.cwv,
    contentLengthBytes: t.contentLengthBytes,
    sitemapUrls: EMPTY_SET,
    sourceUrl: t.sourceUrl,
    isRedirect: t.isRedirect,
    redirectChain: t.redirectChain,
    isHttpToHttpsRedirect: t.isHttpToHttpsRedirect,
    redirectStatusCode: t.redirectStatusCode,
    rawHtml: t.rawHtml,
    axe: t.axe,
  });
  if (opts.customExtractors?.length && t.html) {
    page.customExtractions = extractCustomFields(t.html, opts.customExtractors);
  }
  const dup = t.status === 200 && bodyText ? duplicateFeatures(bodyText) : null;
  return { page, issues, links, images, dup };
}
