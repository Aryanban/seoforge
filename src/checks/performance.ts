/**
 * Performance checks — TTFB, response latency, payload budgets, caching
 * signals, Core Web Vitals (render mode).
 *
 * Thresholds (sourced):
 * - TTFB >800ms / slow page >2s: Ahrefs Site Audit errors
 *   (ahrefs.com/site-audit; modenostrategies audit guide).
 * - HTML >2MB / resource >2MB: Screaming Frog "Validation" checks flag
 *   pages/resources over 2MB (screamingfrog.co.uk/seo-spider/issues/).
 * - CWV pass/fail: web.dev/articles/vitals — LCP ≤2500ms good / >4000 poor;
 *   CLS ≤0.1 good / >0.25 poor; INP ≤200ms good / >500 poor.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

const SLOW_TTFB_MS = 800;
const SLOW_RESPONSE_MS = 2000;
const LARGE_HTML_BYTES = 2 * 1024 * 1024;

export function performanceChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { ttfbMs, responseTimeMs, cwv, pageUrl, status, html, headers } = ctx;

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
    // LCP: good ≤2500ms, needs-improvement ≤4000ms, poor >4000ms (web.dev/vitals).
    // Flagging at the "good" boundary keeps parity with Ahrefs/SF behaviour:
    // anything above good needs work; severity escalates past poor.
    if (cwv.lcp !== undefined && cwv.lcp > 2500) {
      const poor = cwv.lcp > 4000;
      issues.push({
        id: "cwv_lcp_poor",
        name: poor ? "Poor Largest Contentful Paint (LCP)" : "LCP needs improvement",
        severity: poor ? "Warning" : "Notice",
        category: "Performance",
        message: `LCP is ${cwv.lcp}ms. Google rates LCP ≤2500ms good and >4000ms poor.`,
        url: pageUrl,
        details: { lcp: cwv.lcp },
      });
    }
    if (cwv.cls !== undefined && cwv.cls > 0.1) {
      const poor = cwv.cls > 0.25;
      issues.push({
        id: "cwv_cls_poor",
        name: poor ? "Poor Cumulative Layout Shift (CLS)" : "CLS needs improvement",
        severity: poor ? "Warning" : "Notice",
        category: "Performance",
        message: `CLS is ${cwv.cls}. Google rates CLS ≤0.1 good and >0.25 poor.`,
        url: pageUrl,
        details: { cls: cwv.cls },
      });
    }
    if (cwv.inp !== undefined && cwv.inp > 200) {
      const poor = cwv.inp > 500;
      issues.push({
        id: "cwv_inp_poor",
        name: poor ? "Poor Interaction to Next Paint (INP)" : "INP needs improvement",
        severity: poor ? "Warning" : "Notice",
        category: "Performance",
        message: `INP is ${cwv.inp}ms. Google rates INP ≤200ms good and >500ms poor.`,
        url: pageUrl,
        details: { inp: cwv.inp },
      });
    }
  }

  // Oversized HTML payload (Screaming Frog flags pages >2MB)
  const bytes = ctx.contentLengthBytes ?? (html ? html.length : 0);
  if (status === 200 && bytes > LARGE_HTML_BYTES) {
    issues.push({
      id: "page_too_large",
      name: "HTML payload exceeds 2MB",
      severity: "Warning",
      category: "Performance",
      message: `HTML response is ~${Math.round(bytes / 1024 / 1024)}MB. Pages over 2MB risk crawl truncation and poor mobile LCP (critical on Indian 4G / low-RAM devices). Split, paginate, or code-split.`,
      url: pageUrl,
      details: { bytes },
    });
  }

  // Caching signals Google honours: ETag / Last-Modified / max-age
  // (developers.google.com/search/docs/crawling-indexing/overview-google-crawlers)
  if (status === 200) {
    const hasEtag = !!headers["etag"];
    const hasLastMod = !!headers["last-modified"];
    const cacheControl = headers["cache-control"] || "";
    const maxAge = cacheControl.match(/max-age\s*=\s*(\d+)/i);
    if (!hasEtag && !hasLastMod) {
      issues.push({
        id: "no_cache_validators",
        name: "No cache validators (ETag / Last-Modified)",
        severity: "Notice",
        category: "Performance",
        message: "Response carries neither ETag nor Last-Modified. Googlebot supports both for conditional recrawls; without them every recrawl is a full download.",
        url: pageUrl,
      });
    }
    if (!maxAge) {
      issues.push({
        id: "no_cache_max_age",
        name: "No Cache-Control max-age",
        severity: "Notice",
        category: "Performance",
        message: "No Cache-Control: max-age directive. Google uses max-age as a recrawl-timing hint; browsers cannot cache efficiently without it.",
        url: pageUrl,
        details: { cacheControl: cacheControl || "(absent)" },
      });
    }
  }

  return { issues };
}
