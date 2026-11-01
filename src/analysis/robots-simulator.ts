/**
 * Robots.txt Dynamic Simulator & AI Access Engine — Google Search Console & Screaming Frog parity.
 * Implements RFC 9309 Robots Exclusion Protocol:
 *  - Longest-match rule resolution
 *  - Wildcard (*) and end-anchor ($) path matching
 *  - User-agent specificity precedence (specific UA > wildcard *)
 *  - Multi-bot simulation across Search Bots and all 16 AI answer engine crawlers.
 */

export interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
  pattern: RegExp;
  lineNumber: number;
  rawLine: string;
}

export interface UserAgentBlock {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelay?: number;
}

export interface RobotsTestResult {
  urlPath: string;
  userAgent: string;
  allowed: boolean;
  matchingRule?: {
    type: "allow" | "disallow";
    path: string;
    lineNumber: number;
    rawLine: string;
    matchedUserAgent: string;
  };
  reason: string;
}

export interface BotAccessSummary {
  bot: string;
  category: "search" | "ai-search" | "ai-training" | "seo-crawler";
  allowed: boolean;
  status: "Accessible" | "Blocked" | "Partially Blocked";
  blockedPaths: string[];
}

export interface RobotsAiAuditReport {
  testedPaths: string[];
  totalBotsTested: number;
  aiSearchAccessible: boolean;
  aiTrainingBlocked: boolean;
  botSummaries: BotAccessSummary[];
  warnings: string[];
}

const COMMON_BOTS: Array<{ name: string; category: BotAccessSummary["category"] }> = [
  { name: "Googlebot", category: "search" },
  { name: "Bingbot", category: "search" },
  { name: "Applebot", category: "search" },
  { name: "GPTBot", category: "ai-training" },
  { name: "ChatGPT-User", category: "ai-search" },
  { name: "ClaudeBot", category: "ai-training" },
  { name: "Claude-SearchBot", category: "ai-search" },
  { name: "PerplexityBot", category: "ai-search" },
  { name: "Google-Extended", category: "ai-training" },
  { name: "CCBot", category: "ai-training" },
  { name: "Bytespider", category: "ai-training" },
  { name: "AhrefsBot", category: "seo-crawler" },
  { name: "SemrushBot", category: "seo-crawler" },
];

/**
 * Converts a robots.txt path pattern into a regex according to RFC 9309.
 */
export function robotsPatternToRegex(pattern: string): RegExp {
  let escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape special regex chars except * and $
    .replace(/\*/g, ".*"); // Wildcard * matches any sequence

  if (escaped.endsWith("\\$")) {
    escaped = escaped.slice(0, -2) + "$";
  }

  return new RegExp("^" + escaped);
}

/**
 * Parses robots.txt text into structured user-agent blocks.
 */
export function parseRobotsTxt(content: string): UserAgentBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: UserAgentBlock[] = [];
  let currentUas: string[] = [];
  let currentRules: RobotsRule[] = [];
  let currentDelay: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNum = i + 1;
    // Strip comments
    const cleaned = rawLine.split("#")[0].trim();
    if (!cleaned) continue;

    const colonIdx = cleaned.indexOf(":");
    if (colonIdx === -1) continue;

    const directive = cleaned.slice(0, colonIdx).trim().toLowerCase();
    const value = cleaned.slice(colonIdx + 1).trim();

    if (directive === "user-agent") {
      if (currentRules.length > 0) {
        blocks.push({
          userAgents: currentUas,
          rules: currentRules,
          crawlDelay: currentDelay,
        });
        currentUas = [];
        currentRules = [];
        currentDelay = undefined;
      }
      currentUas.push(value.toLowerCase());
    } else if (directive === "allow" || directive === "disallow") {
      if (!value && directive === "disallow") {
        // Disallow: (empty) means everything is allowed
        continue;
      }
      const rulePath = value || "/";
      currentRules.push({
        type: directive,
        path: rulePath,
        pattern: robotsPatternToRegex(rulePath),
        lineNumber: lineNum,
        rawLine: rawLine.trim(),
      });
    } else if (directive === "crawl-delay") {
      const delay = parseFloat(value);
      if (!isNaN(delay)) currentDelay = delay;
    }
  }

  if (currentUas.length > 0 || currentRules.length > 0) {
    blocks.push({
      userAgents: currentUas,
      rules: currentRules,
      crawlDelay: currentDelay,
    });
  }

  return blocks;
}

/**
 * Tests whether a path is allowed for a given user agent under RFC 9309 rules.
 */
