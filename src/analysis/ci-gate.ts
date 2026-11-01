/**
 * CI/CD SEO Gatekeeper — GitHub Actions & Automated Quality Gate.
 * Enforces strict SEO & AEO standards in CI pipelines.
 * Generates structured pass/fail status and GitHub PR comment markdown.
 */
import { CrawlResult } from "../types.js";

export interface CiGateConfig {
  maxErrors?: number; // default: 0
  maxWarnings?: number; // default: 10
  minAeoScore?: number; // default: 70
  disallow404s?: boolean; // default: true
  disallowNoindexOnCanonical?: boolean; // default: true
}

export interface CiGateViolation {
  rule: string;
  expected: string;
  actual: string;
  severity: "error" | "warning";
}

export interface CiGateResult {
  passed: boolean;
  violations: CiGateViolation[];
  summary: {
    totalErrors: number;
    totalWarnings: number;
    avgAeoScore: number;
    pagesEvaluated: number;
    brokenUrlCount: number;
  };
  markdownReport: string;
}

export function evaluateCiGate(crawl: CrawlResult, config: CiGateConfig = {}): CiGateResult {
  const maxErrors = config.maxErrors ?? 0;
  const maxWarnings = config.maxWarnings ?? 10;
  const minAeoScore = config.minAeoScore ?? 70;
  const disallow404s = config.disallow404s ?? true;
  const disallowNoindexOnCanonical = config.disallowNoindexOnCanonical ?? true;

  const violations: CiGateViolation[] = [];

  // Check error counts
  if (crawl.totalErrors > maxErrors) {
    violations.push({
      rule: "Max Critical Errors",
      expected: `<= ${maxErrors}`,
      actual: `${crawl.totalErrors} errors found`,
      severity: "error",
    });
  }

  // Check warning counts
  if (crawl.totalWarnings > maxWarnings) {
    violations.push({
      rule: "Max Warnings",
      expected: `<= ${maxWarnings}`,
      actual: `${crawl.totalWarnings} warnings found`,
      severity: "warning",
    });
  }

  // Check AEO score
  if (crawl.averageAeoScore < minAeoScore) {
    violations.push({
      rule: "Minimum AEO Score",
      expected: `>= ${minAeoScore}/100`,
      actual: `${Math.round(crawl.averageAeoScore)}/100`,
      severity: "error",
    });
  }

  // Check broken 4xx/5xx URLs
  const brokenPages = crawl.pages.filter((p) => p.status >= 400);
  if (disallow404s && brokenPages.length > 0) {
    violations.push({
      rule: "No Broken (4xx/5xx) Pages",
      expected: "0 broken pages",
      actual: `${brokenPages.length} broken URLs (${brokenPages.slice(0, 3).map((p) => p.url).join(", ")})`,
      severity: "error",
    });
  }

  // Check canonical noindex traps
  const canonicalNoindex = crawl.pages.filter(
    (p) => !p.isIndexable && p.canonicalMatches && p.url === p.canonical
  );
  if (disallowNoindexOnCanonical && canonicalNoindex.length > 0) {
    violations.push({
      rule: "Indexability Integrity",
      expected: "Canonical pages must not be noindexed",
      actual: `${canonicalNoindex.length} pages are self-canonical yet noindexed`,
      severity: "error",
    });
  }

  const hasCriticalViolations = violations.some((v) => v.severity === "error");
  const passed = !hasCriticalViolations;

  // Build markdown PR comment
  const mdLines: string[] = [];
  const statusEmoji = passed ? "✅ **PASSED**" : "❌ **FAILED**";
  mdLines.push(`## 🛡️ SEOForge CI Gate: ${statusEmoji}`);
  mdLines.push("");
  mdLines.push(`- **Target URL**: \`${crawl.targetUrl}\``);
  mdLines.push(`- **Pages Crawled**: ${crawl.pages.length}`);
  mdLines.push(`- **Critical Errors**: ${crawl.totalErrors} (limit: ${maxErrors})`);
  mdLines.push(`- **Warnings**: ${crawl.totalWarnings} (limit: ${maxWarnings})`);
  mdLines.push(`- **Average AEO Score**: ${Math.round(crawl.averageAeoScore)}/100 (min: ${minAeoScore})`);
  mdLines.push("");

  if (violations.length > 0) {
    mdLines.push(`### ⚠️ Quality Gate Violations`);
    mdLines.push(`| Rule | Expected | Actual | Severity |`);
    mdLines.push(`| :--- | :--- | :--- | :--- |`);
    for (const v of violations) {
      const icon = v.severity === "error" ? "🛑 Error" : "⚠️ Warning";
      mdLines.push(`| ${v.rule} | \`${v.expected}\` | \`${v.actual}\` | ${icon} |`);
    }
    mdLines.push("");
  } else {
    mdLines.push(`🎉 **All SEO & AEO criteria met! Ready for production deployment.**`);
  }

  return {
    passed,
    violations,
    summary: {
      totalErrors: crawl.totalErrors,
      totalWarnings: crawl.totalWarnings,
      avgAeoScore: crawl.averageAeoScore,
      pagesEvaluated: crawl.pages.length,
      brokenUrlCount: brokenPages.length,
    },
    markdownReport: mdLines.join("\n"),
  };
}
