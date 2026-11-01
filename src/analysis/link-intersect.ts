/**
 * Link Intersect Engine — Ahrefs "Link Intersect" parity and superpower.
 * Discovers high-authority referring domains and backlink opportunities
 * that link to multiple competitors, but do NOT link to your target site.
 * Cross-references with the 206-source publishing catalog for actionable outreach.
 */
import { loadSources } from "../publishing/sources.js";

export interface CompetitorBacklinkInput {
  targetDomain: string;
  targetBacklinks?: string[]; // Backlink URLs or referring domain strings
  competitors: Array<{
    domain: string;
    backlinks: string[]; // URLs or referring domains
  }>;
  minCompetitorOverlap?: number; // Minimum competitors linking to be considered a strong gap (default: 2)
}

export interface IntersectDomain {
  referringDomain: string;
  linkingToCompetitors: string[];
  competitorCount: number;
  sampleLinks: Record<string, string[]>;
  hasTargetLink: boolean;
  priority: "Critical" | "High" | "Medium" | "Low";
  catalogMatch?: {
    id: string;
    name: string;
    kind: string;
    url: string;
    topics: string[];
  };
  outreachAdvice: string;
}

export interface LinkIntersectReport {
  targetDomain: string;
  competitorDomains: string[];
  totalReferringDomainsAnalyzed: number;
  gapDomainCount: number;
  highPriorityGaps: IntersectDomain[];
  matrix: IntersectDomain[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    catalogMatchesCount: number;
  };
}

/**
 * Normalizes a URL or domain string to a clean root hostname (e.g. "sub.example.com" or "example.com").
 */
export function extractRootDomain(urlOrDomain: string): string {
  if (!urlOrDomain) return "";
  let clean = urlOrDomain.trim().toLowerCase();
  try {
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = "https://" + clean;
    }
    const parsed = new URL(clean);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return clean.replace(/^www\./, "").split("/")[0] || clean;
  }
}

/**
 * Analyzes link intersect across target domain and multiple competitor backlink profiles.
 */
export function analyzeLinkIntersect(input: CompetitorBacklinkInput): LinkIntersectReport {
  const targetRoot = extractRootDomain(input.targetDomain);
  const minOverlap = input.minCompetitorOverlap ?? 2;
  const competitors = input.competitors.map((c) => ({
    domain: extractRootDomain(c.domain),
    backlinks: c.backlinks,
  }));

  // Build target referring domains set
  const targetReferringDomains = new Set<string>();
  for (const bl of input.targetBacklinks || []) {
    const domain = extractRootDomain(bl);
    if (domain && domain !== targetRoot) {
      targetReferringDomains.add(domain);
    }
  }

  // Load publishing catalog for cross-referencing
  const catalog = loadSources();
  const catalogMap = new Map<string, (typeof catalog)[0]>();
  for (const item of catalog) {
    const d = extractRootDomain(item.website_url);
    if (d) catalogMap.set(d, item);
  }

  // Domain -> Competitor -> URLs
  const domainMap = new Map<string, { competitorMap: Map<string, string[]> }>();

  for (const comp of competitors) {
    for (const link of comp.backlinks) {
      const refDomain = extractRootDomain(link);
      if (!refDomain || refDomain === comp.domain || refDomain === targetRoot) {
        continue;
      }

      let entry = domainMap.get(refDomain);
      if (!entry) {
        entry = { competitorMap: new Map<string, string[]>() };
        domainMap.set(refDomain, entry);
      }

      const existingUrls = entry.competitorMap.get(comp.domain) || [];
      if (existingUrls.length < 5) {
        existingUrls.push(link);
      }
      entry.competitorMap.set(comp.domain, existingUrls);
    }
  }

  const matrix: IntersectDomain[] = [];
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let catalogMatchesCount = 0;

  for (const [refDomain, data] of domainMap.entries()) {
    const linkingComps = Array.from(data.competitorMap.keys());
    const compCount = linkingComps.length;
    const hasTarget = targetReferringDomains.has(refDomain);

    const sampleLinks: Record<string, string[]> = {};
    for (const [comp, urls] of data.competitorMap.entries()) {
      sampleLinks[comp] = urls;
    }

    const catMatch = catalogMap.get(refDomain);
    if (catMatch) catalogMatchesCount++;

    // Prioritize gap domains
    let priority: "Critical" | "High" | "Medium" | "Low" = "Low";
    let advice = "";

    if (!hasTarget) {
      if (compCount >= competitors.length && competitors.length > 1) {
        priority = "Critical";
        criticalCount++;
        advice = `Dominant industry hub: all ${compCount} competitors have backlinks from ${refDomain}. Critical outreach priority.`;
      } else if (compCount >= minOverlap) {
        priority = "High";
        highCount++;
        advice = `Strong common link source: ${compCount} competitors covered. Pitch editorial, resource guide, or product integration.`;
      } else {
        priority = "Medium";
        mediumCount++;
        advice = `Competitor foothold: links to ${linkingComps[0]}. Review target anchor context for replication.`;
      }
    } else {
      advice = `Already covered: target site already has a backlink profile on ${refDomain}.`;
    }

    if (catMatch) {
      advice += ` (Available in SEOForge Publishing Catalog as "${catMatch.name}" [${catMatch.kind}]).`;
    }

    matrix.push({
      referringDomain: refDomain,
      linkingToCompetitors: linkingComps,
      competitorCount: compCount,
      sampleLinks,
      hasTargetLink: hasTarget,
      priority,
      catalogMatch: catMatch
        ? {
            id: catMatch.id,
            name: catMatch.name,
            kind: catMatch.kind,
            url: catMatch.website_url,
            topics: catMatch.topics,
          }
        : undefined,
      outreachAdvice: advice,
    });
  }

  // Sort: gaps first, highest competitor count first, priority first
  matrix.sort((a, b) => {
    if (a.hasTargetLink !== b.hasTargetLink) {
      return a.hasTargetLink ? 1 : -1; // non-targets first
    }
    if (b.competitorCount !== a.competitorCount) {
      return b.competitorCount - a.competitorCount;
    }
    const pWeight = { Critical: 3, High: 2, Medium: 1, Low: 0 };
    return pWeight[b.priority] - pWeight[a.priority];
  });

  const highPriorityGaps = matrix.filter(
    (m) => !m.hasTargetLink && (m.priority === "Critical" || m.priority === "High")
  );

  return {
    targetDomain: targetRoot,
    competitorDomains: competitors.map((c) => c.domain),
    totalReferringDomainsAnalyzed: domainMap.size,
    gapDomainCount: matrix.filter((m) => !m.hasTargetLink).length,
    highPriorityGaps,
    matrix,
    summary: {
      critical: criticalCount,
      high: highCount,
      medium: mediumCount,
      catalogMatchesCount,
    },
  };
}

