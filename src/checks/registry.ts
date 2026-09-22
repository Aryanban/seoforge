/**
 * Page check registry — extracts page metadata once, then runs every audit
 * check module against a shared PageCheckContext.
 */
import * as cheerio from "cheerio";
import {
  AuditIssue,
  AeoScoreResult,
  CanonicalPolicy,
  CrawlOptions,
  CoreWebVitals,
  ImageInfo,
  IssueSeverity,
  SchemaValidationResult,
} from "../types.js";
import { ExtractedLinks } from "../crawl/link-extractor.js";
import { RobotsCheckResult } from "../crawl/robots.js";
import { countWords, extractVisibleText } from "../crawl/link-extractor.js";
import { validateSchemaOrg } from "./schema-engine.js";
import { evaluateAeo } from "./aeo-engine.js";
import { metaChecks } from "./meta.js";
import { headingChecks } from "./headings.js";
import { contentChecks } from "./content.js";
import { statusIndexabilityChecks } from "./status-indexability.js";
import { linkChecks } from "./links.js";
import { imageChecks } from "./images.js";
import { performanceChecks } from "./performance.js";
import { technicalChecks } from "./technical.js";
import { schemaChecks } from "./schema.js";
import { aeoChecks } from "./aeo.js";

export type { Thresholds } from "../types.js";
import type { Thresholds } from "../types.js";

export interface PageMeta {
  title?: string;
  titleLength?: number;
  description?: string;
  descriptionLength?: number;
  canonical?: string;
  canonicalMatches: boolean;
  isSpaCanonicalValid?: boolean;
  h1Count: number;
  h1Text?: string;
  h2Count: number;
  h1InNoscriptOnly?: boolean;
  wordCount: number;
  hreflang: string[];
  openGraph: {
    title?: string;
    description?: string;
    image?: string;
    url?: string;
    type?: string;
    incomplete: boolean;
    missingKeys: string[];
  };
  twitterCard: {
    card?: string;
    title?: string;
    description?: string;
    image?: string;
    incomplete: boolean;
  };
  isIndexable: boolean;
  robotsNoindex: boolean;
  xRobotsNoindex: boolean;
  schema: SchemaValidationResult;
  aeo: AeoScoreResult;
}

export interface PageCheckContext {
  pageUrl: string;
  finalUrl: string;
  html: string;
  status: number;
  responseTimeMs: number;
  ttfbMs?: number;
  depth: number;
  rendered: boolean;
  headers: Record<string, string>;
  links: ExtractedLinks;
  images: ImageInfo[];
  robots: RobotsCheckResult | null;
  options: CrawlOptions & { [key: string]: any };
  thresholds: Thresholds | undefined;
  expectedEntities: string[];
  canonicalPolicy: CanonicalPolicy;
  cwv?: CoreWebVitals;
  sitemapUrls: Set<string>;
  sourceUrl?: string;
  meta: PageMeta;
  isRedirect: boolean;
  redirectChain: string[];
  isHttpToHttpsRedirect: boolean;
}

export interface CheckOutput {
  issues: AuditIssue[];
}

export type PageCheck = (ctx: PageCheckContext) => CheckOutput;

const REGISTERED_CHECKS: Array<{ name: string; run: PageCheck }> = [];

export function registerCheck(name: string, run: PageCheck): void {
  REGISTERED_CHECKS.push({ name, run });
}

export function listChecks(): string[] {
  return REGISTERED_CHECKS.map((c) => c.name);
}

/* ------------------------------------------------------------------ */
/* Metadata extraction                                                 */
/* ------------------------------------------------------------------ */

function normalizeForCompare(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    parsed.search = "";
    let p = parsed.pathname;
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return `${parsed.origin}${p}`.toLowerCase();
  } catch {
    return rawUrl.toLowerCase().trim().replace(/\/$/, "");
  }
}

