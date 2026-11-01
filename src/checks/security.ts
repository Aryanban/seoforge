/**
 * Security checks — grouped security-header audit, mixed content
 * (active vs passive), insecure forms, cookie flags, server disclosure.
 * Sitebulb Security-hints parity. Wraps src/analysis/security.ts.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";
import { auditPageSecurity } from "../analysis/security.js";

export function securityChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { html, pageUrl, status, headers } = ctx;
  if (status === 0) return { issues };
  for (const f of auditPageSecurity({ url: ctx.finalUrl || pageUrl, html: html || "", status, headers })) {
    issues.push({
      id: f.id,
      name: f.name,
      severity: f.severity,
      category: "Technical",
      message: f.message,
      url: pageUrl,
      details: f.details,
    });
  }
  return { issues };
}
