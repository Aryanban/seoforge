/**
 * AI-crawler registry — definitive user-agent tokens + robots.txt tokens for
 * every significant AI search/training bot, with a robots.txt posture audit.
 *
 * Sources (fetched 2026-10-16):
 * - canaicrawl.com/bots directory (30 bots, exact UA strings tested live)
 * - Geodocs.dev AI Search Bot Changelog Reference (May 2026): OpenAI 3-bot
 *   model (GPTBot / OAI-SearchBot / ChatGPT-User), Anthropic 3-bot model
 *   (ClaudeBot / Claude-User / Claude-SearchBot, all honour robots.txt incl.
 *   Crawl-delay), PerplexityBot/Perplexity-User + Cloudflare stealth note,
 *   Google-Extended = robots.txt token only, does NOT block AI Overviews
 *   (Overviews use the regular Google index).
 */

export type AiBotRole = "ai-search" | "ai-training" | "user-fetcher" | "robots-token";

export interface AiBot {
  token: string; // robots.txt User-agent token (substring of UA, except robots-token-only)
  userAgent: string; // full UA string (empty when token-only)
  operator: string;
  role: AiBotRole;
  respectsRobots: boolean;
  purpose: string;
}

export const AI_BOTS: AiBot[] = [
  { token: "OAI-SearchBot", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot", operator: "OpenAI", role: "ai-search", respectsRobots: true, purpose: "Builds the index ChatGPT Search answers from and cites. Blocking removes the site from ChatGPT Search citations." },
  { token: "PerplexityBot", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", operator: "Perplexity", role: "ai-search", respectsRobots: true, purpose: "Crawls for Perplexity AI answers. Blocking keeps the site out of Perplexity answers." },
  { token: "Claude-SearchBot", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)", operator: "Anthropic", role: "ai-search", respectsRobots: true, purpose: "Builds the index Claude Search answers from. Blocking removes Claude citations." },
  { token: "DuckAssistBot", userAgent: "DuckAssistBot/1.0; (+http://duckduckgo.com/duckassistbot.html)", operator: "DuckDuckGo", role: "ai-search", respectsRobots: true, purpose: "Feeds DuckDuckGo AI-assisted answers." },
  { token: "Amazonbot", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/600.2.5 (KHTML, like Gecko) Version/8.0.2 Safari/600.2.5 (Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)", operator: "Amazon", role: "ai-search", respectsRobots: true, purpose: "Feeds Alexa / Rufus answers and product understanding." },
  { token: "YouBot", userAgent: "Mozilla/5.0 (compatible; YouBot (+http://www.you.com))", operator: "You.com", role: "ai-search", respectsRobots: true, purpose: "Crawls for You.com AI search answers." },
  { token: "GPTBot", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot", operator: "OpenAI", role: "ai-training", respectsRobots: true, purpose: "Collects pages to TRAIN models. Blocking does NOT affect ChatGPT Search or AI answers." },
  { token: "ClaudeBot", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", operator: "Anthropic", role: "ai-training", respectsRobots: true, purpose: "Training crawler for Claude models (honours Crawl-delay). Blocking does not affect Claude answers." },
  { token: "CCBot", userAgent: "CCBot/2.0 (https://commoncrawl.org/faq/)", operator: "Common Crawl", role: "ai-training", respectsRobots: true, purpose: "Open crawl corpus that trains most LLMs. Blocking opts out of the shared training dataset." },
  { token: "Bytespider", userAgent: "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)", operator: "ByteDance", role: "ai-training", respectsRobots: true, purpose: "Training crawler for TikTok/ByteDance models." },
  { token: "ChatGPT-User", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", operator: "OpenAI", role: "user-fetcher", respectsRobots: true, purpose: "Live fetch when a person asks ChatGPT about a page. Blocking means ChatGPT cannot open the page on request." },
  { token: "Claude-User", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)", operator: "Anthropic", role: "user-fetcher", respectsRobots: true, purpose: "Live fetch when a Claude user pastes a URL." },
  { token: "Perplexity-User", userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)", operator: "Perplexity", role: "user-fetcher", respectsRobots: true, purpose: "Live fetch for Perplexity user requests. Note: some Perplexity traffic rotates ASNs (Cloudflare-documented); robots.txt alone is not sufficient." },
  { token: "MistralAI-User", userAgent: "Mozilla/5.0 (compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)", operator: "Mistral AI", role: "user-fetcher", respectsRobots: true, purpose: "Live fetch for Le Chat user requests." },
  { token: "Google-Extended", userAgent: "", operator: "Google", role: "robots-token", respectsRobots: true, purpose: "robots.txt token ONLY (never sent as UA). Controls Gemini/Vertex AI training+grounding. Does NOT block AI Overviews (those use the Google Search index)." },
  { token: "Applebot-Extended", userAgent: "", operator: "Apple", role: "robots-token", respectsRobots: true, purpose: "robots.txt token ONLY. Controls Apple Intelligence training." },
];

export interface AiBotRuleState {
  token: string;
  role: AiBotRole;
  operator: string;
  disallowed: boolean; // explicit Disallow covering / for this token
  allowed: boolean;
  coveredByWildcard: boolean;
}

export interface AiPostureReport {
  rules: AiBotRuleState[];
  blockedSearchBots: string[]; // ai-search bots blocked => visibility loss
  blockedFetchers: string[]; // user-fetcher bots blocked => assistant cannot open pages
  trainingBlocked: string[]; // informational
  recommendations: string[];
}

/**
 * Audit robots.txt content against the AI-bot registry.
 * Parses User-agent groups + Disallow/Allow lines deterministically
 * (no dependency on robots-parser internals).
 */
export function auditAiBotPosture(robotsTxt: string): AiPostureReport {
  interface Group { agents: string[]; disallows: string[]; allows: string[]; }
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of (robotsTxt || "").split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase(); const value = m[2].trim();
    if (field === "user-agent") {
      if (!lastWasAgent || !current) { current = { agents: [], disallows: [], allows: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "disallow") { if (current) current.disallows.push(value); lastWasAgent = false; }
    else if (field === "allow") { if (current) current.allows.push(value); lastWasAgent = false; }
    else lastWasAgent = false;
  }

  const stateFor = (tokenLower: string): { dis: boolean; allow: boolean } => {
    let dis = false; let allow = false;
    for (const g of groups) {
      if (!g.agents.includes(tokenLower)) continue;
      if (g.disallows.some((d) => d === "/" || d === "/*" || d === "")) {
        if (g.disallows.some((d) => d === "")) allow = true;
        else if (!g.allows.some((a) => a === "/")) dis = true;
      }
      if (g.allows.some((a) => a === "/")) { allow = true; dis = false; }
    }
    return { dis, allow };
  };
  const wildcard = stateFor("*");

  const rules: AiBotRuleState[] = AI_BOTS.map((b) => {
    const s = stateFor(b.token.toLowerCase());
    const disallowed = s.dis || (!s.allow && wildcard.dis);
    return { token: b.token, role: b.role, operator: b.operator, disallowed, allowed: s.allow || (!disallowed), coveredByWildcard: wildcard.dis && !s.allow };
  });

  const blockedSearchBots = rules.filter((r) => r.role === "ai-search" && r.disallowed).map((r) => r.token);
  const blockedFetchers = rules.filter((r) => r.role === "user-fetcher" && r.disallowed).map((r) => r.token);
  const trainingBlocked = rules.filter((r) => r.role === "ai-training" && r.disallowed).map((r) => r.token);

  const recommendations: string[] = [];
  if (blockedSearchBots.length > 0) recommendations.push(`AI-SEARCH VISIBILITY LOSS: ${blockedSearchBots.join(", ")} blocked — the site cannot be cited in those AI answers. Allow these bots unless exclusion is deliberate.`);
  if (blockedFetchers.length > 0) recommendations.push(`ASSISTANT FETCH BLOCKED: ${blockedFetchers.join(", ")} blocked — assistants cannot open site pages when users ask. This is user-triggered traffic, not training.`);
  if (trainingBlocked.length > 0) recommendations.push(`Training opt-out active for: ${trainingBlocked.join(", ")}. This does not affect search or AI-answer citations.`);
  const ge = rules.find((r) => r.token === "Google-Extended");
  if (ge && !ge.disallowed) recommendations.push("Google-Extended is allowed: Gemini/Vertex may train on and ground from site content. Disallow it to opt out of AI training (AI Overviews unaffected — they use the Search index).");

  return { rules, blockedSearchBots, blockedFetchers, trainingBlocked, recommendations };
}
