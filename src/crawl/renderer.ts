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
    // CLS per web-vitals: largest session window (shifts < 1s apart, window <= 5s),
    // not the lifetime sum.
    let sessionValue = 0, sessionFirst = 0, sessionLast = 0;
    po('layout-shift', (list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        if (sessionValue && e.startTime - sessionLast < 1000 && e.startTime - sessionFirst < 5000) {
          sessionValue += e.value;
        } else {
          sessionValue = e.value;
          sessionFirst = e.startTime;
        }
        sessionLast = e.startTime;
        const cls = Math.round(sessionValue * 1000) / 1000;
        if (cls > window.__seoforgeCwv.cls) window.__seoforgeCwv.cls = cls;
      }
    });
    // INP comes from 'event' timing entries ('interaction' is not an entry type).
    // A lab load has no user input, so this stays 0 unless the page is interacted with.
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.interactionId && e.duration > window.__seoforgeCwv.inp) window.__seoforgeCwv.inp = Math.round(e.duration);
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
    } catch (e) { /* event timing unsupported */ }
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
let sharedBrowserPromise: Promise<any> | null = null;

async function loadChromium(): Promise<any> {
  if (!chromiumPromise) {
    chromiumPromise = (async () => {
      const playwright = await import("playwright");
      return playwright.chromium;
    })();
  }
  return chromiumPromise;
}

async function getSharedBrowser(chromium: any): Promise<any> {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium.launch({ headless: true }).catch((err: any) => {
      sharedBrowserPromise = null;
      throw err;
    });
  }
  return sharedBrowserPromise;
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowserPromise) {
    try {
      const b = await sharedBrowserPromise;
      await b.close();
    } catch {
      /* non-fatal */
    }
    sharedBrowserPromise = null;
  }
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

  const browser = await getSharedBrowser(chromium);
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
    // `load` can fire before the first paint, leaving FCP/LCP empty. Wait for an
    // LCP entry (bounded), then two frames so pending paints and shifts land.
    await page
      .waitForFunction(() => (window as any).__seoforgeCwv?.lcp > 0, null, { timeout: 3000 })
      .catch(() => {});
    await page
      .evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
      .catch(() => {});
    const html = await page.content();
    const finalUrl = page.url();

    let cwv: CoreWebVitals | undefined;
    try {
      const raw = await page.evaluate(() => {
        const cwv = (window as any).__seoforgeCwv;
        // TTFB per web-vitals: responseStart of the navigation entry (was never set).
        const nav = performance.getEntriesByType("navigation")[0] as any;
        if (cwv && nav) cwv.ttfb = Math.max(0, Math.round(nav.responseStart - (nav.activationStart || 0)));
        return cwv;
      });
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
  }
}
