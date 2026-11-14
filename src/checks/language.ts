/**
 * Language check: flags pages whose declared <html lang> does not match the
 * language of the visible text. Detection is local (franc-min), no network.
 */
import { franc } from "franc-min";
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";
import { extractVisibleText } from "../crawl/link-extractor.js";

const MIN_TEXT_CHARS = 300;
const SAMPLE_CHARS = 5000;

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

export function languageChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  if (!ctx.html || ctx.status !== 200) return { issues };

  const raw = ctx.$ ? ctx.$("html").attr("lang") : undefined;
  const declared = raw?.trim().toLowerCase().split("-")[0];
  if (!declared) return { issues };

  const detected = detectContentLanguage(extractVisibleText(ctx.$ ?? ctx.html));
  if (detected && declared !== detected) {
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
