import { describe, it, expect } from "vitest";
import { CrawlQueue } from "../src/crawl/queue.js";
import { openStore, closeStore, checkpointStore } from "../src/store/db.js";
import path from "path";
import os from "os";
import fs from "fs";

describe("Background Queue & Process Engine", () => {
  it("resolves waitForItem immediately upon enqueue (zero-polling slot resolution)", async () => {
    const queue = new CrawlQueue(5, 100);
    expect(queue.size).toBe(0);

    let resolved = false;
    const waitPromise = queue.waitForItem(2000).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    // Microtask enqueue should immediately wake the waiting worker
    queue.enqueue("https://example.com/a", "https://example.com/a", 0);
    await waitPromise;

    expect(resolved).toBe(true);
    expect(queue.size).toBe(1);
    const item = queue.dequeue();
    expect(item?.url).toBe("https://example.com/a");
  });

  it("handles requeue with incremented retry count for transient rate-limit retries", () => {
    const queue = new CrawlQueue(5, 100);
    queue.enqueue("https://example.com/retry-target", "https://example.com/retry-target", 1);
    
    const item = queue.dequeue()!;
    expect(item.retryCount).toBe(0);

    queue.requeue(item);
    expect(queue.size).toBe(1);

    const retried = queue.dequeue()!;
    expect(retried.retryCount).toBe(1);
    expect(retried.url).toBe("https://example.com/retry-target");
  });

  it("executes passive SQLite WAL checkpointing without errors", () => {
    const tmpDb = path.join(os.tmpdir(), `seoforge-test-wal-${Date.now()}.db`);
    const db = openStore(tmpDb);

    try {
      expect(() => checkpointStore(db)).not.toThrow();
    } finally {
      closeStore();
      try { fs.unlinkSync(tmpDb); } catch {}
      try { fs.unlinkSync(`${tmpDb}-wal`); } catch {}
      try { fs.unlinkSync(`${tmpDb}-shm`); } catch {}
    }
  });
});
