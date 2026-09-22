import { describe, it, expect } from "vitest";
import { validateConfig, ConfigError } from "../src/config.js";

const GOOD = {
  project: "Test",
  domains: [{ name: "Example", url: "https://example.com" }],
};

describe("config validation", () => {
  it("accepts a minimal valid config", () => {
    expect(() => validateConfig(GOOD)).not.toThrow();
  });

  it("accepts the full 2.0 schema", () => {
    expect(() =>
      validateConfig({
        ...GOOD,
        crawl: { maxDepth: 5, concurrency: 4, limit: 200, render: false, strategy: "sitemap" },
        server: { port: 5173, host: "127.0.0.1" },
        thresholds: { minWordCount: 300, minAeoScore: 80 },
        domains: [
          {
            name: "Example",
            url: "https://example.com",
            render: true,
            crawlStrategy: "discover",
            maxDepth: 3,
            expectedEntities: ["WebSite"],
            paths: ["/", "/about"],
          },
        ],
      })
    ).not.toThrow();
  });

  it("rejects an invalid URL", () => {
    expect(() => validateConfig({ ...GOOD, domains: [{ name: "Bad", url: "not-a-url" }] })).toThrow(ConfigError);
  });

  it("rejects an empty domain list", () => {
    expect(() => validateConfig({ ...GOOD, domains: [] })).toThrow(ConfigError);
  });

  it("rejects an unknown crawl strategy", () => {
    expect(() => validateConfig({ ...GOOD, crawl: { strategy: "teleport" as any } })).toThrow(ConfigError);
  });
});
