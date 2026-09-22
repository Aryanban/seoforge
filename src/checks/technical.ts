/**
 * Technical checks — mixed content, security headers, compression.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "Content-Security-Policy (CSP)",
  "strict-transport-security": "Strict-Transport-Security (HSTS)",
  "x-content-type-options": "X-Content-Type-Options",
  "x-frame-options": "X-Frame-Options",
  "referrer-policy": "Referrer-Policy",
};

export function technicalChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { headers, pageUrl, status, html } = ctx;

  if (status === 0) return { issues };

  // Mixed content: insecure resources on a secure page
  if (pageUrl.startsWith("https://") && html) {
    const insecure = [
      ...(html.match(/<script[^>]+src=["']http:\/\//gi) || []),
      ...(html.match(/<link[^>]+href=["']http:\/\//gi) || []),
      ...(html.match(/<img[^>]+src=["']http:\/\//gi) || []),
      ...(html.match(/<iframe[^>]+src=["']http:\/\//gi) || []),
    ];
    if (insecure.length > 0) {
      issues.push({
        id: "mixed_content",
        name: "Mixed content on HTTPS page",
        severity: "Error",
        category: "Technical",
        message: `${insecure.length} resource(s) are loaded over insecure HTTP on an HTTPS page. Browsers block or downgrade these.`,
        url: pageUrl,
        details: { count: insecure.length },
      });
    }
  }

  // Missing security headers
  const missing: string[] = [];
  for (const [header, label] of Object.entries(SECURITY_HEADERS)) {
    if (!headers[header]) missing.push(label);
  }
  if (missing.length >= 3) {
    issues.push({
      id: "missing_security_headers",
      name: "Missing security headers",
      severity: "Notice",
      category: "Technical",
      message: `Response is missing security headers: ${missing.join(", ")}.`,
      url: pageUrl,
      details: { missing },
    });
  }

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

  return { issues };
}
