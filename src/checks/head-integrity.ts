/**
 * Head integrity — detects invalid elements inside <head>.
 *
 * Google Search Central: "Google stops processing the head when it encounters
 * an invalid element", so meta robots / canonical / hreflang after it are ignored.
 * cheerio/parse5 silently move such elements into <body>, hiding the problem,
 * so this uses the raw htmlparser2 tokenizer instead.
 */
import { Parser } from "htmlparser2";
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

const ALLOWED_IN_HEAD = new Set(["title", "meta", "link", "script", "style", "base", "noscript", "template"]);
const OPAQUE_CONTAINERS = new Set(["noscript", "template"]);
const SEO_META_NAMES = new Set(["robots", "googlebot", "description"]);

export function analyzeHeadIntegrity(html: string): { breaker?: string; hiddenTags: string[] } {
  let headOpened = false;
  let done = false;
  let opaqueDepth = 0;
  let breaker: string | undefined;
  const hiddenTags: string[] = [];

  const parser = new Parser({
    onopentag(name, attribs) {
      if (done) return;
      if (name === "body") { done = true; return; }
      if (!headOpened) { if (name === "head") headOpened = true; return; }
      if (opaqueDepth > 0) { if (OPAQUE_CONTAINERS.has(name)) opaqueDepth++; return; }
      if (OPAQUE_CONTAINERS.has(name)) { opaqueDepth = 1; return; }
      if (breaker === undefined) {
        if (!ALLOWED_IN_HEAD.has(name)) breaker = name;
        return;
      }
      const hidden = seoTagLabel(name, attribs);
      if (hidden) hiddenTags.push(hidden);
    },
    onclosetag(name) {
      if (done || !headOpened) return;
      if (name === "head") { done = true; return; }
      if (opaqueDepth > 0 && OPAQUE_CONTAINERS.has(name)) opaqueDepth--;
    },
  });
  parser.write(html);
  parser.end();

  return { breaker, hiddenTags };
}

function seoTagLabel(name: string, attribs: Record<string, string>): string | undefined {
  if (name === "title") return "title";
  if (name === "meta") {
    const metaName = (attribs.name || "").toLowerCase();
    return SEO_META_NAMES.has(metaName) ? `meta[name=${metaName}]` : undefined;
  }
  if (name === "link") {
    const rel = (attribs.rel || "").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) return "link[rel=canonical]";
    if (rel.includes("alternate") && "hreflang" in attribs) return "link[rel=alternate][hreflang]";
  }
  return undefined;
}

export function headIntegrityChecks(ctx: PageCheckContext): CheckOutput {
  if (!ctx.html || ctx.status === 0 || ctx.status >= 300) return { issues: [] };
  const { breaker, hiddenTags } = analyzeHeadIntegrity(ctx.html);
  if (!breaker) return { issues: [] };

  const issues: AuditIssue[] = [];
  if (hiddenTags.length > 0) {
    issues.push({
      id: "head_broken_hides_seo_tags",
      name: "Invalid element in <head> hides SEO tags",
      severity: "Error",
      category: "Indexability",
      message: `<${breaker}> inside <head> ends the head early for Google; these tags after it are ignored: ${hiddenTags.join(", ")}. Move them above it or move the element into <body>.`,
      url: ctx.pageUrl,
      details: { breaker, hiddenTags },
    });
  } else {
    issues.push({
      id: "head_invalid_element",
      name: "Invalid element in <head>",
      severity: "Warning",
      category: "Technical",
      message: `<${breaker}> inside <head> is not valid there. Move it into <body>.`,
      url: ctx.pageUrl,
      details: { breaker, hiddenTags },
    });
  }
  return { issues };
}