/**
 * Formats link intersect analysis as a polished markdown report.
 */
export function formatLinkIntersectMarkdown(report: LinkIntersectReport): string {
  const lines: string[] = [];
  lines.push(`# 🔗 Link Intersect & Backlink Gap Report`);
  lines.push(`**Target Site:** \`${report.targetDomain}\``);
  lines.push(`**Competitors Analyzed:** ${report.competitorDomains.map((d) => `\`${d}\``).join(", ")}`);
  lines.push("");
  lines.push(`## Executive Summary`);
  lines.push(`- **Total Referring Domains Discovered:** ${report.totalReferringDomainsAnalyzed}`);
  lines.push(`- **Unclaimed Gap Domains (Linking to Competitors, 0 to You):** ${report.gapDomainCount}`);
  lines.push(`- **Critical Gaps (Linking to ALL competitors):** ${report.summary.critical}`);
  lines.push(`- **High Priority Gaps (Linking to $\\ge 2$ competitors):** ${report.summary.high}`);
  lines.push(`- **Catalog Matched Sources (Direct Action Available):** ${report.summary.catalogMatchesCount}`);
  lines.push("");

  if (report.highPriorityGaps.length > 0) {
    lines.push(`## 🎯 High-Priority Outreach Targets`);
    lines.push(`| Referring Domain | Competitors Linking | Priority | Actionable Advice |`);
    lines.push(`| :--- | :---: | :---: | :--- |`);
    for (const gap of report.highPriorityGaps.slice(0, 20)) {
      const catBadge = gap.catalogMatch ? ` 📘 *(${gap.catalogMatch.name})*` : "";
      lines.push(
        `| **${gap.referringDomain}**${catBadge} | ${gap.competitorCount} (${gap.linkingToCompetitors.join(", ")}) | \`${gap.priority}\` | ${gap.outreachAdvice} |`
      );
    }
    lines.push("");
  }

  lines.push(`## Complete Backlink Matrix`);
  lines.push(`| Domain | You Link? | Comp Count | Competitor Coverage |`);
  lines.push(`| :--- | :---: | :---: | :--- |`);
  for (const row of report.matrix.slice(0, 50)) {
    const you = row.hasTargetLink ? "✅ Yes" : "❌ No";
    lines.push(`| \`${row.referringDomain}\` | ${you} | ${row.competitorCount} | ${row.linkingToCompetitors.join(", ")} |`);
  }

  return lines.join("\n");
}