export function extractPageMeta(
  html: string,
  pageUrl: string,
  finalUrl: string,
  headers: Record<string, string>,
  expectedEntities: string[],
  canonicalPolicy: CanonicalPolicy
): PageMeta {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim();
  const description = $('meta[name="description"]').attr("content")?.trim();

  const canonical = $('link[rel="canonical"]').attr("href")?.trim();
  const normRequested = normalizeForCompare(finalUrl || pageUrl);
  const normCanonical = canonical ? normalizeForCompare(canonical) : undefined;
  let canonicalMatches = false;
  let isSpaCanonicalValid = false;

  if (canonical && normCanonical) {
    canonicalMatches = normRequested === normCanonical;
    if (!canonicalMatches && canonicalPolicy === "spa") {
      try {
        const pu = new URL(finalUrl || pageUrl);
        const pc = new URL(canonical);
        if (pu.origin === pc.origin && pc.pathname === "/") {
          canonicalMatches = true;
          isSpaCanonicalValid = true;
        }
      } catch {
        /* keep strict */
      }
    }
  }

  // H1 counting — Ahrefs standard: H1 inside <noscript> does not count
  const mainDom = cheerio.load(html);
  mainDom("noscript").remove();
  const domH1s = mainDom("h1");
  const h1Count = domH1s.length;
  const h1Text = h1Count > 0 ? domH1s.first().text().trim() : undefined;
  const allH1s = $("h1");
  // cheerio parses <noscript> content as raw text, so an H1 that only exists
  // inside a <noscript> fallback never surfaces as a DOM node. Scan the source.
  const h1InNoscriptOnly =
    h1Count === 0 && (allH1s.length > 0 || /<noscript[^>]*>[\s\S]*?<h1[\s>]/i.test(html));

  const hreflang: string[] = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr("hreflang");
    if (lang) hreflang.push(lang);
  });

  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim();
  const ogUrl = $('meta[property="og:url"]').attr("content")?.trim();
  const ogType = $('meta[property="og:type"]').attr("content")?.trim();
  const missingOgKeys: string[] = [];
  if (!ogTitle) missingOgKeys.push("og:title");
  if (!ogDesc) missingOgKeys.push("og:description");
  if (!ogImage) missingOgKeys.push("og:image");
  if (!ogUrl) missingOgKeys.push("og:url");

  const twitterCardTag = $('meta[name="twitter:card"]').attr("content")?.trim();
  const twitterTitle = $('meta[name="twitter:title"]').attr("content")?.trim();
  const twitterDesc = $('meta[name="twitter:description"]').attr("content")?.trim();
  const twitterImage = $('meta[name="twitter:image"]').attr("content")?.trim();

  const robotsMeta = $('meta[name="robots"]').attr("content")?.toLowerCase() || "";
  const robotsNoindex = robotsMeta.includes("noindex");
  const xRobots = (headers["x-robots-tag"] || "").toLowerCase();
  const xRobotsNoindex = xRobots.includes("noindex");

  const schema = validateSchemaOrg(html, expectedEntities);
  const aeo = evaluateAeo(html);

  return {
    title,
    titleLength: title.length,
    description,
    descriptionLength: description?.length,
    canonical,
    canonicalMatches,
    isSpaCanonicalValid,
    h1Count,
    h1Text,
    h2Count: $("h2").length,
    h1InNoscriptOnly,
    wordCount: countWords(extractVisibleText(html)),
    hreflang,
    openGraph: {
      title: ogTitle,
      description: ogDesc,
      image: ogImage,
      url: ogUrl,
      type: ogType,
      incomplete: missingOgKeys.length > 0,
      missingKeys: missingOgKeys,
    },
    twitterCard: {
      card: twitterCardTag,
      title: twitterTitle,
      description: twitterDesc,
      image: twitterImage,
      incomplete: !twitterCardTag || !twitterTitle || !twitterImage,
    },
    isIndexable: !robotsNoindex && !xRobotsNoindex,
    robotsNoindex,
    xRobotsNoindex,
    schema,
    aeo,
  };
}

/* ------------------------------------------------------------------ */
/* Check orchestration                                                 */
/* ------------------------------------------------------------------ */

registerCheck("status-indexability", statusIndexabilityChecks);
registerCheck("meta", metaChecks);
registerCheck("headings", headingChecks);
registerCheck("content", contentChecks);
registerCheck("links", linkChecks);
registerCheck("images", imageChecks);
registerCheck("performance", performanceChecks);
registerCheck("technical", technicalChecks);
registerCheck("schema", schemaChecks);
registerCheck("aeo", aeoChecks);

