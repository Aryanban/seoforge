/**
 * Metadata checks — title, meta description, canonical, hreflang, OG, Twitter.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

const TITLE_MAX = 60;
const TITLE_MIN = 15;
const DESC_MAX = 160;
const DESC_MIN = 70;

export function metaChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { meta, pageUrl, html } = ctx;

  if (!html) return { issues };

  // Title
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
  }

  // Meta description
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
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) {
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
