/**
 * Optional Playwright render mode for JavaScript-heavy / SPA sites.
 *
 * Playwright is loaded via a dynamic import so that users who never enable
 * render mode pay zero download/runtime cost. If the package is missing we
 * surface an actionable message rather than crashing the crawl.
 */
import { CoreWebVitals } from "../types.js";

export interface RenderResult {
  html: string;
  finalUrl: string;
  status: number;
  cwv?: CoreWebVitals;
  errorMessage?: string;
}

export interface RenderOptions {
  timeoutMs?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  blockHeavyResources?: boolean;
}

const CWV_INIT_SCRIPT = `
(() => {
  window.__seoforgeCwv = { lcp: 0, cls: 0, inp: 0, fcp: 0, ttfb: 0, resources: 0, bytes: 0 };
  try {
    const po = (type, cb) => new PerformanceObserver(cb).observe({ type, buffered: true });
    po('largest-contentful-paint', (list) => {
      const entries = list.getEntries();
      if (entries.length) window.__seoforgeCwv.lcp = Math.round(entries[entries.length - 1].startTime);
    });
    po('layout-shift', (list) => {
      let cls = 0;
      for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
      window.__seoforgeCwv.cls = Math.round(cls * 1000) / 1000;
    });
    po('interaction', (list) => {
      const entries = list.getEntries();
      if (entries.length) window.__seoforgeCwv.inp = Math.round(entries[entries.length - 1].duration);
    });
    po('paint', (list) => {
      for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') window.__seoforgeCwv.fcp = Math.round(e.startTime);
    });
    po('resource', (list) => {
      const entries = list.getEntries();
      window.__seoforgeCwv.resources = entries.length;
      window.__seoforgeCwv.bytes = entries.reduce((a, e) => a + (e.transferSize || 0), 0);
    });
  } catch (e) { /* non-fatal */ }
})();
`;

let chromiumPromise: Promise<any> | null = null;

async function loadChromium(): Promise<any> {
  if (!chromiumPromise) {
    chromiumPromise = (async () => {
      const playwright = await import("playwright");
      return playwright.chromium;
    })();
  }
  return chromiumPromise;
}

export async function isRenderAvailable(): Promise<boolean> {
  try {
    await loadChromium();
    return true;
  } catch {
    return false;
  }
}

export async function renderUrl(url: string, options: RenderOptions = {}): Promise<RenderResult> {
  const { timeoutMs = 20000, waitUntil = "load", blockHeavyResources = false } = options;

  let chromium;
  try {
    chromium = await loadChromium();
  } catch {
    return {
      html: "",
      finalUrl: url,
      status: 0,
      errorMessage:
        "Playwright is not installed. Render mode requires it: npm install playwright && npx playwright install chromium",
    };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (compatible; SEOForgeBot/2.0; +https://github.com/Aryanban/seoforge)",
    bypassCSP: true,
  });

  try {
    if (blockHeavyResources) {
      await context.route("**/*", (route: any) => {
        const type = route.request().resourceType();
        if (["media", "font"].includes(type)) return route.abort();
        return route.continue();
      });
    }

    const page = await context.newPage();
    await page.addInitScript(CWV_INIT_SCRIPT);

    const response = await page.goto(url, { timeout: timeoutMs, waitUntil });
    const html = await page.content();
    const finalUrl = page.url();

    let cwv: CoreWebVitals | undefined;
    try {
      const raw = await page.evaluate(() => (window as any).__seoforgeCwv);
      if (raw) {
        cwv = {
          lcp: raw.lcp || undefined,
          cls: raw.cls || undefined,
          inp: raw.inp || undefined,
          fcp: raw.fcp || undefined,
          ttfb: raw.ttfb || undefined,
          resourceCount: raw.resources || undefined,
          transferBytes: raw.bytes || undefined,
        };
      }
    } catch {
      /* non-fatal */
    }

    return {
      html,
      finalUrl,
      status: response?.status() ?? 200,
      cwv,
    };
  } catch (err: any) {
    return {
      html: "",
      finalUrl: url,
      status: 0,
      errorMessage: err.message,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