export interface PageCheckResult {
  page: import("../types.js").PageAuditResult;
  issues: AuditIssue[];
}

export function runPageChecks(ctx: Omit<PageCheckContext, "meta">): PageCheckResult {
  const hasHtml = ctx.html && ctx.html.length > 0;
  const meta = hasHtml
    ? extractPageMeta(
        ctx.html,
        ctx.pageUrl,
        ctx.finalUrl,
        ctx.headers,
        ctx.expectedEntities,
        ctx.canonicalPolicy
      )
    : emptyPageMeta(ctx.expectedEntities);

  const fullCtx: PageCheckContext = { ...ctx, meta };

  const issues: AuditIssue[] = [];
  for (const check of REGISTERED_CHECKS) {
    try {
      const out = check.run(fullCtx);
      issues.push(...out.issues);
    } catch (err: any) {
      issues.push({
        id: "check_error",
        name: `Check "${check.name}" failed`,
        severity: "Notice",
        category: "Technical",
        message: err.message,
        url: ctx.pageUrl,
      });
    }
  }

  const incoming = ctx.options.__incomingLinks as string[] | undefined;
  const page = buildPageResult(fullCtx, issues);

  if (incoming) page.incomingInternalLinks = incoming;

  return { page, issues };
}

function emptyPageMeta(expectedEntities: string[]): PageMeta {
  return {
    canonicalMatches: false,
    h1Count: 0,
    h2Count: 0,
    wordCount: 0,
    hreflang: [],
    openGraph: { incomplete: true, missingKeys: ["all"] },
    twitterCard: { incomplete: true },
    isIndexable: false,
    robotsNoindex: false,
    xRobotsNoindex: false,
    schema: {
      hasJsonLd: false,
      typesFound: [],
      missingExpected: expectedEntities,
      googleRichResultsErrors: [],
      schemaOrgErrors: [],
      errors: [],
      rawGraphCount: 0,
    },
    aeo: {
      score: 0,
      h1Count: 0,
      h2Count: 0,
      hasInvertedPyramidSnippet: false,
      tableCount: 0,
      hasFaqSchema: false,
      recommendations: [],
    },
  };
}

function buildPageResult(ctx: PageCheckContext, issues: AuditIssue[]): import("../types.js").PageAuditResult {
  const { meta, pageUrl, finalUrl, status, responseTimeMs, ttfbMs, depth, rendered, links, images, cwv } = ctx;
  return {
    url: pageUrl,
    normalizedUrl: normalizeForCompare(finalUrl || pageUrl),
    finalUrl,
    status,
    responseTimeMs,
    ttfbMs,
    depth,
    rendered,
    canonical: meta.canonical,
    canonicalMatches: meta.canonicalMatches,
    isSpaCanonicalValid: meta.isSpaCanonicalValid,
    title: meta.title,
    titleLength: meta.titleLength,
    description: meta.description,
    descriptionLength: meta.descriptionLength,
    wordCount: meta.wordCount,
    h1Count: meta.h1Count,
    h1Text: meta.h1Text,
    h2Count: meta.h2Count,
    h1InNoscriptOnly: meta.h1InNoscriptOnly,
    openGraph: meta.openGraph,
    twitterCard: meta.twitterCard,
    hreflang: meta.hreflang,
    incomingInternalLinks: [],
    outgoingInternalLinks: links.internalTargets,
    externalLinks: links.externalTargets,
    images,
    isOrphan: false,
    internalLinkScore: 0,
    redirectChain: ctx.redirectChain,
    isRedirect: ctx.isRedirect,
    isHttpToHttpsRedirect: ctx.isHttpToHttpsRedirect,
    isIndexable: meta.isIndexable,
    blockedByRobots: false,
    schema: meta.schema,
    aeo: meta.aeo,
    cwv,
    issues: issues.map((i) => `[${i.severity}] ${i.name}${i.message ? ": " + i.message : ""}`),
    auditIssues: issues,
  };
}

export function severityWeight(sev: IssueSeverity): number {
  return sev === "Error" ? 3 : sev === "Warning" ? 2 : 1;
}
