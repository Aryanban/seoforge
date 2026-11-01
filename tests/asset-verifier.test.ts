import { describe, it, expect } from "vitest";
import { AssetVerifier } from "../src/analysis/asset-verifier.js";

describe("Asset & Resource Verifier", () => {
  it("extracts internal images, scripts, stylesheets, and iframes while ignoring external and data-URIs", () => {
    const verifier = new AssetVerifier();
    const html = `
      <html>
        <head>
          <link rel="stylesheet" href="/assets/main.css">
          <link rel="stylesheet" href="https://external-cdn.com/style.css">
          <script src="/js/bundle.js"></script>
        </head>
        <body>
          <img src="/images/logo.png">
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY44YAAAAASUVORK5CYII=">
          <iframe src="/embed/video"></iframe>
        </body>
      </html>
    `;

    const assets = verifier.extractAssets(html, "https://example.com/blog/article");

    expect(assets.length).toBe(4);
    expect(assets.find((a) => a.type === "stylesheet")?.url).toBe("https://example.com/assets/main.css");
    expect(assets.find((a) => a.type === "script")?.url).toBe("https://example.com/js/bundle.js");
    expect(assets.find((a) => a.type === "image")?.url).toBe("https://example.com/images/logo.png");
    expect(assets.find((a) => a.type === "iframe")?.url).toBe("https://example.com/embed/video");
  });
});
