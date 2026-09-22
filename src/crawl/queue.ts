/**
 * Prioritized, de-duplicated BFS crawl queue with per-URL depth tracking.
 */

export interface QueueItem {
  url: string;
  normalizedUrl: string;
  depth: number;
  source?: string; // page that discovered it
}

export class CrawlQueue {
  private queue: QueueItem[] = [];
  private seen = new Set<string>();
  private visited = new Set<string>();
  private enqueuedCount = 0;

  constructor(private maxDepth: number, private limit: number) {}

  /**
   * Enqueue a URL if it has not been seen and the crawl budget allows.
   * Returns true if the URL was newly queued.
   */
  enqueue(url: string, normalizedUrl: string, depth: number, source?: string): boolean {
    if (this.seen.has(normalizedUrl)) return false;
    if (depth > this.maxDepth) return false;
    if (this.enqueuedCount >= this.limit) return false;

    this.seen.add(normalizedUrl);
    this.enqueuedCount++;
    this.queue.push({ url, normalizedUrl, depth, source });
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
    return this.queue.shift();
  }

  get size(): number {
    return this.queue.length;
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

/**
 * Normalize a URL for de-duplication: strip hash + query, lowercase, trailing slash.
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    parsed.search = "";
    let p = parsed.pathname;
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    p = p.replace(/\/{2,}/g, "/");
    return `${parsed.origin}${p}`.toLowerCase();
  } catch {
    return rawUrl.toLowerCase().trim().replace(/\/$/, "");
  }
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
