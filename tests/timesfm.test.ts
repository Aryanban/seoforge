import { describe, it, expect } from "vitest";
import {
  timesfmForecast,
  formatTimesfmMarkdown,
  forecastCrawlTrend,
} from "../src/forecasting/index.js";
import { openStore, closeStore } from "../src/store/db.js";
import * as repo from "../src/store/repository.js";
import type { CrawlResult } from "../src/types.js";
import fs from "fs";
import path from "path";

describe("Google Research TimesFM Zero-Shot Forecasting Engine", () => {
  it("rejects empty time series", () => {
    expect(() => timesfmForecast([])).toThrow("Cannot forecast an empty time series.");
  });

  it("handles single-point series gracefully with constant prediction", () => {
    const res = timesfmForecast([42], { horizon: 5, metricName: "Test Single" });
    expect(res.historicalPoints).toBe(1);
    expect(res.horizon).toBe(5);
    expect(res.pointForecast).toEqual([42, 42, 42, 42, 42]);
    expect(res.quantiles.p50).toEqual([42, 42, 42, 42, 42]);
    expect(res.quantiles.p10.every((v) => v <= 42)).toBe(true);
    expect(res.quantiles.p90.every((v) => v >= 42)).toBe(true);
    expect(res.trend.direction).toBe("stable");
  });

  it("forecasts upward trend with expanding uncertainty intervals (P10 <= P50 <= P90)", () => {
    // Upward progression: 10, 12, 14, 16, 18, 20, 22, 24
    const series = [10, 12, 14, 16, 18, 20, 22, 24];
    const res = timesfmForecast(series, { horizon: 7, freq: "daily", metricName: "AEO Score" });

    expect(res.model).toBe("google-research/timesfm-zero-shot");
    expect(res.horizon).toBe(7);
    expect(res.pointForecast.length).toBe(7);
    expect(res.quantiles.p10.length).toBe(7);
    expect(res.quantiles.p90.length).toBe(7);

    // Verify upward trend detected
    expect(res.trend.direction).toMatch(/increasing/);
    expect(res.pointForecast[6]).toBeGreaterThan(series[series.length - 1]);

    // Verify quantile invariants: P10 <= P50 <= P90 across all steps
    for (let i = 0; i < 7; i++) {
      expect(res.quantiles.p10[i]).toBeLessThanOrEqual(res.quantiles.p50[i]);
      expect(res.quantiles.p50[i]).toBeLessThanOrEqual(res.quantiles.p90[i]);
    }

    // Verify uncertainty expansion: gap between P90 and P10 grows over time
    const gapT1 = res.quantiles.p90[0] - res.quantiles.p10[0];
    const gapT7 = res.quantiles.p90[6] - res.quantiles.p10[6];
    expect(gapT7).toBeGreaterThan(gapT1);
  });

  it("detects in-sample anomalies (spikes and drops)", () => {
    // Normal baseline around 100 with a sudden anomaly spike and anomaly drop
    const series = [
      100, 102, 99, 101, 100, 98, 102, 101,
      250, // anomaly spike at index 8
      100, 101, 99,
      10,  // anomaly drop at index 12
      98, 101, 100
    ];

    const res = timesfmForecast(series, {
      detectAnomalies: true,
      anomalyThresholdZ: 2.0,
      metricName: "Crawl Traffic",
    });

    expect(res.anomalies.length).toBeGreaterThanOrEqual(2);
    const spike = res.anomalies.find((a) => a.index === 8);
    const drop = res.anomalies.find((a) => a.index === 12);

    expect(spike).toBeDefined();
    expect(spike?.type).toBe("spike");
    expect(spike?.severity).toBe("critical");

    expect(drop).toBeDefined();
    expect(drop?.type).toBe("drop");
    expect(drop?.severity).toBe("critical");
  });

  it("respects minVal and maxVal constraints", () => {
    // Rapidly falling series with minVal 0
    const series = [50, 40, 30, 20, 10, 5, 2];
    const res = timesfmForecast(series, {
      horizon: 10,
      minVal: 0,
      maxVal: 100,
      metricName: "Errors",
    });

    for (let i = 0; i < 10; i++) {
      expect(res.pointForecast[i]).toBeGreaterThanOrEqual(0);
      expect(res.quantiles.p10[i]).toBeGreaterThanOrEqual(0);
      expect(res.quantiles.p90[i]).toBeLessThanOrEqual(100);
    }
  });

  it("handles timestamped inputs and projects future dates", () => {
    const input = [
      { timestamp: "2026-11-01T00:00:00Z", value: 80 },
      { timestamp: "2026-11-02T00:00:00Z", value: 82 },
      { timestamp: "2026-11-03T00:00:00Z", value: 84 },
      { timestamp: "2026-11-04T00:00:00Z", value: 85 },
    ];

    const res = timesfmForecast(input, { horizon: 3, freq: "daily", metricName: "AEO" });
    expect(res.projectedDates).toBeDefined();
    expect(res.projectedDates?.length).toBe(3);
    expect(res.projectedDates?.[0]).toBe("2026-11-05");
    expect(res.projectedDates?.[1]).toBe("2026-11-06");
    expect(res.projectedDates?.[2]).toBe("2026-11-07");
  });

  it("renders a detailed Markdown report with ASCII sparklines", () => {
    const series = [70, 72, 71, 74, 76, 75, 78, 80, 82];
    const res = timesfmForecast(series, { horizon: 5, freq: "daily", metricName: "Site AEO Health" });
    const md = formatTimesfmMarkdown(res);

    expect(md).toContain("## 🔮 TimesFM Zero-Shot Forecast: Site AEO Health");
    expect(md).toContain("Google Research TimesFM");
    expect(md).toContain("Multi-Horizon Projection Table");
    expect(md).toContain("T+1");
    expect(md).toContain("T+5");
    expect(md).toContain("★"); // sparkline marker
  });

  it("forecasts directly from SQLite crawl trend history", () => {
    const testDbPath = path.join(process.cwd(), "reports", `test-timesfm-${Date.now()}.db`);
    const db = openStore(testDbPath);

    try {
      const targetUrl = "https://example.com";
      // Seed 4 crawls with improving AEO scores and decreasing errors
      const baseResult: Partial<CrawlResult> = {
        targetUrl,
        strategy: "discover",
        pages: [],
        issues: [],
        links: [],
      };

      for (let i = 1; i <= 5; i++) {
        const crawl: CrawlResult = {
          ...(baseResult as CrawlResult),
          id: `crawl-timesfm-${i}`,
          startedAt: new Date(Date.now() - (6 - i) * 86400000).toISOString(),
          finishedAt: new Date(Date.now() - (6 - i) * 86400000 + 5000).toISOString(),
          status: "completed",
          totalUrlsCrawled: 50 + i * 5,
          totalErrors: 20 - i * 3, // 17, 14, 11, 8, 5
          totalWarnings: 15,
          totalNotices: 10,
          totalIssues: 45 - i * 3,
          averageAeoScore: 60 + i * 5, // 65, 70, 75, 80, 85
          maxDepthReached: 2,
          passed: true,
          robotsAccessible: true,
          sitemapAccessible: true,
          sitemapUrlCount: 50 + i * 5,
          options: {},
          sitemapEntries: [],
          issuesSummary: [],
          recommendations: [],
        };
        repo.saveCrawl(db, crawl);
      }

      const aeoForecast = forecastCrawlTrend(db, targetUrl, "aeo", { horizon: 5 });
      expect(aeoForecast.historicalPoints).toBe(5);
      expect(aeoForecast.trend.direction).toMatch(/increasing/);
      expect(aeoForecast.pointForecast[0]).toBeGreaterThan(80);

      const errorForecast = forecastCrawlTrend(db, targetUrl, "errors", { horizon: 5 });
      expect(errorForecast.trend.direction).toMatch(/decreasing/);
      expect(errorForecast.pointForecast[4]).toBeLessThanOrEqual(5);
    } finally {
      closeStore(db);
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
      if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
    }
  });
});
