/**
 * Metadata checks — title, meta description, canonical, hreflang, OG, Twitter.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";
import { titlePixelWidth, descriptionPixelWidth } from "../analysis/serp.js";

/**
 * Meta thresholds — aligned to Screaming Frog's published Issues cutoffs
 * (screamingfrog.co.uk/seo-spider/issues/page-titles/ + /meta-description/):
 * title: missing/multiple/outside-head Issue · duplicate Opportunity ·
 * >60 chars / <30 chars Opportunity · >561px / <200px Opportunity ·
 * same-as-H1 Opportunity
 * description: multiple/outside-head Issue · missing/duplicate Opportunity ·
 * >155 chars / <70 chars Opportunity · >985px / <400px Opportunity
 */
const TITLE_MAX = 60;
const TITLE_MIN = 30;
const DESC_MAX = 155;
const DESC_MIN = 70;

export function metaChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { meta, pageUrl, html } = ctx;

  if (!html) return { issues };

  // Title
  const titleCount = meta.titleCount ?? (meta.title ? 1 : 0);
  if (!meta.title) {
    issues.push({
      id: "title_missing",
      name: "Title tag missing or empty",
      severity: "Error",
      category: "Meta",
      message: "The page has no <title> tag or the title is empty.",
      url: pageUrl,
    });
  } else {
    if (titleCount > 1) {
      issues.push({
        id: "title_multiple",
        name: "Multiple title tags",
        severity: "Error",
        category: "Meta",
        message: `Page contains ${titleCount} <title> elements. Keep exactly one inside <head>.`,
        url: pageUrl,
        details: { count: titleCount },
      });
    }
    if (meta.titleOutsideHead) {
      issues.push({
        id: "title_outside_head",
        name: "Title tag outside <head>",
        severity: "Error",
        category: "Meta",
        message: "The <title> element was found outside <head>. Crawlers may ignore it.",
        url: pageUrl,
      });
    }
    if (meta.titleLength! > TITLE_MAX) {
      issues.push({
        id: "title_too_long",
        name: "Title tag too long",
        severity: "Warning",
        category: "Meta",
        message: `Title is ${meta.titleLength} characters; Google truncates titles beyond ${TITLE_MAX} characters.`,
        url: pageUrl,
        details: { length: meta.titleLength },
      });
    } else if (meta.titleLength! < TITLE_MIN) {
      issues.push({
        id: "title_too_short",
        name: "Title tag too short",
        severity: "Notice",
        category: "Meta",
        message: `Title is only ${meta.titleLength} characters. Use ${TITLE_MIN}–${TITLE_MAX} characters to include target keywords.`,
        url: pageUrl,
        details: { length: meta.titleLength },
      });
    }
    const titlePx = titlePixelWidth(meta.title);
    if (titlePx > 561) {
      issues.push({
        id: "title_too_wide",
        name: "Title too wide for SERP display",
        severity: "Notice",
        category: "Meta",
        message: `Title renders at ~${titlePx}px; Google truncates beyond ~561px. Shorten or front-load keywords.`,
        url: pageUrl,
        details: { pixels: titlePx },
      });
    } else if (titlePx < 200 && meta.titleLength! >= TITLE_MIN) {
      issues.push({
        id: "title_too_narrow",
        name: "Title unusually narrow",
        severity: "Notice",
        category: "Meta",
        message: `Title renders at only ~${titlePx}px (< 200px). There is room to add descriptive keywords.`,
        url: pageUrl,
        details: { pixels: titlePx },
      });
    }
    if (meta.h1Text && meta.title.trim().toLowerCase() === meta.h1Text.trim().toLowerCase()) {
      issues.push({
        id: "title_same_as_h1",
        name: "Title identical to H1",
        severity: "Notice",
        category: "Meta",
        message: "Title tag duplicates the H1 verbatim. Differentiate them to cover more query variants.",
        url: pageUrl,
      });
    }
  }

  // Meta description
  const descCount = meta.descriptionCount ?? (meta.description ? 1 : 0);
  if (!meta.description) {
    issues.push({
      id: "meta_desc_missing",
      name: "Meta description missing or empty",
      severity: "Warning",
      category: "Meta",
      message: "The page has no meta description tag.",
      url: pageUrl,
    });
  } else {
    if (descCount > 1) {
      issues.push({
        id: "meta_desc_multiple",
        name: "Multiple meta descriptions",
        severity: "Error",
        category: "Meta",
        message: `Page contains ${descCount} meta description tags. Keep exactly one inside <head>.`,
        url: pageUrl,
        details: { count: descCount },
      });
    }
    if (meta.descriptionOutsideHead) {
      issues.push({
        id: "meta_desc_outside_head",
        name: "Meta description outside <head>",
        severity: "Error",
        category: "Meta",
        message: "The meta description was found outside <head>. Crawlers may ignore it.",
        url: pageUrl,
      });
    }
    if (meta.descriptionLength! > DESC_MAX) {
      issues.push({
        id: "meta_desc_too_long",
        name: "Meta description too long",
        severity: "Warning",
        category: "Meta",
        message: `Description is ${meta.descriptionLength} characters; search engines truncate beyond ${DESC_MAX} characters.`,
        url: pageUrl,
        details: { length: meta.descriptionLength },
      });
    } else if (meta.descriptionLength! < DESC_MIN) {
      issues.push({
        id: "meta_desc_too_short",
        name: "Meta description too short",
        severity: "Notice",
        category: "Meta",
        message: `Description is only ${meta.descriptionLength} characters. Aim for ${DESC_MIN}–${DESC_MAX} characters with a clear value proposition.`,
        url: pageUrl,
        details: { length: meta.descriptionLength },
      });
    }
    const descPx = descriptionPixelWidth(meta.description);
    if (descPx > 985) {
      issues.push({
        id: "meta_desc_too_wide",
        name: "Meta description too wide for SERP display",
        severity: "Notice",
        category: "Meta",
        message: `Description renders at ~${descPx}px; Google truncates beyond ~985px.`,
        url: pageUrl,
        details: { pixels: descPx },
      });
    }
  }

  // Canonical
  if (!meta.canonical) {
    if (ctx.thresholds?.requireCanonical !== false) {
      issues.push({
        id: "canonical_missing",
        name: "Canonical tag missing",
        severity: "Warning",
        category: "Meta",
        message: "Missing <link rel='canonical'> tag in <head>.",
        url: pageUrl,
      });
    }
  } else if (!meta.canonicalMatches) {
    issues.push({
      id: "canonical_mismatch",
      name: "Canonical URL mismatch",
      severity: "Warning",
      category: "Meta",
      message: `Declared canonical '${meta.canonical}' does not match requested URL '${pageUrl}'.`,
      url: pageUrl,
      details: { canonical: meta.canonical },
    });
  }

  // Open Graph
  if (meta.openGraph.incomplete) {
    issues.push({
      id: "og_tags_incomplete",
      name: "Open Graph tags incomplete",
      severity: "Warning",
      category: "Meta",
      message: `Missing essential Open Graph properties: ${meta.openGraph.missingKeys.join(", ")}.`,
      url: pageUrl,
      details: { missing: meta.openGraph.missingKeys },
    });
  }

  // Twitter Card
  if (meta.twitterCard.incomplete) {
    issues.push({
      id: "twitter_card_incomplete",
      name: "Twitter Card tags incomplete",
      severity: "Notice",
      category: "Meta",
      message: "Missing twitter:card, twitter:title, or twitter:image tags for social sharing previews.",
      url: pageUrl,
    });
  }

  // hreflang
  if (meta.hreflang.length === 0 && html.includes('rel="alternate"')) {
    issues.push({
      id: "hreflang_missing",
      name: "hreflang annotations missing",
      severity: "Notice",
      category: "Meta",
      message: "Page has alternate language links without hreflang attributes.",
      url: pageUrl,
    });
  }
  for (const lang of meta.hreflang) {
    // BCP 47 language[-script][-region] (e.g. en, en-IN, zh-Hant-TW, es-419) or the
    // special x-default value Google documents for fallback pages.
    if (!/^(?:[a-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?|x-default)$/i.test(lang)) {
      issues.push({
        id: "hreflang_invalid",
        name: "Invalid hreflang value",
        severity: "Warning",
        category: "Meta",
        message: `hreflang value '${lang}' is not a valid language/region code (e.g. 'en', 'en-US').`,
        url: pageUrl,
        details: { value: lang },
      });
    }
  }

  return { issues };
}
