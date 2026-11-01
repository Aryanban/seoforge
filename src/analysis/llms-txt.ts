/**
 * llms.txt validation — full llmstxt.org specification parity.
 *
 * Spec: https://llmstxt.org/ — a markdown file at /llms.txt that helps LLMs
 * use a website at inference time. Served with `Content-Type: text/markdown`
 * (+ `; charset=utf-8`). Respects llms-full.txt convention (canaicrawl,
 * Geodocs: llms.txt = index/TOC, llms-full.txt = complete concatenation).
 */

export interface LlmsTxtInput {
  url: string;
  status: number;
  contentType?: string;
  body: string;
  byteSize?: number;
}

export interface LlmsTxtResult {
  present: boolean;
  valid: boolean;
  findings: Array<{ id: string; name: string; severity: "Error" | "Warning" | "Notice"; message: string }>;
  stats: { h1Count: number; h2Count: number; linkCount: number; optionalLinks: number; byteSize: number; hasBlockquoteNotes: boolean };
}

export function validateLlmsTxt(input: LlmsTxtInput): LlmsTxtResult {
  const findings: LlmsTxtResult["findings"] = [];
  if (input.status !== 200 || !input.body) {
    findings.push({ id: "llms_txt_missing", name: "llms.txt not served", severity: "Notice", message: `/llms.txt returned HTTP ${input.status}. AI assistants fall back to scraping HTML without guidance.` });
    return { present: false, valid: false, findings, stats: { h1Count: 0, h2Count: 0, linkCount: 0, optionalLinks: 0, byteSize: 0, hasBlockquoteNotes: false } };
  }
  const body = input.body;
  const ct = (input.contentType || "").toLowerCase();
  if (ct && !ct.includes("text/markdown") && !ct.includes("text/plain")) {
    findings.push({ id: "llms_txt_content_type", name: "llms.txt wrong Content-Type", severity: "Warning", message: `llms.txt served as '${input.contentType}'; spec recommends 'text/markdown; charset=utf-8'.` });
  }
  const lines = body.split(/\r?\n/);
  const h1s = lines.filter((l) => /^#\s+\S/.test(l));
  const h2s = lines.filter((l) => /^##\s+\S/.test(l));
  if (h1s.length === 0) findings.push({ id: "llms_txt_no_h1", name: "llms.txt missing H1 title", severity: "Error", message: "llms.txt has no top-level '# Title' line (spec requires exactly one H1 project name)." });
  if (h1s.length > 1) findings.push({ id: "llms_txt_multi_h1", name: "llms.txt has multiple H1s", severity: "Warning", message: `llms.txt has ${h1s.length} H1 lines; spec requires exactly one.` });
  const blockquote = lines.find((l) => l.startsWith(">"));
  if (!blockquote) findings.push({ id: "llms_txt_no_summary", name: "llms.txt missing summary blockquote", severity: "Warning", message: "No '> summary' blockquote after the H1. The summary orients assistants before the link list." });
  const mdLinks = body.match(/\[[^\]]+\]\([^)]+\)/g) || [];
  if (mdLinks.length === 0) findings.push({ id: "llms_txt_no_links", name: "llms.txt contains no markdown links", severity: "Error", message: "llms.txt lists no [Name](URL) links — without links it gives assistants nothing to retrieve." });
  const optionalLinks = (body.match(/\[[^\]]+\]\([^)]+\)\s*:\s*\S/g) || []).length;
  const byteSize = input.byteSize ?? Buffer.byteLength(body, "utf8");
  if (byteSize > 200 * 1024) findings.push({ id: "llms_txt_too_large", name: "llms.txt exceeds guidance size", severity: "Notice", message: `llms.txt is ${(byteSize / 1024).toFixed(0)}KB; keep the index lean and move bulk content to llms-full.txt.` });
  const valid = !findings.some((f) => f.severity === "Error");
  return { present: true, valid, findings, stats: { h1Count: h1s.length, h2Count: h2s.length, linkCount: mdLinks.length, optionalLinks, byteSize, hasBlockquoteNotes: !!blockquote } };
}
