/**
 * Redirect Chain & Link Equity Loss Tracer — Ahrefs & Screaming Frog parity.
 * Traces multi-hop redirect chains, detects redirect loops, calculates PageRank / link equity dissipation,
 * and generates 1-hop direct rewrite rules for Next.js, Nginx, Apache, and Cloudflare.
 */

export interface RedirectHop {
  url: string;
  status: number;
}

export interface RedirectChainAnalysis {
  initialUrl: string;
  finalUrl: string;
  totalHops: number;
  isLoop: boolean;
  loopUrl?: string;
  hasMixedStatuses: boolean; // e.g. 302 mixed with 301
  statusCodes: number[];
  estimatedEquityRetentionPct: number; // e.g. 100% for 1 hop, ~85% for 2 hops, ~72% for 3 hops
  estimatedEquityLossPct: number;
  severity: "Critical" | "Warning" | "Good";
  issues: string[];
  recommendation: string;
}

/**
 * Evaluates an ordered redirect chain.
 */
export function analyzeRedirectChain(chain: RedirectHop[]): RedirectChainAnalysis {
  if (chain.length <= 1) {
    const only = chain[0] || { url: "", status: 200 };
    return {
      initialUrl: only.url,
      finalUrl: only.url,
      totalHops: 0,
      isLoop: false,
      hasMixedStatuses: false,
      statusCodes: [only.status],
      estimatedEquityRetentionPct: 100,
      estimatedEquityLossPct: 0,
      severity: "Good",
      issues: [],
      recommendation: "Direct URL with zero redirect hops.",
    };
  }

  const initialUrl = chain[0].url;
  const finalHop = chain[chain.length - 1];
  const finalUrl = finalHop.url;
  const totalHops = chain.length - 1;

  // Check for loops
  const seenUrls = new Set<string>();
  let isLoop = false;
  let loopUrl: string | undefined;

  for (const hop of chain) {
    const norm = hop.url.toLowerCase();
    if (seenUrls.has(norm)) {
      isLoop = true;
      loopUrl = hop.url;
      break;
    }
    seenUrls.add(norm);
  }

  // Check statuses
  const statusCodes = chain.map((h) => h.status);
  const intermediateCodes = statusCodes.slice(0, -1);
  const has302 = intermediateCodes.some((s) => s === 302 || s === 307);
  const has301 = intermediateCodes.some((s) => s === 301 || s === 308);
  const hasMixedStatuses = has302 && has301;

  // Equity Retention calculation
  // 1 hop = 95% retention. Each extra hop drops retention by 15%. Loops drop to 0%.
  let retention = isLoop ? 0 : Math.round(95 * Math.pow(0.85, Math.max(0, totalHops - 1)));
  retention = Math.max(0, Math.min(100, retention));
  const loss = 100 - retention;

  const issues: string[] = [];
  if (isLoop) {
    issues.push(`Redirect Loop detected: "${loopUrl}" redirects back into itself, breaking crawler indexing.`);
  }
  if (totalHops > 2) {
    issues.push(`Long redirect chain of ${totalHops} hops. Google stops following chains after 5 hops and drops crawl rate.`);
  } else if (totalHops === 2) {
    issues.push(`Unnecessary 2-hop redirect chain. Squashing into a direct 1-hop redirect saves latency and link equity.`);
  }
  if (has302) {
    issues.push(`Temporary redirect (302/307) used in redirect sequence; search engines may not transfer link equity.`);
  }

  let severity: RedirectChainAnalysis["severity"] = "Good";
  if (isLoop || totalHops >= 3) {
    severity = "Critical";
  } else if (totalHops >= 2 || has302) {
    severity = "Warning";
  }

  const rec = isLoop
    ? `Break the redirect loop immediately by pointing ${initialUrl} to a valid destination.`
    : totalHops > 1
    ? `Replace multi-hop sequence with a direct permanent 301 redirect from ${initialUrl} straight to ${finalUrl}.`
    : `Redirect is clean (1 hop).`;

  return {
    initialUrl,
    finalUrl,
    totalHops,
    isLoop,
    loopUrl,
    hasMixedStatuses,
    statusCodes,
    estimatedEquityRetentionPct: retention,
    estimatedEquityLossPct: loss,
    severity,
    issues,
    recommendation: rec,
  };
}

/**
 * Generates ready-to-paste redirect configuration rules for modern frameworks and web servers.
 */
export function generateDirectRedirectCode(
  sourceUrl: string,
  targetUrl: string,
  framework: "nextjs" | "nginx" | "apache" | "cloudflare" = "nextjs"
): string {
  let sourcePath = sourceUrl;
  let targetPath = targetUrl;

  try {
    const s = new URL(sourceUrl);
    sourcePath = s.pathname;
  } catch {}
  try {
    const t = new URL(targetUrl);
    targetPath = t.pathname + t.search;
  } catch {}

  switch (framework) {
    case "nextjs":
      return `// Add to next.config.js inside async redirects()
{
  source: '${sourcePath}',
  destination: '${targetPath}',
  permanent: true,
}`;

    case "nginx":
      return `# Add inside server block in /etc/nginx/sites-available
rewrite ^${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$ ${targetUrl} permanent;`;

    case "apache":
      return `# Add to .htaccess
RewriteRule ^${sourcePath.replace(/^\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$ ${targetUrl} [R=301,L]`;

    case "cloudflare":
      return JSON.stringify(
        {
          source_url: sourceUrl,
          target_url: targetUrl,
          status_code: 301,
          preserve_query_string: true,
        },
        null,
        2
      );
  }
}
