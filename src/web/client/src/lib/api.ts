const BASE = "";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface CrawlSummary {
  id: string;
  targetUrl: string;
  domainName?: string;
  project?: string;
  strategy: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  totalUrlsCrawled: number;
  maxDepthReached: number;
  totalErrors: number;
  totalWarnings: number;
  totalNotices: number;
  totalIssues: number;
  averageAeoScore: number;
  robotsAccessible: boolean;
  sitemapAccessible: boolean;
  sitemapUrlCount: number;
  llmsTxtAccessible?: boolean;
  passed: boolean;
  issueCount: number;
  recommendationCount: number;
  linkCount: number;
}

export interface IssueRow {
  id: string;
  name: string;
  severity: "Error" | "Warning" | "Notice";
  category: string;
  affectedPages: number;
  change: number;
  affectedUrls: string[];
  recommendation: string;
}

export interface PageRow {
  url: string;
  normalizedUrl: string;
  status: number;
  depth: number;
  ttfbMs?: number;
  responseTimeMs: number;
  title?: string;
  description?: string;
  h1Text?: string;
  wordCount: number;
  h1Count: number;
  h2Count: number;
  incomingLinks: number;
  outgoingLinks: number;
  externalLinks: number;
  isOrphan: boolean;
  internalLinkScore: number;
  isIndexable: boolean;
  canonical?: string;
  canonicalMatches: boolean;
  aeoScore: number;
  schemaTypes: string[];
  issues: string[];
  auditIssues: any[];
}

export interface LinkRow {
  crawlId: string;
  source: string;
  target: string;
  anchorText: string;
  nofollow: boolean;
  isInternal: boolean;
  targetStatus: number;
  isBroken: boolean;
  isRedirect: boolean;
}

export interface RecommendationRow {
  id: string;
  issueId: string;
  name: string;
  severity: "Error" | "Warning" | "Notice";
  category: string;
  affectedPages: number;
  change: number;
  priority: "Critical" | "High" | "Medium" | "Low";
  effort: "S" | "M" | "L";
  recommendation: string;
  markdown: string;
}

export interface PagedResult<T> {
  rows: T[];
  total: number;
}

/* ---- Single-URL inspection (POST /api/inspect) ---- */
export interface InspectResult {
  page: {
    url: string;
    finalUrl?: string;
    status: number;
    responseTimeMs: number;
    ttfbMs?: number;
    title?: string;
    description?: string;
    canonical?: string;
    canonicalMatches: boolean;
    h1Text?: string;
    h1Count: number;
    h2Count: number;
    wordCount: number;
    isIndexable: boolean;
    rendered: boolean;
    aeo: { score: number };
    openGraph?: {
      title?: string;
      description?: string;
      image?: string;
      url?: string;
      type?: string;
      incomplete?: boolean;
    };
    twitterCard?: {
      card?: string;
      title?: string;
      description?: string;
      image?: string;
      incomplete?: boolean;
    };
    coreWebVitals?: { lcp?: number; cls?: number; inp?: number; fcp?: number };
  };
  issues: { id: string; name: string; severity: "Error" | "Warning" | "Notice"; category: string; message: string }[];
  contentAnalysis?: {
    readability: {
      wordCount: number;
      sentenceCount: number;
      syllableCount: number;
      avgWordsPerSentence: number;
      avgSyllablesPerWord: number;
      fleschReadingEase: number;
      fleschKincaidGrade: number;
      readingLevel: string;
      readingTimeMinutes: number;
    };
    keywords: {
      unigrams: Array<{ phrase: string; count: number; density: number; isStuffing: boolean }>;
      bigrams: Array<{ phrase: string; count: number; density: number; isStuffing: boolean }>;
      trigrams: Array<{ phrase: string; count: number; density: number; isStuffing: boolean }>;
    };
    headings: {
      items: Array<{ level: number; text: string; id?: string }>;
      hasSkippedLevels: boolean;
      h1Count: number;
      h2Count: number;
      h3Count: number;
    };
    targetKeywordAudit?: {
      keyword: string;
      inUrl: boolean;
      inTitle: boolean;
      inH1: boolean;
      inDescription: boolean;
      inFirst100Words: boolean;
      inImageAlts: boolean;
      count: number;
      density: number;
      status: "optimal" | "under_optimized" | "over_optimized";
      recommendations: string[];
    };
    first100Words: string;
  };
  generatedSchemas?: Record<string, object>;
}

export function severityClass(sev: string): string {
  return sev === "Error" ? "text-err" : sev === "Warning" ? "text-warn" : "text-note";
}

export function severityBg(sev: string): string {
  return sev === "Error"
    ? "bg-red-500/12 text-red-300 border border-red-500/25"
    : sev === "Warning"
    ? "bg-amber-500/12 text-amber-300 border border-amber-500/25"
    : "bg-sky-500/12 text-sky-300 border border-sky-500/25";
}

export function priorityClass(p: string): string {
  return p === "Critical"
    ? "bg-red-500/12 text-red-300 border border-red-500/25"
    : p === "High"
    ? "bg-amber-500/12 text-amber-300 border border-amber-500/25"
    : p === "Medium"
    ? "bg-sky-500/12 text-sky-300 border border-sky-500/25"
    : "bg-zinc-500/12 text-zinc-400 border border-zinc-500/25";
}
