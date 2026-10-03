/**
 * Failure classification for discovery attempts.
 *
 * Ported from BeyondSEO `src/beyondseo/diagnostics.py` (`failure_detail`,
 * `challenge_signal`). The point is to record *observed evidence* without
 * attributing a generic failure to a provider: a 429 is a rate limit, a
 * challenge form is a challenge, and an unknown error stays unknown.
 */

import type { AttemptStatus, FailureDetail } from "./types.js";

const CHALLENGE_TITLES = new Set([
  "just a moment...",
  "just a moment",
  "attention required! | cloudflare",
  "verify you are human",
  "security verification",
  "access denied",
]);

const CHALLENGE_MARKERS = [
  "/cdn-cgi/challenge-platform/",
  "cf-chl-",
  "cf_chl_opt",
  "g-recaptcha",
  "hcaptcha",
];

/**
 * Detect an interstitial challenge. A challenge-shaped title AND supporting
 * markup are required — ordinary content that merely mentions CAPTCHA or
 * Cloudflare is not a challenge.
 */
export function challengeSignal(
  headers: Record<string, string>,
  body: string,
): { code: "provider_challenge"; confidence: "observed"; evidence: string } | null {
  if ((headers["cf-mitigated"] ?? "").trim().toLowerCase() === "challenge") {
    return {
      code: "provider_challenge",
      confidence: "observed",
      evidence: "Response contains cf-mitigated: challenge.",
    };
  }
  const text = body.slice(0, 131072).toLowerCase();
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title\s*>/.exec(text);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
  if (!CHALLENGE_TITLES.has(title)) return null;
  if (!CHALLENGE_MARKERS.some((m) => text.includes(m))) return null;
  return {
    code: "provider_challenge",
    confidence: "observed",
    evidence: `Response page title "${title}" with challenge markup.`,
  };
}

const AMBIGUOUS = new Set<AttemptStatus>([
  "unknown",
  "http_access_denied",
  "permission_denied",
  "tool_unavailable",
]);

/**
 * Classify an observed error/status into a stable code. Returns null when
 * nothing failed (2xx with no error) so callers can distinguish "response
 * received" from "response failed".
 */
export function failureDetail(
  error = "",
  status = 0,
  headers: Record<string, string> = {},
  body = "",
): FailureDetail | null {
  const text = String(error ?? "");
  const lower = text.toLowerCase();
  let code: AttemptStatus | null = null;

  if (lower.includes("discovery_request_budget_exhausted")) {
    code = "budget_exhausted";
  } else if (lower.includes("robots_rule_disallowed")) {
    code = "robots_restricted";
  } else if (lower.startsWith("robots_")) {
    code = "robots_unavailable";
  } else if (lower.includes("network access is disabled") || lower.includes("network access denied by")) {
    code = "environment_network_restricted";
  } else if (lower.includes("permissionerror") || lower.includes("permission denied") || lower.includes("operation not permitted")) {
    code = "permission_denied";
  } else if (lower.includes("tool unavailable") || lower.includes("tool not available")) {
    code = "tool_unavailable";
  } else if (lower.includes("modulenotfounderror") || lower.includes("no module named")) {
    code = "missing_dependency";
  } else if (lower.includes("executable doesn't exist") || lower.includes("browser executable not found")) {
    code = "missing_dependency";
  } else if (lower.includes("enotfound") || lower.includes("getaddrinfo") || lower.includes("name or service not known") || lower.includes("nodename nor servname")) {
    code = "dns_failure";
  } else if (lower.includes("sslerror") || lower.includes("certificate_verify_failed") || lower.includes("unable to verify the first certificate") || lower.includes("self-signed certificate")) {
    code = "tls_failure";
  } else if (lower.includes("timeouterror") || lower.includes("timed out") || lower.includes("deadline exceeded") || lower.includes("aborterror")) {
    code = "connection_timeout";
  } else if (
    lower.includes("connectionrefusederror") ||
    lower.includes("connectionreseterror") ||
    lower.includes("network is unreachable") ||
    lower.includes("connect failed") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset")
  ) {
    code = "connection_failure";
  } else if (status === 429) {
    code = "provider_rate_limited";
  } else if (challengeSignal(headers, body)) {
    code = "provider_challenge";
  } else if (status === 401 || status === 403) {
    code = "http_access_denied";
  } else if (status >= 400) {
    code = "http_error";
  } else if (text) {
    code = "unknown";
  } else if (!(status >= 200 && status < 300)) {
    code = "unknown";
  }

  if (!code) return null;
  return {
    code,
    evidence: text || `HTTP ${status}`,
    http_status: status || null,
    cause: AMBIGUOUS.has(code) ? "unknown" : code,
  };
}
