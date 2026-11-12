/**
 * Status & indexability checks — HTTP status, redirects, noindex, HTTPS.
 *
 * Redirect-code classification (Google Search Central: 301/308 permanent,
 * 302/307 temporary, meta-refresh/JS unreliable):
 * - redirect_301_permanent (Notice): correct permanent redirect, single hop.
 * - redirect_302_temporary (Warning): temporary redirect — equity may not pass;
 *   long-lived 302s should be 301/308.
 * - redirect_meta_refresh / meta_refresh (Warning): client-side redirect.
 * Long chains (>2 hops) and loops remain Warnings/Errors respectively.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";
import { checkSoft404 } from "../analysis/soft-404.js";

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
  } else if (status === 200) {
    const title = ctx.meta.title || "";
    const h1 = ctx.meta.h1Text || "";
    const soft = checkSoft404({
      url: pageUrl,
      status: 200,
      title,
      h1Text: h1,
      wordCount: ctx.meta.wordCount,
      canonical: ctx.meta.canonical,
    });
    if (soft.isSoft404) {
      issues.push({
        id: "soft_404",
        name: "Soft 404 (Missing Content Served with HTTP 200)",
        severity: "Error",
        category: "Indexability",
        message: `Page returns HTTP 200 OK but displays a 404/not-found screen (${soft.signals.join("; ")}). Google treats this as a crawl error and wastes crawl budget.`,
        url: pageUrl,
        details: {
          confidence: soft.confidence,
          signals: soft.signals,
          recommendation: soft.recommendation,
        },
      });
    }
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

  // Redirects — classified by redirect code (301/308 vs 302/307)
  if (ctx.isRedirect && status < 400 && status > 0) {
    const chain = ctx.redirectChain || [];
    const code = ctx.redirectStatusCode ?? status;
    const permanent = code === 301 || code === 308;
    issues.push({
      id: permanent ? "redirect_301_permanent" : "redirect_302_temporary",
      name: permanent ? "301/308 permanent redirect" : "302/307 temporary redirect",
      severity: permanent ? "Notice" : "Warning",
      category: "Indexability",
      message: permanent
        ? `URL permanently redirects to '${ctx.finalUrl}' (HTTP ${code}). Update internal links to point at the destination.`
        : `URL uses a TEMPORARY redirect (HTTP ${code}) to '${ctx.finalUrl}'. Temporary redirects may not pass full equity — switch long-lived redirects to 301/308.`,
      url: pageUrl,
      details: { chain, statusCode: code },
    });
    // Back-compat aggregate issue (kept so existing dashboards keep grouping)
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
  // Skipped for staging/local mirrors of an HTTPS production origin (--production-origin).
  const auditingHttpsMirror = String(ctx.options?.productionOrigin || "").startsWith("https://");
  if (pageUrl.startsWith("http://") && !ctx.isHttpToHttpsRedirect && !auditingHttpsMirror) {
    issues.push({
      id: "insecure_http_page",
      name: "Page served over insecure HTTP",
      severity: "Warning",
      category: "Technical",
      message: "Page is served over plain HTTP. Migrate to HTTPS for ranking and security signals.",
      url: pageUrl,
    });
  }

  // Trailing-slash / case / www variants that canonicalise elsewhere are
  // covered by canonical_mismatch; flag duplicate protocol+host variants here.
  if (ctx.meta.canonical && status === 200) {
    try {
      const canonHost = new URL(ctx.meta.canonical).origin.toLowerCase();
      const pageHost = new URL(ctx.finalUrl || pageUrl).origin.toLowerCase();
      if (canonHost !== pageHost) {
        issues.push({
          id: "canonical_cross_domain",
          name: "Canonical points to a different host",
          severity: "Warning",
          category: "Indexability",
          message: `Canonical '${ctx.meta.canonical}' is on a different host than the page. Cross-domain canonicals consolidate equity away from this URL — verify this is intentional.`,
          url: pageUrl,
          details: { canonical: ctx.meta.canonical },
        });
      }
    } catch {
      /* invalid canonical URL */
      issues.push({
        id: "canonical_invalid_url",
        name: "Canonical is not a valid URL",
        severity: "Error",
        category: "Indexability",
        message: `Canonical value '${ctx.meta.canonical}' could not be parsed as a URL.`,
        url: pageUrl,
        details: { canonical: ctx.meta.canonical },
      });
    }
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
