import { describe, it, expect } from "vitest";
import {
  isAgentReachAvailable,
  agentReachDoctor,
  synthesizeHtmlFromReach,
  agentReachRead,
} from "../src/crawl/agent-reach.js";
import { validateConfig, mergeCrawlOptions } from "../src/config.js";

describe("Agent Reach integration", () => {
  describe("synthesizeHtmlFromReach", () => {
    it("synthesizes semantic HTML from structured items", () => {
      const items = [
        {
          title: "Test Post & Article",
          url: "https://example.com/post-1",
          author: "Alice",
          published_at: "2026-05-01T12:00:00Z",
          text: "Here is the first paragraph with a [link](https://example.com).\n\nAnd a second paragraph with some details.",
        },
      ];

      const html = synthesizeHtmlFromReach(items, "Fallback Title");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<title>Test Post &amp; Article</title>");
      expect(html).toContain('<meta name="author" content="Alice">');
      expect(html).toContain('<meta name="article:published_time" content="2026-05-01T12:00:00Z">');
      expect(html).toContain('<h1>Test Post &amp; Article</h1>');
      expect(html).toContain('<a href="https://example.com">link</a>');
      expect(html).toContain("<p>And a second paragraph with some details.</p>");
    });

    it("handles empty items list by providing fallback title", () => {
      const html = synthesizeHtmlFromReach([], "Default Fallback");
      expect(html).toContain("<title>Default Fallback</title>");
      expect(html).toContain("<h1>Default Fallback</h1>");
    });

    it("synthesizes multiple items correctly", () => {
      const items = [
        { title: "Item 1", text: "Paragraph 1" },
        { title: "Item 2", text: "Paragraph 2" },
      ];
      const html = synthesizeHtmlFromReach(items);
      expect(html).toContain("Item 1");
      expect(html).toContain("Item 2");
      expect(html).toContain("<p>Paragraph 1</p>");
      expect(html).toContain("<p>Paragraph 2</p>");
    });
  });

  describe("CLI environment check", () => {
    it("detects agent-reach binary availability", async () => {
      const available = await isAgentReachAvailable();
      expect(typeof available).toBe("boolean");
      expect(available).toBe(true);
    });

    it("runs agent-reach doctor successfully", async () => {
      const doc = await agentReachDoctor();
      expect(doc.ok).toBe(true);
      expect(doc.version).toBeDefined();
      expect(Array.isArray(doc.channels)).toBe(true);
      expect(doc.channels!.length).toBeGreaterThan(0);
    });
  });

  describe("config integration", () => {
    it("accepts reach option in crawl configuration", () => {
      expect(() =>
        validateConfig({
          project: "ReachTest",
          crawl: { reach: true },
          domains: [{ name: "Target", url: "https://example.com", reach: true }],
        })
      ).not.toThrow();
    });

    it("merges reach options correctly", () => {
      const base = {
        project: "ReachTest",
        crawl: { reach: false },
        domains: [{ name: "Target", url: "https://example.com", reach: true }],
      };
      const merged = mergeCrawlOptions(base, base.domains[0]);
      expect(merged.reach).toBe(true);
    });
  });
});
