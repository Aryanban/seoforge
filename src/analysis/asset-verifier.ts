/**
 * High-Speed Internal Asset & Resource Verifier — Screaming Frog & Site Audit parity.
 * Verifies internal images, scripts, stylesheets, and iframes using lightweight HEAD probes.
 * Employs an in-memory cache to ensure identical assets are checked only once across a crawl.
 */
import * as cheerio from "cheerio";
import { fetchPage } from "../crawl/fetcher.js";

export interface AssetRecord {
  url: string;
  type: "image" | "script" | "stylesheet" | "iframe";
  foundOnUrl: string;
  status: number;
  isBroken: boolean;
  error?: string;
}

export interface AssetVerificationReport {
  totalAssetsFound: number;
  uniqueAssetsChecked: number;
  brokenAssetsCount: number;
  brokenAssets: AssetRecord[];
}

export class AssetVerifier {
  private cache = new Map<string, { status: number; isBroken: boolean; error?: string }>();

  /**
   * Extracts all internal assets from an HTML document.
   */
  extractAssets(html: string, pageUrl: string): Array<{ url: string; type: AssetRecord["type"] }> {
    const assets: Array<{ url: string; type: AssetRecord["type"] }> = [];
    const $ = cheerio.load(html);
    const baseOrigin = new URL(pageUrl).origin;

    const resolveInternal = (raw: string | undefined): string | null => {
      if (!raw || raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("javascript:")) return null;
      try {
        const resolved = new URL(raw, pageUrl);
        if (resolved.origin === baseOrigin) return resolved.href;
        return null; // internal only for priority verification
      } catch {
        return null;
      }
    };

    $("img").each((_, el) => {
      const src = resolveInternal($(el).attr("src"));
      if (src) assets.push({ url: src, type: "image" });
    });

    $("script[src]").each((_, el) => {
      const src = resolveInternal($(el).attr("src"));
      if (src) assets.push({ url: src, type: "script" });
    });

    $("link[rel='stylesheet']").each((_, el) => {
      const href = resolveInternal($(el).attr("href"));
      if (href) assets.push({ url: href, type: "stylesheet" });
    });

    $("iframe[src]").each((_, el) => {
      const src = resolveInternal($(el).attr("src"));
      if (src) assets.push({ url: src, type: "iframe" });
    });

    return assets;
  }

  /**
   * Probes asset status using fast HEAD requests.
   */
  async probeAsset(url: string, timeoutMs = 5000): Promise<{ status: number; isBroken: boolean; error?: string }> {
    if (this.cache.has(url)) {
      return this.cache.get(url)!;
    }

    try {
      const res = await fetchPage(url, { method: "HEAD", timeoutMs, followRedirects: true });
      const isBroken = res.status >= 400 || res.status === 0;
      const record = { status: res.status, isBroken };
      this.cache.set(url, record);
      return record;
    } catch (err: any) {
      const record = { status: 0, isBroken: true, error: err.message };
      this.cache.set(url, record);
      return record;
    }
  }

  /**
   * Batch verifies all assets on a page.
   */
  async verifyPageAssets(html: string, pageUrl: string, concurrency = 10): Promise<AssetRecord[]> {
    const rawAssets = this.extractAssets(html, pageUrl);
    const records: AssetRecord[] = [];

    const queue = [...rawAssets];
    const workers: Promise<void>[] = [];

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const probe = await this.probeAsset(item.url);
        records.push({
          url: item.url,
          type: item.type,
          foundOnUrl: pageUrl,
          status: probe.status,
          isBroken: probe.isBroken,
          error: probe.error,
        });
      }
    };

    for (let i = 0; i < Math.min(concurrency, rawAssets.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    return records;
  }
}
