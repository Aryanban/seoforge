/**
 * Language check: flags pages whose declared <html lang> does not match the
 * language of the visible text. Detection is local (franc-min), no network.
 */
import { franc, francAll } from "franc-min";
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";
import { extractVisibleText } from "../crawl/link-extractor.js";

const MIN_TEXT_CHARS = 300;
const SAMPLE_CHARS = 5000;
/** Repetitive or navigation-only text gives franc near-ties; require some vocabulary. */
const MIN_DISTINCT_WORDS = 30;
/** franc scores are relative to the best match (1). A declared language this close is not a mismatch. */
const DECLARED_SCORE_OK = 0.9;

const ISO3_TO_1: Record<string, string> = {
  eng: "en", fra: "fr", deu: "de", spa: "es", por: "pt", ita: "it", nld: "nl",
  rus: "ru", ukr: "uk", pol: "pl", tur: "tr", arb: "ar", hin: "hi", ben: "bn",
  mar: "mr", guj: "gu", tam: "ta", tel: "te", kan: "kn", mal: "ml", pan: "pa",
  urd: "ur", jpn: "ja", kor: "ko", cmn: "zh", ind: "id", vie: "vi", tha: "th",
  swe: "sv", dan: "da", nob: "no", fin: "fi", ces: "cs", ron: "ro", hun: "hu",
  ell: "el", heb: "he", fas: "fa",
};

/** Returns the ISO 639-1 code of the text's language, or undefined if unknown or too short. */
export function detectContentLanguage(text: string): string | undefined {
  if (text.length < MIN_TEXT_CHARS) return undefined;
  const code = franc(text.slice(0, SAMPLE_CHARS));
  return ISO3_TO_1[code];
}

const ISO1_TO_3 = Object.fromEntries(Object.entries(ISO3_TO_1).map(([k, v]) => [v, k]));

/** True only when the text has enough vocabulary and the declared language scores well below the best match. */
function isClearMismatch(text: string, declared: string): boolean {
  const sample = text.slice(0, SAMPLE_CHARS);
  if (new Set(sample.toLowerCase().match(/\p{L}+/gu) ?? []).size < MIN_DISTINCT_WORDS) return false;
  const scores = francAll(sample);
  const declaredScore = scores.find(([code]) => code === ISO1_TO_3[declared])?.[1];
  if (declaredScore !== undefined) return declaredScore < DECLARED_SCORE_OK;
  // Declared language franc-min can't score: require a clear winner instead.
  return scores.length > 1 && scores[0][1] - scores[1][1] >= 1 - DECLARED_SCORE_OK;
}

export function languageChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  if (!ctx.html || ctx.status !== 200) return { issues };

  const raw = ctx.$ ? ctx.$("html").attr("lang") : undefined;
  const declared = raw?.trim().toLowerCase().split("-")[0];
  if (!declared) return { issues };

  const text = extractVisibleText(ctx.$ ?? ctx.html);
  const detected = detectContentLanguage(text);
  if (detected && declared !== detected && isClearMismatch(text, declared)) {
    issues.push({
      id: "lang_content_mismatch",
      name: "Declared language does not match content",
      severity: "Warning",
      category: "International",
      message: `<html lang="${raw}"> declares "${declared}" but the page text reads as "${detected}". Search engines and screen readers use lang to pick language-specific processing.`,
      url: ctx.pageUrl,
      details: { declared, detected },
    });
  }
  return { issues };
}
