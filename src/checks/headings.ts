/**
 * Heading structure checks — H1 integrity and heading hierarchy.
 */
import * as cheerio from "cheerio";
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

const H1_MAX_WORDS = 12;

export function headingChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { meta, pageUrl, html } = ctx;

  if (!html) return { issues };

  if (meta.h1Count === 0) {
    const msg = meta.h1InNoscriptOnly
      ? "H1 tag missing in primary DOM (detected inside <noscript> only). Search engines require a visible <h1> in the main body."
      : "The page has no <h1> tag or the tag is empty.";
    issues.push({
      id: "h1_missing",
      name: "H1 tag missing or empty",
      severity: "Error",
      category: "Headings",
      message: msg,
      url: pageUrl,
    });
  } else {
    if (meta.h1Count > 1) {
      issues.push({
        id: "h1_multiple",
        name: "Multiple H1 tags found",
        severity: "Warning",
        category: "Headings",
        message: `Page contains ${meta.h1Count} <h1> tags. Best practice is exactly one primary <h1> per document.`,
        url: pageUrl,
        details: { count: meta.h1Count },
      });
    }
    const words = (meta.h1Text || "").split(/\s+/).filter(Boolean).length;
    if (words > H1_MAX_WORDS) {
      issues.push({
        id: "h1_too_long",
        name: "H1 tag too long",
        severity: "Notice",
        category: "Headings",
        message: `H1 contains ${words} words. Keep the primary heading concise (≤ ${H1_MAX_WORDS} words).`,
        url: pageUrl,
        details: { words, h1: meta.h1Text },
      });
    }
  }

  if (meta.h2Count === 0 && meta.wordCount > 250) {
    issues.push({
      id: "h2_missing",
      name: "No H2 subheadings found",
      severity: "Warning",
      category: "Headings",
      message:
        "Page has no <h2> subheadings. Subheadings structure content for crawlers and AI answer engines.",
      url: pageUrl,
    });
  }

  // Heading hierarchy: detect skips (e.g. H1 → H3)
  const $ = cheerio.load(html);
  let lastLevel = 0;
  let skipped = false;
  $(":header").each((_, el) => {
    const tagName = (el.tagName || el.name || "").toLowerCase();
    const level = parseInt(tagName.replace("h", ""), 10);
    if (!level) return;
    if (lastLevel > 0 && level > lastLevel + 1) skipped = true;
    lastLevel = level;
  });
  if (skipped) {
    issues.push({
      id: "heading_hierarchy_skip",
      name: "Heading hierarchy skips a level",
      severity: "Notice",
      category: "Headings",
      message: "Headings skip a level (e.g. H1 directly to H3). Maintain a logical H1 → H2 → H3 structure.",
      url: pageUrl,
    });
  }

  return { issues };
}
