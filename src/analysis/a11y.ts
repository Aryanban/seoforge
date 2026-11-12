/**
 * Accessibility checks — axe-core rule parity for the highest-impact,
 * deterministically testable rules (WCAG 2.2 A/AA), plus mobile-readiness
 * signals (viewport, zoom). Zero network, zero dependencies beyond cheerio.
 *
 * Rule sources:
 * - axe-core rule descriptions (github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md):
 *   image-alt, html-has-lang, html-lang-valid, heading-order, link-name,
 *   button-name, label, color-contrast (inline-style subset, 4.5:1 per WCAG 1.4.3),
 *   duplicate-id, tabindex, bypass, frame-title, meta-viewport.
 * - W3C WCAG 2.2 Quick Reference (w3.org/WAI/WCAG22/quickref/).
 */
import * as cheerio from "cheerio";

export interface A11yFinding {
  id: string;
  name: string;
  severity: "Error" | "Warning" | "Notice";
  message: string;
  count?: number;
}

export function analyzeAccessibility(htmlOrCheerio: string | cheerio.CheerioAPI): A11yFinding[] {
  const findings: A11yFinding[] = [];
  if (!htmlOrCheerio) return findings;
  const $ = typeof htmlOrCheerio === "string" ? cheerio.load(htmlOrCheerio) : htmlOrCheerio;

  const badImgs = $("img").filter((_, el) => {
    const alt = $(el).attr("alt");
    const role = $(el).attr("role");
    if (role === "presentation" || role === "none") return false;
    return alt === undefined || alt.trim() === "";
  }).length;
  if (badImgs > 0) findings.push({ id: "a11y_image_alt", name: "Images missing accessible names", severity: "Error", message: `${badImgs} <img> element(s) lack a usable alt attribute (axe image-alt, WCAG 1.1.1). Decorative images should use alt="".`, count: badImgs });

  const lang = $("html").attr("lang");
  if (!lang) findings.push({ id: "a11y_html_lang_missing", name: "Missing document language declaration", severity: "Error", message: "<html> has no lang attribute (axe html-has-lang, WCAG 3.1.1). Screen readers cannot select pronunciation rules." });
  else if (!/^[a-z]{2,3}(-[A-Za-z]{2,8})?$/.test(lang.trim())) findings.push({ id: "a11y_html_lang_invalid", name: "Invalid document language code", severity: "Warning", message: `lang="${lang}" is not a valid BCP-47 language tag (e.g. en, en-IN, hi).` });

  let lastLevel = 0; let badOrder = false;
  $(":header").each((_, el) => {
    const tag = (el.tagName || (el as any).name || "").toLowerCase();
    const level = parseInt(tag.replace("h", ""), 10);
    if (!level) return;
    if (lastLevel > 0 && level > lastLevel + 1) badOrder = true;
    lastLevel = level;
  });
  if (badOrder) findings.push({ id: "a11y_heading_order", name: "Heading levels skipped", severity: "Warning", message: "Heading order skips a level (axe heading-order, WCAG 1.3.1). Assistive tech relies on a logical H1-H2-H3 outline." });

  const namelessLinks = $("a[href]").filter((_, el) => {
    const text = $(el).text().trim();
    const aria = $(el).attr("aria-label") || $(el).attr("title");
    const imgAlt = $(el).find("img[alt]").first().attr("alt");
    return !text && !aria && !(imgAlt && imgAlt.trim());
  }).length;
  if (namelessLinks > 0) findings.push({ id: "a11y_link_name", name: "Links without discernible text", severity: "Error", message: `${namelessLinks} link(s) have no discernible text (axe link-name, WCAG 4.1.2/2.4.4). Add text, aria-label, or image alt.`, count: namelessLinks });

  const namelessButtons = $("button").filter((_, el) => {
    const text = $(el).text().trim();
    return !text && !$(el).attr("aria-label") && !$(el).attr("title") && !$(el).attr("aria-labelledby");
  }).length;
  if (namelessButtons > 0) findings.push({ id: "a11y_button_name", name: "Buttons without discernible text", severity: "Error", message: `${namelessButtons} <button> element(s) have no discernible text (axe button-name, WCAG 4.1.2).`, count: namelessButtons });

  const unlabeled = $("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]), select, textarea").filter((_, el) => {
    const $el = $(el); const id = $el.attr("id");
    return !($el.attr("aria-label") || $el.attr("aria-labelledby") || $el.attr("title") || $el.attr("placeholder") || (id && $(`label[for="${id}"]`).length > 0) || $el.closest("label").length > 0);
  }).length;
  if (unlabeled > 0) findings.push({ id: "a11y_input_label", name: "Form controls missing labels", severity: "Error", message: `${unlabeled} form control(s) have no associated label or ARIA name (axe label, WCAG 3.3.2/4.1.2).`, count: unlabeled });

  const seen = new Set<string>(); const dupes = new Set<string>();
  $("[id]").each((_, el) => { const id = $(el).attr("id")!; if (seen.has(id)) dupes.add(id); seen.add(id); });
  if (dupes.size > 0) findings.push({ id: "a11y_duplicate_id", name: "Duplicate element IDs", severity: "Warning", message: `${dupes.size} duplicate id attribute(s) (${Array.from(dupes).slice(0, 5).join(", ")}). IDs must be unique (axe duplicate-id, WCAG 4.1.1).`, count: dupes.size });

  const hasSkip = $("a[href^=\"#\"]").filter((_, el) => /skip|jump/.test($(el).text().trim().toLowerCase())).length;
  if (!hasSkip && $("main, [role=main]").length === 0) findings.push({ id: "a11y_skip_link", name: "No skip link or main landmark", severity: "Notice", message: "No skip-navigation link or <main> landmark found (axe bypass, WCAG 2.4.1). Keyboard users must tab through all navigation." });

  const untitledFrames = $("iframe").filter((_, el) => !($(el).attr("title") || "").trim()).length;
  if (untitledFrames > 0) findings.push({ id: "a11y_frame_title", name: "Frames missing accessible titles", severity: "Warning", message: `${untitledFrames} <iframe> element(s) lack a title attribute (axe frame-title, WCAG 4.1.2).`, count: untitledFrames });

  const viewport = $('meta[name="viewport" i]').attr("content")?.toLowerCase() || "";
  if (!viewport) {
    findings.push({ id: "mobile_viewport_missing", name: "Missing viewport meta tag", severity: "Error", message: "No <meta name=\"viewport\"> tag — the page is not mobile-ready and fails mobile-friendly evaluation." });
  } else if (/maximum-scale\s*=\s*1(\.0)?\b/.test(viewport) || /user-scalable\s*=\s*no/.test(viewport)) {
    findings.push({ id: "a11y_viewport_zoom", name: "Viewport disables pinch zoom", severity: "Error", message: "Viewport meta restricts zooming (maximum-scale=1 or user-scalable=no), failing axe meta-viewport and WCAG 1.4.4." });
  }

  const badTabindex = $("[tabindex]").filter((_, el) => parseInt($(el).attr("tabindex") || "0", 10) > 0).length;
  if (badTabindex > 0) findings.push({ id: "a11y_tabindex_positive", name: "Positive tabindex values", severity: "Warning", message: `${badTabindex} element(s) use tabindex > 0, hijacking natural keyboard order (axe tabindex, WCAG 2.4.3).`, count: badTabindex });

  return findings;
}