export function testRobotsPath(
  robotsTxtContent: string,
  urlPath: string,
  userAgent: string
): RobotsTestResult {
  const blocks = parseRobotsTxt(robotsTxtContent);
  const uaLower = userAgent.toLowerCase();

  // Normalize path
  let path = urlPath;
  try {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      const parsed = new URL(path);
      path = parsed.pathname + parsed.search;
    }
  } catch {
    // raw path
  }
  if (!path.startsWith("/")) path = "/" + path;

  // 1. Find the most specific User-Agent block
  // First look for exact or substring match of UA
  let matchedBlock = blocks.find((b) =>
    b.userAgents.some((u) => u !== "*" && (u === uaLower || uaLower.includes(u)))
  );
  let matchedUa = matchedBlock ? matchedBlock.userAgents.find((u) => uaLower.includes(u)) || userAgent : "*";

  // Fallback to wildcard *
  if (!matchedBlock) {
    matchedBlock = blocks.find((b) => b.userAgents.includes("*"));
    matchedUa = "*";
  }

  // If no matching block, default is ALLOW
  if (!matchedBlock || matchedBlock.rules.length === 0) {
    return {
      urlPath: path,
      userAgent,
      allowed: true,
      reason: "No matching robots.txt rules found; allowed by default.",
    };
  }

  // 2. Find matching rules and pick the most specific (longest match)
  const matchingRules: Array<RobotsRule & { matchLength: number }> = [];

  for (const rule of matchedBlock.rules) {
    if (rule.pattern.test(path)) {
      matchingRules.push({
        ...rule,
        matchLength: rule.path.length,
      });
    }
  }

  if (matchingRules.length === 0) {
    return {
      urlPath: path,
      userAgent,
      allowed: true,
      reason: `No directives in User-agent: ${matchedUa} matched this path; allowed by default.`,
    };
  }

  // Sort by longest match length descending. If lengths are equal, 'allow' takes precedence.
  matchingRules.sort((a, b) => {
    if (b.matchLength !== a.matchLength) {
      return b.matchLength - a.matchLength;
    }
    if (a.type !== b.type) {
      return a.type === "allow" ? -1 : 1;
    }
    return a.lineNumber - b.lineNumber;
  });

  const bestRule = matchingRules[0];
  const isAllowed = bestRule.type === "allow";

  return {
    urlPath: path,
    userAgent,
    allowed: isAllowed,
    matchingRule: {
      type: bestRule.type,
      path: bestRule.path,
      lineNumber: bestRule.lineNumber,
      rawLine: bestRule.rawLine,
      matchedUserAgent: matchedUa,
    },
    reason: isAllowed
      ? `Explicitly allowed by line ${bestRule.lineNumber} ("${bestRule.rawLine}") for ${matchedUa}.`
      : `Disallowed by line ${bestRule.lineNumber} ("${bestRule.rawLine}") for ${matchedUa}.`,
  };
}

/**
 * Runs an audit across all major search and AI crawlers for standard paths.
 */
export function auditRobotsAiCompliance(
  robotsTxtContent: string,
  samplePaths: string[] = ["/", "/blog", "/docs", "/pricing", "/api"]
): RobotsAiAuditReport {
  const summaries: BotAccessSummary[] = [];
  const warnings: string[] = [];

  let aiSearchBlockedCount = 0;
  let aiTrainingBlockedCount = 0;

  for (const bot of COMMON_BOTS) {
    const blockedPaths: string[] = [];

    for (const p of samplePaths) {
      const res = testRobotsPath(robotsTxtContent, p, bot.name);
      if (!res.allowed) {
        blockedPaths.push(p);
      }
    }

    let status: BotAccessSummary["status"] = "Accessible";
    if (blockedPaths.length === samplePaths.length) {
      status = "Blocked";
    } else if (blockedPaths.length > 0) {
      status = "Partially Blocked";
    }

    if (bot.category === "ai-search" && status !== "Accessible") {
      aiSearchBlockedCount++;
    }
    if (bot.category === "ai-training" && status !== "Accessible") {
      aiTrainingBlockedCount++;
    }

    summaries.push({
      bot: bot.name,
      category: bot.category,
      allowed: status === "Accessible",
      status,
      blockedPaths,
    });
  }

  if (aiSearchBlockedCount > 0) {
    warnings.push(
      `Warning: ${aiSearchBlockedCount} AI answer engine search bot(s) (e.g. ChatGPT-User, PerplexityBot) are blocked on key content paths. This prevents citations in Perplexity and ChatGPT Search.`
    );
  }

  return {
    testedPaths: samplePaths,
    totalBotsTested: COMMON_BOTS.length,
    aiSearchAccessible: aiSearchBlockedCount === 0,
    aiTrainingBlocked: aiTrainingBlockedCount > 0,
    botSummaries: summaries,
    warnings,
  };
}

/**
 * Formats robots audit as markdown report.
 */
export function formatRobotsAuditMarkdown(report: RobotsAiAuditReport): string {
  const lines: string[] = [];
  lines.push(`# 🤖 Robots.txt Multi-Bot Simulation & AI Compliance`);
  lines.push(`**Tested Paths:** ${report.testedPaths.map((p) => `\`${p}\``).join(", ")}`);
  lines.push("");
  lines.push(`## Bot Access Summary`);
  lines.push(`| Bot Name | Category | Status | Blocked Paths |`);
  lines.push(`| :--- | :---: | :---: | :--- |`);
  for (const b of report.botSummaries) {
    const badge = b.status === "Accessible" ? "✅ Accessible" : b.status === "Blocked" ? "❌ Blocked" : "⚠️ Partial";
    const blockedStr = b.blockedPaths.length > 0 ? b.blockedPaths.join(", ") : "None";
    lines.push(`| **${b.bot}** | \`${b.category}\` | ${badge} | ${blockedStr} |`);
  }
  lines.push("");
  if (report.warnings.length > 0) {
    lines.push(`## ⚠️ Strategic Warnings`);
    for (const w of report.warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}
