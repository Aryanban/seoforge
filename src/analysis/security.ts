/**
 * Security-header + transport audit — Sitebulb Security-hints parity.
 * One grouped issue per page (SF/Sitebulb roll missing headers into a single
 * hint; per-header noise is an anti-pattern). Checks: CSP, HSTS (with
 * max-age>=31536000 + includeSubDomains strength test), X-Content-Type-Options
 * (must be nosniff), X-Frame-Options / frame-ancestors, Referrer-Policy,
 * Permissions-Policy, cookie flags (Secure/HttpOnly/SameSite on Set-Cookie),
 * mixed content (active vs passive), insecure form actions, TLS/HTTPS.
 */
import * as cheerio from "cheerio";
export interface PageSecurityInput {
  url: string; html: string; status: number;
  headers: Record<string, string>;
}
export interface SecurityFinding {
  id: string; name: string; severity: "Error" | "Warning" | "Notice";
  message: string; details?: Record<string, unknown>;
}
export function auditPageSecurity(input: PageSecurityInput): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const { url, html, status, headers } = input;
  if (status === 0) return out;
  const isHttps = url.startsWith("https://");
  const missing: string[] = [];
  const h = (n: string) => headers[n.toLowerCase()];
  if (!h("content-security-policy")) missing.push("Content-Security-Policy");
  const hsts = h("strict-transport-security") || "";
  if (isHttps && !hsts) missing.push("Strict-Transport-Security");
  else if (isHttps && hsts) {
    const maxAge = hsts.match(/max-age\s*=\s*(\d+)/i);
    if (!maxAge || Number(maxAge[1]) < 31536000) out.push({ id: "hsts_weak", name: "Weak HSTS policy", severity: "Warning", message: `HSTS max-age is ${maxAge ? maxAge[1] + "s" : "missing"}; use max-age>=31536000 with includeSubDomains for preload eligibility.`, details: { hsts } });
    else if (!/includeSubDomains/i.test(hsts)) out.push({ id: "hsts_no_subdomains", name: "HSTS missing includeSubDomains", severity: "Notice", message: "HSTS lacks includeSubDomains; subdomains stay unprotected." });
  }
  const xcto = (h("x-content-type-options") || "").toLowerCase();
  if (xcto && xcto !== "nosniff") out.push({ id: "xcto_invalid", name: "X-Content-Type-Options misconfigured", severity: "Warning", message: `X-Content-Type-Options is '${xcto}'; the only valid value is 'nosniff'.` });
  else if (!xcto) missing.push("X-Content-Type-Options (nosniff)");
  if (!h("x-frame-options") && !/frame-ancestors/i.test(h("content-security-policy") || "")) missing.push("X-Frame-Options / frame-ancestors");
  if (!h("referrer-policy")) missing.push("Referrer-Policy");
  if (!h("permissions-policy") && !h("feature-policy")) missing.push("Permissions-Policy");
  if (missing.length >= 3) out.push({ id: "missing_security_headers", name: "Missing security headers", severity: "Notice", message: `Response is missing ${missing.length} security headers: ${missing.join(", ")}.`, details: { missing } });
  if (isHttps && html) {
    const $ = cheerio.load(html);
    const active: string[] = [];
    $("script[src^=\"http://\"], link[href^=\"http://\"]").each((_, el) => { active.push($(el).attr("src") || $(el).attr("href") || ""); });
    const passive: string[] = [];
    $("img[src^=\"http://\"], video[src^=\"http://\"], audio[src^=\"http://\"], iframe[src^=\"http://\"]").each((_, el) => { passive.push($(el).attr("src") || ""); });
    if (active.length > 0) out.push({ id: "mixed_content_active", name: "Active mixed content (blocked)", severity: "Error", message: `${active.length} script/stylesheet(s) load over HTTP on an HTTPS page — browsers BLOCK these.`, details: { count: active.length, sample: active.slice(0, 5) } });
    if (passive.length > 0) out.push({ id: "mixed_content_passive", name: "Passive mixed content", severity: "Warning", message: `${passive.length} image/media/frame(s) load over HTTP on an HTTPS page — browsers warn or upgrade-and-block.`, details: { count: passive.length, sample: passive.slice(0, 5) } });
    const insecureForms = $("form[action^=\"http://\"]").length;
    if (insecureForms > 0) out.push({ id: "insecure_form_action", name: "Form submits over insecure HTTP", severity: "Error", message: `${insecureForms} form(s) post to http:// — credentials/data leak in transit.`, details: { count: insecureForms } });
  }
  const setCookie = h("set-cookie") || "";
  if (setCookie) {
    const flags: string[] = [];
    if (isHttps && !/;\s*secure/i.test(";" + setCookie)) flags.push("Secure");
    if (!/;\s*httponly/i.test(";" + setCookie)) flags.push("HttpOnly");
    if (!/;\s*samesite/i.test(";" + setCookie)) flags.push("SameSite");
    if (flags.length > 0) out.push({ id: "cookie_flags_missing", name: "Cookies missing security flags", severity: "Warning", message: `Set-Cookie lacks flag(s): ${flags.join(", ")}.`, details: { flags } });
  }
  const server = h("server") || "";
  if (/\d+\.\d+(\.\d+)?/.test(server)) out.push({ id: "server_version_exposed", name: "Server version disclosed", severity: "Notice", message: `Server header exposes version info ('${server}') — aids targeted attacks; mask it.`, details: { server } });
  return out;
}
