/**
 * Crawl Diff Engine — Screaming Frog "Crawl Comparison" & Sitebulb Staging Diff parity.
 * Compares two crawls (e.g. Staging vs Production, or Today vs Last Week) to detect:
 *  - Added & removed URLs
 *  - Status code regressions (e.g. 200 -> 404, 200 -> 500)
 *  - Title, description, and canonical changes
 *  - Indexability regressions (accidental noindex or robots.txt block)
 *  - New critical issues vs resolved issues
 */
import { CrawlResult, PageAuditResult } from "../types.js";

export interface StatusChange {
  url: string;
  fromStatus: number;
  toStatus: number;
  isRegression: boolean; // e.g. 200 -> 4xx/5xx
}

export interface MetaChange {
  url: string;
  field: "title" | "description" | "canonical";
  from?: string;
  to?: string;
}

export interface IndexabilityChange {
  url: string;
  becameIndexable: boolean;
  lostIndexability: boolean;
  reason?: string;
}

export interface IssueDelta {
  issueId: string;
  name: string;
  severity: string;
  affectedUrls: string[];
}

export interface CrawlDiffReport {
  baseCrawlId: string;
  targetCrawlId: string;
  baseDate: string;
  targetDate: string;
  urlsAdded: string[];
  urlsRemoved: string[];
  statusChanges: StatusChange[];
  metaChanges: MetaChange[];
  indexabilityChanges: IndexabilityChange[];
  newIssues: IssueDelta[];
  resolvedIssues: IssueDelta[];
  summary: {
    totalBaseUrls: number;
    totalTargetUrls: number;
    addedCount: number;
    removedCount: number;
    statusChangeCount: number;
    regressedStatusCount: number;
    newIssueCount: number;
    resolvedIssueCount: number;
    isCleanDeploy: boolean;
  };
}

export function compareCrawls(baseCrawl: CrawlResult, targetCrawl: CrawlResult): CrawlDiffReport {
  const basePages = new Map<string, PageAuditResult>();
  for (const p of baseCrawl.pages) basePages.set(p.normalizedUrl || p.url, p);

  const targetPages = new Map<string, PageAuditResult>();
  for (const p of targetCrawl.pages) targetPages.set(p.normalizedUrl || p.url, p);

  const urlsAdded: string[] = [];
  const urlsRemoved: string[] = [];
  const statusChanges: StatusChange[] = [];
  const metaChanges: MetaChange[] = [];
  const indexabilityChanges: IndexabilityChange[] = [];

  // Check added & changed pages
  for (const [url, targetPage] of targetPages.entries()) {
    const basePage = basePages.get(url);
    if (!basePage) {
      urlsAdded.push(targetPage.url);
      continue;
    }

    // Status change
    if (basePage.status !== targetPage.status) {
      const isRegression =
        basePage.status < 400 && targetPage.status >= 400;
      statusChanges.push({
        url: targetPage.url,
        fromStatus: basePage.status,
        toStatus: targetPage.status,
        isRegression,
      });
    }

    // Title change
    if ((basePage.title || "") !== (targetPage.title || "")) {
      metaChanges.push({
        url: targetPage.url,
        field: "title",
        from: basePage.title,
        to: targetPage.title,
      });
    }

    // Description change
    if ((basePage.description || "") !== (targetPage.description || "")) {
      metaChanges.push({
        url: targetPage.url,
        field: "description",
        from: basePage.description,
        to: targetPage.description,
      });
    }

    // Canonical change
    if ((basePage.canonical || "") !== (targetPage.canonical || "")) {
      metaChanges.push({
        url: targetPage.url,
        field: "canonical",
        from: basePage.canonical,
        to: targetPage.canonical,
      });
    }

    // Indexability change
    if (basePage.isIndexable !== targetPage.isIndexable) {
      indexabilityChanges.push({
        url: targetPage.url,
        becameIndexable: targetPage.isIndexable,
        lostIndexability: !targetPage.isIndexable,
        reason: targetPage.blockedByRobots
          ? "blocked by robots.txt"
          : "noindex directive detected",
      });
    }
  }

  // Check removed pages
  for (const [url, basePage] of basePages.entries()) {
    if (!targetPages.has(url)) {
      urlsRemoved.push(basePage.url);
    }
  }

  // Issues delta
  const baseIssueMap = new Map<string, Set<string>>();
  for (const p of baseCrawl.pages) {
    for (const iss of p.auditIssues || []) {
      const set = baseIssueMap.get(iss.id) || new Set<string>();
      set.add(p.url);
      baseIssueMap.set(iss.id, set);
    }
  }

  const targetIssueMap = new Map<string, { issue: any; urls: Set<string> }>();
  for (const p of targetCrawl.pages) {
    for (const iss of p.auditIssues || []) {
      const entry = targetIssueMap.get(iss.id) || { issue: iss, urls: new Set<string>() };
      entry.urls.add(p.url);
      targetIssueMap.set(iss.id, entry);
    }
  }

  const newIssues: IssueDelta[] = [];
  for (const [id, entry] of targetIssueMap.entries()) {
    const baseSet = baseIssueMap.get(id);
    if (!baseSet) {
      newIssues.push({
        issueId: id,
        name: entry.issue.name,
        severity: entry.issue.severity,
        affectedUrls: Array.from(entry.urls),
      });
    } else {
      const brandNewUrls = Array.from(entry.urls).filter((u) => !baseSet.has(u));
      if (brandNewUrls.length > 0) {
        newIssues.push({
          issueId: id,
          name: `${entry.issue.name} (+${brandNewUrls.length} new URLs)`,
          severity: entry.issue.severity,
          affectedUrls: brandNewUrls,
        });
      }
    }
  }

  const resolvedIssues: IssueDelta[] = [];
  for (const [id, baseUrls] of baseIssueMap.entries()) {
    const targetEntry = targetIssueMap.get(id);
    if (!targetEntry) {
      resolvedIssues.push({
        issueId: id,
        name: id,
        severity: "Resolved",
        affectedUrls: Array.from(baseUrls),
      });
    }
  }

  const regressedStatusCount = statusChanges.filter((s) => s.isRegression).length;
  const lostIndexabilityCount = indexabilityChanges.filter((i) => i.lostIndexability).length;
  const isCleanDeploy = regressedStatusCount === 0 && lostIndexabilityCount === 0;

  return {
    baseCrawlId: baseCrawl.id,
    targetCrawlId: targetCrawl.id,
    baseDate: baseCrawl.startedAt,
    targetDate: targetCrawl.startedAt,
    urlsAdded,
    urlsRemoved,
    statusChanges,
    metaChanges,
    indexabilityChanges,
    newIssues,
    resolvedIssues,
    summary: {
      totalBaseUrls: basePages.size,
      totalTargetUrls: targetPages.size,
      addedCount: urlsAdded.length,
      removedCount: urlsRemoved.length,
      statusChangeCount: statusChanges.length,
      regressedStatusCount,
      newIssueCount: newIssues.length,
      resolvedIssueCount: resolvedIssues.length,
      isCleanDeploy,
    },
  };
}

