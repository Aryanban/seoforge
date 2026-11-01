/**
 * URL hygiene checks — length, parameters, session IDs, underscores,
 * uppercase, non-ASCII, doubled segments (Screaming Frog "URL" tab parity).
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";
import { analyzeUrlHygiene } from "../analysis/url-hygiene.js";

const ID_TO_NAME: Record<string, string> = {
  overLength: "url_over_length",
  hasNonAscii: "url_non_ascii",
  hasUnderscore: "url_underscores",
  hasUppercase: "url_uppercase",
  hasParameters: "url_has_parameters",
  hasSessionId: "url_session_id",
  duplicateInternalPath: "url_duplicate_path",
  doubleSlash: "url_double_slash",
};

const SEVERITY: Record<string, "Warning" | "Notice"> = {
  overLength: "Warning",
  hasSessionId: "Warning",
  hasNonAscii: "Warning",
  hasUnderscore: "Notice",
  hasUppercase: "Notice",
  hasParameters: "Notice",
  duplicateInternalPath: "Notice",
  doubleSlash: "Warning",
};

export function urlChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const result = analyzeUrlHygiene({ url: ctx.finalUrl || ctx.pageUrl });
  const keys: Array<keyof typeof ID_TO_NAME> = [
    "overLength", "hasSessionId", "hasNonAscii", "hasUnderscore",
    "hasUppercase", "hasParameters", "duplicateInternalPath", "doubleSlash",
  ];
  const flagMap: Record<string, boolean> = {
    overLength: result.overLength,
    hasNonAscii: result.hasNonAscii,
    hasUnderscore: result.hasUnderscore,
    hasUppercase: result.hasUppercase,
    hasParameters: result.hasParameters,
    hasSessionId: result.hasSessionId,
    duplicateInternalPath: result.duplicateInternalPath,
    doubleSlash: result.doubleSlash,
  };
  for (const key of keys) {
    if (!flagMap[key]) continue;
    const finding = result.findings.find((f) =>
      key === "overLength" ? f.includes("characters") :
      key === "hasSessionId" ? f.includes("session") :
      key === "hasNonAscii" ? f.includes("non-ASCII") :
      key === "hasUnderscore" ? f.includes("underscores") :
      key === "hasUppercase" ? f.includes("uppercase") :
      key === "hasParameters" ? f.includes("query parameter") :
      key === "duplicateInternalPath" ? f.includes("repeats") :
      f.includes("double slash")
    );
    issues.push({
      id: ID_TO_NAME[key],
      name: finding?.split(";")[0] || key,
      severity: SEVERITY[key],
      category: "Technical",
      message: finding || key,
      url: ctx.pageUrl,
      details: { url: ctx.finalUrl || ctx.pageUrl, length: result.length, paramCount: result.paramCount },
    });
  }
  return { issues };
}
