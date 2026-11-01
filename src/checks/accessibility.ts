/**
 * Accessibility checks — axe-core high-impact rule parity (WCAG 2.2 A/AA)
 * plus mobile viewport signals. Wraps src/analysis/a11y.ts into the
 * page-check pipeline with the Accessibility category.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";
import { analyzeAccessibility } from "../analysis/a11y.js";

export function accessibilityChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { html, pageUrl, status } = ctx;
  if (!html || status === 0) return { issues };
  for (const f of analyzeAccessibility(html)) {
    issues.push({
      id: f.id,
      name: f.name,
      severity: f.severity,
      category: "Accessibility",
      message: f.message,
      url: pageUrl,
      details: f.count !== undefined ? { count: f.count } : undefined,
    });
  }
  return { issues };
}
