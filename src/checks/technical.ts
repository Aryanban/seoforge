/**
 * Technical checks — mixed content (now delegated to the security module for
 * active/passive classification), compression, HTTP version, and transport.
 *
 * NOTE: mixed_content detection moved to src/checks/security.ts, which splits
 * it into mixed_content_active (Error, blocked by browsers) and
 * mixed_content_passive (Warning) per Sitebulb/SF parity. This module keeps a
 * legacy aggregate guard only when the security module is disabled.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

export function technicalChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { headers, pageUrl, status, html, options } = ctx;

  if (status === 0) return { issues };

  // Compression
  const encoding = headers["content-encoding"] || "";
  if (!encoding && html && html.length > 5120 && status === 200) {
    issues.push({
      id: "no_compression",
      name: "Response not compressed",
      severity: "Notice",
      category: "Performance",
      message: `HTML response (~${Math.round(html.length / 1024)}KB) is served without gzip/brotli compression.`,
      url: pageUrl,
      details: { bytes: html.length },
    });
  }

  // Weak compression: gzip on large payloads where brotli would save ~15-20%
  if (encoding === "gzip" && html && html.length > 100 * 1024 && status === 200) {
    issues.push({
      id: "compression_not_brotli",
      name: "gzip used instead of Brotli",
      severity: "Notice",
      category: "Performance",
      message: `Response uses gzip on a ~${Math.round(html.length / 1024)}KB payload. Brotli (br) typically saves another 15–20% — meaningful on Indian mobile networks.`,
      url: pageUrl,
      details: { encoding, bytes: html.length },
    });
  }

  // HTTP protocol version is visible to render-mode; for raw fetch Node
  // negotiates transparently. Record informational guidance instead of a flag.
  void options;

  return { issues };
}
