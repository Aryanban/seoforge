/**
 * SERP-snippet width model — Screaming Frog pixel-width parity.
 * SF cutoffs: title >561px / <200px; description >985px / <400px.
 * Real SERP rendering uses Arial 20px (title) / 14px (description); a full
 * canvas measurement needs a font engine, so SEOForge ships a deterministic
 * proportional glyph-width table (calibrated averages incl. wide/narrow
 * glyph classes, CJK full-width, Devanagari combining-mark aware). This is
 * documented as an approximation: char counts remain the portable check.
 */
const NARROW = new Set("ijlI.,:;!|' \".".split(""));
const WIDE = new Set("mwMW@#%&".split(""));
export function approxPixelWidth(text: string, fontPx: number): number {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) || 0;
    if (cp >= 0x0900 && cp <= 0x097f) { units += 0.62; continue; } // Devanagari cluster avg
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7af)) { units += 1.0; continue; } // CJK full width
    if (NARROW.has(ch)) units += 0.32;
    else if (WIDE.has(ch)) units += 0.85;
    else if (ch === " ") units += 0.3;
    else units += 0.55;
  }
  return Math.round(units * fontPx);
}
export const TITLE_FONT_PX = 20;
export const DESC_FONT_PX = 14;
export const TITLE_OVER_PX = 561;
export const TITLE_UNDER_PX = 200;
export const DESC_OVER_PX = 985;
export const DESC_UNDER_PX = 400;
export function titlePixelWidth(title: string): number { return approxPixelWidth(title, TITLE_FONT_PX); }
export function descriptionPixelWidth(desc: string): number { return approxPixelWidth(desc, DESC_FONT_PX); }
