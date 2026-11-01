/**
 * PageSpeed & DOM Budget Lab Analyzer — Google Lighthouse & Semrush Site Audit parity.
 * Analyzes DOM complexity, render-blocking scripts, stylesheet bottlenecks,
 * missing dimensions (CLS risk), and payload budgets from raw HTML.
 */
import * as cheerio from "cheerio";

export interface DomMetrics {
  totalElements: number;
  maxDepth: number;
  maxChildNodes: number;
  isExcessive: boolean; // >800 warning, >1400 critical
}

export interface RenderBlockingResource {
  type: "script" | "stylesheet";
  url: string;
  tagSnippet: string;
  recommendation: string;
}

export interface ClsRiskElement {
  tag: "img" | "iframe";
  src: string;
  issue: string;
}

export interface PageSpeedLabReport {
  url: string;
  performanceScore: number; // 0-100 lab estimate
  domMetrics: DomMetrics;
  renderBlockingResources: RenderBlockingResource[];
  clsRisks: ClsRiskElement[];
  payloadStats: {
    htmlSizeBytes: number;
    inlineStyleBytes: number;
    inlineScriptBytes: number;
  };
  recommendations: Array<{ priority: "High" | "Medium" | "Low"; text: string }>;
}

export interface PageSpeedLabInput {
  url: string;
  html: string;
  ttfbMs?: number;
}

/**
 * Calculates max DOM depth and element metrics using Cheerio.
 */
function calculateDomDepth($: cheerio.CheerioAPI): { maxDepth: number; maxChildren: number; total: number } {
  let maxDepth = 0;
  let maxChildren = 0;
  let total = 0;

  function walk(node: any, currentDepth: number) {
    if (!node || node.type !== "tag") return;
    total++;
    if (currentDepth > maxDepth) maxDepth = currentDepth;

    const children = (node.children || []).filter((c: any) => c.type === "tag");
    if (children.length > maxChildren) maxChildren = children.length;

    for (const child of children) {
      walk(child, currentDepth + 1);
    }
  }

  const root = $.root()[0];
  if (root) {
    const topElements = (root.children || []).filter((c: any) => c.type === "tag");
    for (const el of topElements) {
      walk(el, 1);
    }
  }

  return { maxDepth, maxChildren, total };
}

/**
 * Analyzes DOM structure, render blocking resources, and CLS risks.
 */
export function analyzePageSpeedLab(input: PageSpeedLabInput): PageSpeedLabReport {
  const { url, html, ttfbMs = 150 } = input;
  const $ = cheerio.load(html);

  const { maxDepth, maxChildren, total } = calculateDomDepth($);
  const domMetrics: DomMetrics = {
    totalElements: total,
    maxDepth,
    maxChildNodes: maxChildren,
    isExcessive: total > 800,
  };

  const renderBlocking: RenderBlockingResource[] = [];
  const clsRisks: ClsRiskElement[] = [];

  // Check scripts in <head>
  $("head script").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      const isAsync = $(el).attr("async") !== undefined;
      const isDefer = $(el).attr("defer") !== undefined;
      const isModule = $(el).attr("type") === "module";
      if (!isAsync && !isDefer && !isModule) {
        renderBlocking.push({
          type: "script",
          url: src,
          tagSnippet: $.html(el).slice(0, 100),
          recommendation: `Add 'defer' or 'async' to <script src="${src}"> to prevent blocking first paint.`,
        });
      }
    }
  });

  // Check CSS stylesheets in <head>
  $("head link[rel='stylesheet']").each((_, el) => {
    const href = $(el).attr("href");
    const media = $(el).attr("media");
    if (href && (!media || media === "all" || media === "screen")) {
      // Normal stylesheets in head block render
      renderBlocking.push({
        type: "stylesheet",
        url: href,
        tagSnippet: $.html(el).slice(0, 100),
        recommendation: `Preload critical CSS or split non-critical rules (<link rel="preload" as="style">).`,
      });
    }
  });

  // Check images for missing dimensions (CLS risk)
  $("img").each((_, el) => {
    const src = $(el).attr("src") || "";
    const w = $(el).attr("width");
    const h = $(el).attr("height");
    const style = $(el).attr("style") || "";
    const hasAspectRatio = style.includes("aspect-ratio");

    if ((!w || !h) && !hasAspectRatio) {
      clsRisks.push({
        tag: "img",
        src,
        issue: `Image is missing explicit width and height attributes (or aspect-ratio CSS). Causes Cumulative Layout Shift.`,
      });
    }
  });

  // Check iframes for missing dimensions
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") || "";
    const w = $(el).attr("width");
    const h = $(el).attr("height");
    if (!w || !h) {
      clsRisks.push({
        tag: "iframe",
        src,
        issue: `Embedded iframe is missing width/height attributes.`,
      });
    }
  });

  // Payload stats
  let inlineStyles = 0;
  $("style").each((_, el) => {
    inlineStyles += $(el).text().length;
  });

  let inlineScripts = 0;
  $("script:not([src])").each((_, el) => {
    inlineScripts += $(el).text().length;
  });

  // Score computation
  let score = 100;
  if (ttfbMs > 800) score -= 20;
  else if (ttfbMs > 400) score -= 10;

  if (domMetrics.totalElements > 1400) score -= 25;
  else if (domMetrics.totalElements > 800) score -= 15;

  if (domMetrics.maxDepth > 32) score -= 10;

  score -= Math.min(30, renderBlocking.length * 8);
  score -= Math.min(20, clsRisks.length * 4);

  score = Math.max(10, Math.min(100, Math.round(score)));

  const recs: Array<{ priority: "High" | "Medium" | "Low"; text: string }> = [];

  if (renderBlocking.length > 0) {
    recs.push({
      priority: "High",
      text: `Eliminate ${renderBlocking.length} render-blocking resource(s) in <head> by adding 'defer' to scripts and preloading non-critical CSS.`,
    });
  }

  if (clsRisks.length > 0) {
    recs.push({
      priority: "High",
      text: `Set explicit width and height attributes on ${clsRisks.length} image(s)/iframe(s) to stabilize Core Web Vitals (CLS).`,
    });
  }

  if (domMetrics.totalElements > 800) {
    recs.push({
      priority: domMetrics.totalElements > 1400 ? "High" : "Medium",
      text: `Excessive DOM size detected (${domMetrics.totalElements} elements). Google recommends keeping DOM trees under 800 nodes.`,
    });
  }

  if (ttfbMs > 500) {
    recs.push({
      priority: "Medium",
      text: `Server TTFB was ${ttfbMs}ms. Enable server-side page caching, edge CDN caching, or database query optimizations.`,
    });
  }

  return {
    url,
    performanceScore: score,
    domMetrics,
    renderBlockingResources: renderBlocking,
    clsRisks,
    payloadStats: {
      htmlSizeBytes: Buffer.byteLength(html, "utf-8"),
      inlineStyleBytes: inlineStyles,
      inlineScriptBytes: inlineScripts,
    },
    recommendations: recs,
  };
}
