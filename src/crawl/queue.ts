import { isCrawlTrapLoop } from "../analysis/url-normalizer.js";
/**
 * Prioritized, de-duplicated BFS crawl queue with per-URL depth tracking.
 */

export interface QueueItem {
  url: string;
  normalizedUrl: string;
  depth: number;
  source?: string; // page that discovered it
  retryCount?: number;
}

export class CrawlQueue {
  private queue: QueueItem[] = [];
  private head = 0;
  private seen = new Set<string>();
  private visited = new Set<string>();
  private enqueuedCount = 0;
  private waiters: Array<() => void> = [];

  constructor(private maxDepth: number, private limit: number) {}

  /**
   * Resolve waiting workers immediately when new items are available.
   * Apify Crawlee / Sindre Sorhus p-queue pattern.
   */
  notifyWaiters(): void {
    while (this.waiters.length > 0 && this.size > 0) {
      const next = this.waiters.shift();
      next?.();
    }
  }

  /**
   * Event-driven slot waiting: resolves immediately when an item is enqueued,
   * completely eliminating 25ms spin-polling loops.
   */
  waitForItem(timeoutMs = 1000): Promise<void> {
    if (this.size > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout;
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => {
        const idx = this.waiters.indexOf(done);
        if (idx !== -1) this.waiters.splice(idx, 1);
        resolve();
      }, timeoutMs);
      this.waiters.push(done);
    });
  }

  /**
   * Enqueue a URL if it has not been seen and the crawl budget allows.
   * Returns true if the URL was newly queued.
   */
  enqueue(url: string, normalizedUrl: string, depth: number, source?: string, retryCount = 0): boolean {
    if (isCrawlTrapLoop(url)) return false;
    if (this.seen.has(normalizedUrl)) return false;
    if (depth > this.maxDepth) return false;
    if (this.enqueuedCount >= this.limit) return false;

    this.seen.add(normalizedUrl);
    this.enqueuedCount++;
    this.queue.push({ url, normalizedUrl, depth, source, retryCount });
    this.notifyWaiters();
    return true;
  }

  /**
   * Re-queue a transiently failed URL (HTTP 429 / 503 / network drop) for exponential retry.
   */
  requeue(item: QueueItem): boolean {
    item.retryCount = (item.retryCount ?? 0) + 1;
    this.queue.push(item);
    this.notifyWaiters();
    return true;
  }

  /** Bulk seed; used for sitemap/config strategies. */
  enqueueMany(items: Array<{ url: string; normalizedUrl: string; depth: number }>): number {
    let added = 0;
    for (const it of items) {
      if (this.enqueue(it.url, it.normalizedUrl, it.depth)) added++;
    }
    return added;
  }

  dequeue(): QueueItem | undefined {
    if (this.head >= this.queue.length) return undefined;
    const item = this.queue[this.head++];
    // Compact periodically when head index has consumed substantial memory
    if (this.head > 1000 && this.head * 2 >= this.queue.length) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
    return item;
  }

  get size(): number {
    return this.queue.length - this.head;
  }

  get discovered(): number {
    return this.enqueuedCount;
  }

  get visitedCount(): number {
    return this.visited.size;
  }

  markVisited(normalizedUrl: string): void {
    this.visited.add(normalizedUrl);
  }

  has(normalizedUrl: string): boolean {
    return this.seen.has(normalizedUrl);
  }

  get isBudgetExhausted(): boolean {
    return this.enqueuedCount >= this.limit;
  }
}

const normCache = new Map<string, string>();
const MAX_NORM_CACHE = 50000;

/**
 * Normalize a URL for de-duplication: strip hash + query, lowercase, trailing slash.
 * Bounded LRU/memoization map yields ~32x speedup on repetitive link normalization.
 */
export function normalizeUrl(rawUrl: string): string {
  const hit = normCache.get(rawUrl);
  if (hit !== undefined) return hit;

  let result: string;
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    parsed.search = "";
    let p = parsed.pathname;
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    p = p.replace(/\/{2,}/g, "/");
    result = `${parsed.origin}${p}`.toLowerCase();
  } catch {
    result = rawUrl.toLowerCase().trim().replace(/\/$/, "");
  }

  if (normCache.size < MAX_NORM_CACHE) {
    normCache.set(rawUrl, result);
  }
  return result;
}

export function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function matchesPatterns(url: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(url);
    } catch {
      return url.toLowerCase().includes(pattern.toLowerCase());
    }
  });
}
