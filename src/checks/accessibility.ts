/**
 * Accessibility checks — axe-core high-impact rule parity (WCAG 2.2 A/AA)
 * plus mobile viewport signals. Wraps src/analysis/a11y.ts into the
 * page-check pipeline with the Accessibility category.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";
import { analyzeAccessibility } from "../analysis/a11y.js";
import type { AxeViolation } from "../crawl/renderer.js";

const AXE_SEVERITY = { critical: "Error", serious: "Warning", moderate: "Notice", minor: "Notice" } as const;

/** axe-core results as issues: id axe_<rule>, severity from axe's impact. */
export function axeIssues(violations: AxeViolation[], url: string): AuditIssue[] {
  return violations.map((v) => ({
    id: `axe_${v.id}`,
    name: v.help,
    severity: AXE_SEVERITY[v.impact ?? "moderate"],
    category: "Accessibility" as const,
    message: `${v.help} (${v.nodes} element${v.nodes === 1 ? "" : "s"}, axe-core rule ${v.id}). ${v.helpUrl}`,
    url,
    details: { rule: v.id, impact: v.impact, count: v.nodes, targets: v.targets },
  }));
}

export function accessibilityChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { html, pageUrl, status } = ctx;
  if (!html || status === 0) return { issues };
  // Rendered with axe-core: its results replace the static approximations.
  if (ctx.axe) return { issues: axeIssues(ctx.axe, pageUrl) };
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
