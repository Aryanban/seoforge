/**
 * Document checks — favicon, lang parity, doctype, charset, deprecated HTML.
 * Screaming Frog Validation / Sitebulb parity for deterministic document hygiene.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";
import * as cheerio from "cheerio";

const DEPRECATED_TAGS = [
  "acronym", "applet", "basefont", "big", "blink", "center", "dir", "font",
  "frame", "frameset", "isindex", "marquee", "nobr", "noframes", "strike", "tt", "u",
];

export function documentChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { html, pageUrl, status } = ctx;
  if (!html || status === 0) return { issues };
  const $ = cheerio.load(html);

  const icon =
    $('link[rel="icon" i]').attr("href") ||
    $('link[rel="shortcut icon" i]').attr("href") ||
    $('link[rel="apple-touch-icon" i]').attr("href");
  if (!icon) {
    issues.push({
      id: "favicon_missing", name: "Page has no favicon", severity: "Notice", category: "Technical",
      message: "No favicon / touch-icon link found. Browsers request /favicon.ico anyway (wasted 404); SERPs and tabs show a blank icon.",
      url: pageUrl,
    });
  }

  const lang = ($("html").attr("lang") || "").trim();
  if (!lang) {
    issues.push({
      id: "html_lang_missing", name: "Missing html lang attribute", severity: "Warning", category: "Technical",
      message: "<html> has no lang attribute. Declare it (e.g. lang=\"en\" or lang=\"hi\") for screen readers, translation, and hreflang consistency.",
      url: pageUrl,
    });
  }

  const head = html.slice(0, 2048).toLowerCase();
  if (!head.includes("<!doctype html")) {
    issues.push({
      id: "doctype_missing", name: "Missing or non-HTML5 doctype", severity: "Notice", category: "Technical",
      message: "Document lacks an HTML5 <!DOCTYPE html> declaration; browsers may fall back to quirks mode.",
      url: pageUrl,
    });
  }

  const charset =
    $('meta[charset]').attr("charset") || $('meta[http-equiv="content-type" i]').attr("content");
  if (!charset) {
    issues.push({
      id: "charset_missing", name: "Missing character encoding declaration", severity: "Warning", category: "Technical",
      message: "No charset declared in the first 1024 bytes. Declare <meta charset=\"utf-8\"> first in <head> to avoid mojibake (critical for Indic scripts).",
      url: pageUrl,
    });
  }

  const foundDeprecated = DEPRECATED_TAGS.filter((t) => $(t).length > 0);
  if (foundDeprecated.length > 0) {
    issues.push({
      id: "deprecated_html", name: "Deprecated HTML tags in use", severity: "Notice", category: "Technical",
      message: `Deprecated presentational tags found: ${foundDeprecated.join(", ")}. Replace with CSS.`,
      url: pageUrl, details: { tags: foundDeprecated },
    });
  }

  const inlineHandlers = $("[onclick],[onload],[onerror],[onmouseover]").length;
  if (inlineHandlers > 10) {
    issues.push({
      id: "inline_event_handlers", name: "Excessive inline event handlers", severity: "Notice", category: "Performance",
      message: `${inlineHandlers} inline event-handler attributes bloat HTML and block CSP adoption. Move to external scripts.`,
      url: pageUrl, details: { count: inlineHandlers },
    });
  }

  const refresh = $('meta[http-equiv="refresh" i]').attr("content");
  if (refresh) {
    issues.push({
      id: "meta_refresh", name: "Meta refresh redirect in use", severity: "Warning", category: "Indexability",
      message: `Meta refresh found (content="${refresh}"). Use a server-side 301/308 instead; meta refresh is slow and unreliable for crawlers.`,
      url: pageUrl, details: { content: refresh },
    });
  }

  return { issues };
}