export function formatCrawlDiffMarkdown(diff: CrawlDiffReport): string {
  const lines: string[] = [];
  lines.push(`# Crawl Comparison: ${diff.baseCrawlId} vs ${diff.targetCrawlId}`);
  lines.push(`- **Base Crawl**: ${diff.baseDate} (${diff.summary.totalBaseUrls} pages)`);
  lines.push(`- **Target Crawl**: ${diff.targetDate} (${diff.summary.totalTargetUrls} pages)`);
  lines.push(`- **Deploy Status**: ${diff.summary.isCleanDeploy ? "✅ Clean (No Critical Regressions)" : "⚠️ Regressions Detected"}`);
  lines.push("");

  lines.push(`## Summary Overview`);
  lines.push(`| Metric | Count |`);
  lines.push(`| :--- | :--- |`);
  lines.push(`| Added URLs | +${diff.summary.addedCount} |`);
  lines.push(`| Removed URLs | -${diff.summary.removedCount} |`);
  lines.push(`| Status Code Changes | ${diff.summary.statusChangeCount} (${diff.summary.regressedStatusCount} regressions) |`);
  lines.push(`| Indexability Shifts | ${diff.indexabilityChanges.length} |`);
  lines.push(`| Newly Introduced Issues | ${diff.summary.newIssueCount} |`);
  lines.push(`| Resolved Issues | ${diff.summary.resolvedIssueCount} |`);
  lines.push("");

  if (diff.statusChanges.length > 0) {
    lines.push(`### HTTP Status Code Changes`);
    for (const sc of diff.statusChanges) {
      const icon = sc.isRegression ? "❌" : "ℹ️";
      lines.push(`- ${icon} \`${sc.url}\`: HTTP ${sc.fromStatus} → **HTTP ${sc.toStatus}**`);
    }
    lines.push("");
  }

  if (diff.indexabilityChanges.length > 0) {
    lines.push(`### Indexability Shifts`);
    for (const ic of diff.indexabilityChanges) {
      const icon = ic.lostIndexability ? "🚫 Lost Indexability" : "✅ Became Indexable";
      lines.push(`- ${icon}: \`${ic.url}\` (${ic.reason || "status updated"})`);
    }
    lines.push("");
  }

  if (diff.metaChanges.length > 0) {
    lines.push(`### Key Meta Tag Modifications (${diff.metaChanges.length})`);
    for (const mc of diff.metaChanges.slice(0, 15)) {
      lines.push(`- **${mc.field.toUpperCase()}** on \`${mc.url}\`:`);
      lines.push(`  - *Old*: "${mc.from || "(empty)"}"`);
      lines.push(`  - *New*: "${mc.to || "(empty)"}"`);
    }
    if (diff.metaChanges.length > 15) {
      lines.push(`- *...and ${diff.metaChanges.length - 15} more meta changes.*`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
