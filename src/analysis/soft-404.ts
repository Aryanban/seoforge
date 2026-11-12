/**
 * Soft 404 & Dead Page Detection Engine — Google Search Console & Semrush parity.
 * Accurately detects pages that return HTTP 200 OK but are actually missing, dead, or empty pages.
 */
import { PageAuditResult, AuditIssue } from "../types.js";

export interface Soft404CheckResult {
  isSoft404: boolean;
  confidence: number; // 0 - 100
  signals: string[];
  recommendation: string;
}

const TITLE_404_PATTERNS = [
  /^\s*404\b/i,
  /\b404\b\s*[-:|–—]?\s*(error|not found|page)/i,
  /\b(error|page)\s*[-:]?\s*404\b/i,
  /\bpage not found\b/i,
  /\bnot found\b/i,
  /\barticle not found\b/i,
  /\bproduct not found\b/i,
  /\bitem unavailable\b/i,
  /\boops!?\s*page/i,
  /\bdoesn['’]t exist\b/i,
  /\bpage has been removed\b/i,
];

const H1_404_PATTERNS = [
  /^\s*404\b/i,
  /\b404\b\s*[-:|–—]?\s*(error|not found|page)/i,
  /\b(error|page)\s*[-:]?\s*404\b/i,
  /\bnot found\b/i,
  /\bpage cannot be found\b/i,
  /\blooking for doesn['’]t exist\b/i,
  /\bwe couldn['’]t find\b/i,
  /\bpage missing\b/i,
];

/**
 * Evaluates whether an HTTP 200 page is actually a Soft 404.
 */
export function checkSoft404(page: {
  url: string;
  status: number;
  title?: string;
  h1Text?: string;
  bodyText?: string;
  wordCount?: number;
  canonical?: string;
}): Soft404CheckResult {
  // Only HTTP 200 pages can be Soft 404s (real 404s are hard 404s)
  if (page.status !== 200) {
    return {
      isSoft404: false,
      confidence: 0,
      signals: [],
      recommendation: "Status is not 200; not a soft 404.",
    };
  }

  const signals: string[] = [];
  let score = 0;
  let bodySignalFired = false;

  const title = (page.title || "").trim();
  const h1 = (page.h1Text || "").trim();
  const body = (page.bodyText || "").toLowerCase();
  const words = page.wordCount ?? (body ? body.split(/\s+/).filter(Boolean).length : 0);

  // 1. Title checks
  for (const pat of TITLE_404_PATTERNS) {
    if (pat.test(title)) {
      signals.push(`Page title matches 404 signature: "${title}"`);
      score += 45;
      break;
    }
  }

  // 2. H1 checks
  for (const pat of H1_404_PATTERNS) {
    if (pat.test(h1)) {
      signals.push(`H1 heading indicates missing content: "${h1}"`);
      score += 40;
      break;
    }
  }

  // 3. Canonical pointing to a 404/error page
  if (page.canonical) {
    const canonLower = page.canonical.toLowerCase();
    if (canonLower.includes("/404") || canonLower.includes("/not-found") || canonLower.includes("/error")) {
      signals.push(`Canonical URL points to error page: "${page.canonical}"`);
      score += 50;
    }
  }

  // 4. Extremely thin content with error terms
  if (words < 60) {
    if (body.includes("not found") || body.includes("removed") || body.includes("error") || body.includes("expired")) {
      signals.push(`Thin content (${words} words) containing missing/error phrases in body`);
      score += 30;
      bodySignalFired = true;
    } else if (words < 20 && !title && !h1) {
      signals.push(`Practically blank page (<20 words, no title or H1)`);
      score += 25;
    }
  }

  // 5. Zero search results pattern on internal search pages
  if (page.url.includes("search") || page.url.includes("query") || page.url.includes("q=")) {
    if (body.includes("0 results") || body.includes("no results found") || body.includes("did not match any")) {
      signals.push(`Internal search page with zero search results returned as 200 OK`);
      score += 35;
      bodySignalFired = true;
    }
  }

  // 6. Content-volume guard: a long, substantive page with no body-level
  // error signal cannot be classified as soft 404 on title/H1 alone.
  if (words >= 300 && !bodySignalFired) {
    score *= 0.5;
  }

  const isSoft404 = score >= 45;
  const confidence = Math.min(100, score);

  return {
    isSoft404,
    confidence,
    signals,
    recommendation: isSoft404
      ? `Return a real HTTP 404 or 410 Gone status code for ${page.url}, or 301 redirect to the nearest active category.`
      : "Page content appears valid.",
  };
}

/**
 * Creates an AuditIssue if the page is a Soft 404.
 */
export function auditSoft404Issue(page: {
  url: string;
  status: number;
  title?: string;
  h1Text?: string;
  bodyText?: string;
  wordCount?: number;
  canonical?: string;
}): AuditIssue | null {
  const res = checkSoft404(page);
  if (!res.isSoft404) return null;

  return {
    id: "soft_404",
    name: "Soft 404 (Missing Content Served with HTTP 200)",
    severity: "Error",
    category: "Indexability",
    message: `Page returns HTTP 200 OK but displays a 404/not-found screen (${res.signals.join("; ")}). Google treats this as a crawl error and wastes crawl budget.`,
    url: page.url,
    details: {
      confidence: res.confidence,
      signals: res.signals,
      recommendation: res.recommendation,
    },
  };
}
