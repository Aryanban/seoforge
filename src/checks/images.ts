/**
 * Image checks — alt text, dimensions (CLS), oversized images, legacy formats.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

const LEGACY_FORMATS = [".jpg", ".jpeg", ".png", ".gif", ".bmp"];
const MAX_ALT_WORDS = 12;

export function imageChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { images, pageUrl, html } = ctx;

  if (!html || images.length === 0) return { issues };

  // Missing alt text
  const missingAlt = images.filter((img) => !img.alt);
  if (missingAlt.length > 0) {
    issues.push({
      id: "image_missing_alt",
      name: "Image missing alt text",
      severity: "Warning",
      category: "Images",
      message: `${missingAlt.length} image(s) have no alt attribute. Alt text is required for accessibility and image search.`,
      url: pageUrl,
      details: { images: missingAlt.slice(0, 10).map((i) => i.url) },
    });
  }

  // Missing width/height → cumulative layout shift risk
  const noDimensions = images.filter((img) => !img.hasDimensions);
  if (noDimensions.length > 0) {
    issues.push({
      id: "image_missing_dimensions",
      name: "Image missing width and height attributes",
      severity: "Notice",
      category: "Images",
      message: `${noDimensions.length} image(s) lack width/height attributes, which can cause layout shifts (poor CLS).`,
      url: pageUrl,
      details: { images: noDimensions.slice(0, 10).map((i) => i.url) },
    });
  }

  // Long alt text
  for (const img of images) {
    if (img.alt) {
      const words = img.alt.split(/\s+/).filter(Boolean).length;
      if (words > MAX_ALT_WORDS) {
        issues.push({
          id: "image_alt_too_long",
          name: "Image alt text too long",
          severity: "Notice",
          category: "Images",
          message: `Alt text for ${img.url} is ${words} words. Keep alt text concise (≤ ${MAX_ALT_WORDS} words).`,
          url: pageUrl,
          details: { src: img.src, alt: img.alt },
        });
        break; // one notice per page is enough
      }
    }
  }

  // Legacy image formats
  const legacy = images.filter((img) =>
    LEGACY_FORMATS.some((fmt) => img.url.toLowerCase().includes(fmt))
  );
  if (legacy.length > 0) {
    issues.push({
      id: "image_legacy_format",
      name: "Image uses legacy format",
      severity: "Notice",
      category: "Images",
      message: `${legacy.length} image(s) use legacy formats (JPEG/PNG/GIF). Convert to WebP or AVIF for smaller payloads and Core Web Vitals.`,
      url: pageUrl,
      details: { images: legacy.slice(0, 10).map((i) => i.url) },
    });
  }

  // Image used as a link with no anchor text
  const linkedNoText = images.filter((img) => img.inLink);
  if (linkedNoText.length > 0) {
    issues.push({
      id: "image_link_no_anchor",
      name: "Image link without anchor text",
      severity: "Notice",
      category: "Images",
      message: `${linkedNoText.length} image(s) are used as links without anchor text. Add alt text or surrounding descriptive text.`,
      url: pageUrl,
      details: { count: linkedNoText.length },
    });
  }

  return { issues };
}
