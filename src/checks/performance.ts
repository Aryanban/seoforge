/**
 * Performance checks — TTFB, response latency, Core Web Vitals (render mode).
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

const SLOW_TTFB_MS = 800;
const SLOW_RESPONSE_MS = 2000;

export function performanceChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { ttfbMs, responseTimeMs, cwv, pageUrl, status } = ctx;

  if (status === 0) return { issues };

  const threshold = ctx.thresholds?.maxResponseTimeMs;

  if (ttfbMs && ttfbMs > SLOW_TTFB_MS) {
    issues.push({
      id: "slow_ttfb",
      name: "Slow Time to First Byte (TTFB)",
      severity: "Warning",
      category: "Performance",
      message: `TTFB was ${ttfbMs}ms. Google recommends a server response time under ${SLOW_TTFB_MS}ms.`,
      url: pageUrl,
      details: { ttfbMs },
    });
  }

  if (threshold && responseTimeMs > threshold) {
    issues.push({
      id: "high_latency",
      name: "High page response latency",
      severity: "Warning",
      category: "Performance",
      message: `Response time was ${responseTimeMs}ms (exceeds configured threshold of ${threshold}ms).`,
      url: pageUrl,
      details: { responseTimeMs, threshold },
    });
  } else if (!threshold && responseTimeMs > SLOW_RESPONSE_MS) {
    issues.push({
      id: "high_latency",
      name: "High page response latency",
      severity: "Warning",
      category: "Performance",
      message: `Response time was ${responseTimeMs}ms (exceeds recommended ${SLOW_RESPONSE_MS}ms threshold).`,
      url: pageUrl,
      details: { responseTimeMs },
    });
  }

  if (cwv) {
    if (cwv.lcp !== undefined && cwv.lcp > 2500) {
      issues.push({
        id: "cwv_lcp_poor",
        name: "Poor Largest Contentful Paint (LCP)",
        severity: "Warning",
        category: "Performance",
        message: `LCP is ${cwv.lcp}ms. Google considers pages with LCP > 2500ms as having poor Core Web Vitals.`,
        url: pageUrl,
        details: { lcp: cwv.lcp },
      });
    }
    if (cwv.cls !== undefined && cwv.cls > 0.1) {
      issues.push({
        id: "cwv_cls_poor",
        name: "Poor Cumulative Layout Shift (CLS)",
        severity: "Warning",
        category: "Performance",
        message: `CLS is ${cwv.cls}. Google considers pages with CLS > 0.1 as having poor Core Web Vitals.`,
        url: pageUrl,
        details: { cls: cwv.cls },
      });
    }
    if (cwv.inp !== undefined && cwv.inp > 200) {
      issues.push({
        id: "cwv_inp_poor",
        name: "Poor Interaction to Next Paint (INP)",
        severity: "Warning",
        category: "Performance",
        message: `INP is ${cwv.inp}ms. Google considers pages with INP > 200ms as having poor Core Web Vitals.`,
        url: pageUrl,
        details: { inp: cwv.inp },
      });
    }
  }

  return { issues };
}
