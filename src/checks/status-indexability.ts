/**
 * Status & indexability checks — HTTP status, redirects, noindex, HTTPS.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

export function statusIndexabilityChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { status, pageUrl } = ctx;

  // Broken pages
  if (status >= 400 && status < 500) {
    issues.push({
      id: status === 404 ? "broken_link_404" : "client_error_4xx",
      name: "4XX page (broken link)",
      severity: "Error",
      category: "Indexability",
      message: `Page returned HTTP ${status}. Search engines and users cannot reach this URL.`,
      url: pageUrl,
      details: { status },
    });
  } else if (status >= 500) {
    issues.push({
      id: "server_error_5xx",
      name: "5XX page (server error)",
      severity: "Error",
      category: "Indexability",
      message: `Page returned HTTP ${status}. The server failed to serve the page.`,
      url: pageUrl,
      details: { status },
    });
  } else if (status === 0) {
    issues.push({
      id: "page_unreachable",
      name: "Page unreachable or request failed",
      severity: "Error",
      category: "Indexability",
      message: ctx.options.__fetchError
        ? `Fetch failed: ${ctx.options.__fetchError}`
        : "The URL could not be reached (DNS failure, timeout, or connection refused).",
      url: pageUrl,
    });
  }

  // Redirects
  if (ctx.isRedirect && status < 400 && status > 0) {
    const chain = ctx.redirectChain || [];
    issues.push({
      id: "redirect_3xx",
      name: "3XX redirect",
      severity: "Warning",
      category: "Indexability",
      message: `URL redirected to '${ctx.finalUrl}' (status: ${status}).`,
      url: pageUrl,
      details: { chain },
    });
    if (chain.length > 2) {
      issues.push({
        id: "redirect_chain_long",
        name: "Long redirect chain",
        severity: "Warning",
        category: "Indexability",
        message: `Redirect chain has ${chain.length - 1} hop(s): ${chain.join(" → ")}.`,
        url: pageUrl,
        details: { chain },
      });
    }
  }

  // Redirect loop detection
  const chain = ctx.redirectChain || [];
  if (chain.length > 1 && chain[0] === chain[chain.length - 1]) {
    issues.push({
      id: "redirect_loop",
      name: "Redirect loop",
      severity: "Error",
      category: "Indexability",
      message: `URL redirects back to itself, creating an infinite loop: ${chain.join(" → ")}.`,
      url: pageUrl,
    });
  }

  // HTTP → HTTPS redirect (informational)
  if (ctx.isHttpToHttpsRedirect) {
    issues.push({
      id: "http_to_https_redirect",
      name: "HTTP to HTTPS redirect",
      severity: "Notice",
      category: "Indexability",
      message: "Page requested over insecure HTTP redirects automatically to secure HTTPS.",
      url: pageUrl,
    });
  }

  // Non-canonical HTTPS scheme
  if (pageUrl.startsWith("http://") && !ctx.isHttpToHttpsRedirect) {
    issues.push({
      id: "insecure_http_page",
      name: "Page served over insecure HTTP",
      severity: "Warning",
      category: "Technical",
      message: "Page is served over plain HTTP. Migrate to HTTPS for ranking and security signals.",
      url: pageUrl,
    });
  }

  // noindex directives
  if (ctx.meta.robotsNoindex) {
    issues.push({
      id: "noindex_meta_tag",
      name: "Page is blocked from indexing (noindex)",
      severity: "Notice",
      category: "Indexability",
      message: "Page contains <meta name='robots' content='noindex'> and will not appear in search results.",
      url: pageUrl,
    });
  }
  if (ctx.meta.xRobotsNoindex) {
    issues.push({
      id: "noindex_x_robots_tag",
      name: "Page blocked by X-Robots-Tag: noindex",
      severity: "Notice",
      category: "Indexability",
      message: "Server response includes 'X-Robots-Tag: noindex'; the page will not be indexed.",
      url: pageUrl,
    });
  }

  return { issues };
}
