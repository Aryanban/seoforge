import { describe, it, expect } from "vitest";
import { analyzePageSpeedLab } from "../src/analysis/pagespeed-lab.js";

describe("PageSpeed & DOM Lab Analyzer", () => {
  it("detects render-blocking scripts and missing image dimensions", () => {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Slow Page</title>
  <script src="/legacy.js"></script>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <h1>Hello World</h1>
  <img src="/banner.png">
  <iframe src="https://youtube.com/embed/123"></iframe>
</body>
</html>
    `;

    const report = analyzePageSpeedLab({
      url: "https://mysite.com/test",
      html,
      ttfbMs: 300,
    });

    expect(report.renderBlockingResources.length).toBe(2);
    expect(report.clsRisks.length).toBe(2);
    expect(report.domMetrics.isExcessive).toBe(false);
    expect(report.performanceScore).toBeLessThan(90);
    expect(report.recommendations.some((r) => r.text.includes("render-blocking"))).toBe(true);
  });

  it("scores clean optimized pages highly", () => {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Fast Page</title>
  <script defer src="/app.js"></script>
  <link rel="stylesheet" href="/style.css" media="print" onload="this.media='all'">
</head>
<body>
  <h1>Fast Optimized Page</h1>
  <img src="/banner.png" width="800" height="400">
</body>
</html>
    `;

    const report = analyzePageSpeedLab({
      url: "https://mysite.com/fast",
      html,
      ttfbMs: 80,
    });

    expect(report.renderBlockingResources.length).toBe(0);
    expect(report.clsRisks.length).toBe(0);
    expect(report.performanceScore).toBeGreaterThanOrEqual(90);
  });
});
