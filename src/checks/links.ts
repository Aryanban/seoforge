/**
 * Link checks — anchor text quality, internal nofollow leakage, link dilution.
 *
 * Note: broken-link and redirecting-link detection happens in the crawler's
 * post-crawl verification pass (see Crawler.applyLinkGraph), because target
 * status is only known after every page has been fetched.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

const GENERIC_ANCHORS = [
  "click here",
  "here",
  "read more",
  "learn more",
  "more",
  "link",
  "this link",
  "this page",
  "see more",
  "view more",
  "continue reading",
];
const MAX_LINKS_PER_PAGE = 100;

export function linkChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { links, pageUrl, html } = ctx;

  if (!html) return { issues };

  const totalLinks = links.links.length;

  // Generic / non-descriptive anchor text
  const genericAnchors = links.links.filter(
    (l) => l.anchorText && GENERIC_ANCHORS.includes(l.anchorText.toLowerCase())
  );
  if (genericAnchors.length > 0) {
    issues.push({
      id: "generic_anchor_text",
      name: "Non-descriptive anchor text",
      severity: "Notice",
      category: "Links",
      message: `${genericAnchors.length} link(s) use generic anchor text such as "click here" or "read more". Use descriptive keywords instead.`,
      url: pageUrl,
      details: { anchors: genericAnchors.slice(0, 10).map((l) => ({ anchor: l.anchorText, target: l.target })) },
    });
  }

  // Empty anchor text
  const emptyAnchors = links.links.filter((l) => !l.anchorText && !l.rawHref.startsWith("#"));
  if (emptyAnchors.length > 0) {
    issues.push({
      id: "empty_anchor_text",
      name: "Link with empty anchor text",
      severity: "Warning",
      category: "Links",
      message: `${emptyAnchors.length} link(s) have no anchor text. Add descriptive link text for accessibility and SEO.`,
      url: pageUrl,
      details: { targets: emptyAnchors.slice(0, 10).map((l) => l.target) },
    });
  }

  // Internal nofollow leakage
  const internalNofollow = links.links.filter((l) => l.isInternal && l.nofollow);
  if (internalNofollow.length > 0) {
    issues.push({
      id: "internal_nofollow",
      name: "Internal link with nofollow attribute",
      severity: "Warning",
      category: "Links",
      message: `${internalNofollow.length} internal link(s) carry rel="nofollow", which blocks internal link equity flow.`,
      url: pageUrl,
      details: { targets: internalNofollow.slice(0, 10).map((l) => l.target) },
    });
  }

  // Link dilution
  if (totalLinks > MAX_LINKS_PER_PAGE) {
    issues.push({
      id: "too_many_links",
      name: "Page has too many links",
      severity: "Warning",
      category: "Links",
      message: `Page contains ${totalLinks} links. Google recommends fewer than ${MAX_LINKS_PER_PAGE} links per page to preserve crawl efficiency and link equity.`,
      url: pageUrl,
      details: { count: totalLinks },
    });
  }

  return { issues };
}
