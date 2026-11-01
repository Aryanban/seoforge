import { describe, it, expect } from "vitest";
import { createMcpServer } from "../src/mcp/mcp-server.js";

describe("Competitive MCP Tools Suite", () => {
  const server = createMcpServer();

  it("registers all competitive tools in tool listing", async () => {
    const handler = (server as any)._requestHandlers?.get("tools/list");
    expect(handler).toBeDefined();
    const result = await handler({ method: "tools/list", params: {} });
    const toolNames = result.tools.map((t: any) => t.name);

    expect(toolNames).toContain("seoforge_crawl_diff");
    expect(toolNames).toContain("seoforge_log_audit");
    expect(toolNames).toContain("seoforge_cannibalization");
    expect(toolNames).toContain("seoforge_custom_extract");
    expect(toolNames).toContain("seoforge_score_content");
    expect(toolNames).toContain("seoforge_patch_codebase");
    expect(toolNames).toContain("seoforge_ci_gate");
    expect(toolNames).toContain("seoforge_link_intersect");
    expect(toolNames).toContain("seoforge_content_gap");
    expect(toolNames).toContain("seoforge_robots_test");
    expect(toolNames).toContain("seoforge_trace_redirects");
    expect(toolNames).toContain("seoforge_pagespeed_lab");
  });

  it("executes seoforge_link_intersect tool", async () => {
    const handler = (server as any)._requestHandlers?.get("tools/call");
    const res = await handler({
      method: "tools/call",
      params: {
        name: "seoforge_link_intersect",
        arguments: {
          target_domain: "mysite.com",
          competitors: [
            { domain: "comp1.com", backlinks: ["https://techcrunch.com/a", "https://producthunt.com/a"] },
            { domain: "comp2.com", backlinks: ["https://techcrunch.com/b", "https://producthunt.com/b"] },
          ],
        },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.targetDomain).toBe("mysite.com");
    expect(parsed.highPriorityGaps.length).toBeGreaterThanOrEqual(2);
  });

  it("executes seoforge_robots_test tool", async () => {
    const handler = (server as any)._requestHandlers?.get("tools/call");
    const res = await handler({
      method: "tools/call",
      params: {
        name: "seoforge_robots_test",
        arguments: {
          robots_txt: "User-agent: *\nDisallow: /secret/",
          path: "/secret/data",
          user_agent: "Googlebot",
        },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.allowed).toBe(false);
  });

  it("executes seoforge_trace_redirects tool", async () => {
    const handler = (server as any)._requestHandlers?.get("tools/call");
    const res = await handler({
      method: "tools/call",
      params: {
        name: "seoforge_trace_redirects",
        arguments: {
          url: "https://mysite.com/old",
          hops: [
            { url: "https://mysite.com/old", status: 301 },
            { url: "https://mysite.com/new", status: 200 },
          ],
          target_framework: "nextjs",
        },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.totalHops).toBe(1);
    expect(parsed.directRewriteSnippet).toContain("next.config.js");
  });

  it("executes seoforge_pagespeed_lab tool", async () => {
    const handler = (server as any)._requestHandlers?.get("tools/call");
    const res = await handler({
      method: "tools/call",
      params: {
        name: "seoforge_pagespeed_lab",
        arguments: {
          url: "https://mysite.com",
          html: "<!DOCTYPE html><html><head><script src='/blocking.js'></script></head><body><img src='/pic.png'></body></html>",
          ttfb_ms: 100,
        },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.renderBlockingResources.length).toBe(1);
    expect(parsed.clsRisks.length).toBe(1);
  });

  it("executes seoforge_custom_extract tool", async () => {
    const handler = (server as any)._requestHandlers?.get("tools/call");
    const html = `<div class="price" data-sku="12345">$29.99</div>`;
    const res = await handler({
      method: "tools/call",
      params: {
        name: "seoforge_custom_extract",
        arguments: {
          html,
          rules: [
            { id: "price", name: "Price", type: "css", selector: ".price" },
            { id: "sku", name: "SKU", type: "css", selector: ".price", attribute: "data-sku" },
          ],
        },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.extractions.price).toEqual(["$29.99"]);
    expect(parsed.extractions.sku).toEqual(["12345"]);
  });

  it("executes seoforge_score_content tool", async () => {
    const handler = (server as any)._requestHandlers?.get("tools/call");
    const res = await handler({
      method: "tools/call",
      params: {
        name: "seoforge_score_content",
        arguments: {
          title: "Ultimate Guide to Cloud Hosting",
          body: "# Ultimate Guide to Cloud Hosting\n\nCloud hosting offers superior scalability and uptime compared to legacy shared servers.\n\n## What is Cloud Hosting?\nCloud hosting distributes web applications across connected virtual servers for zero downtime.\n\n- Scalable RAM\n- Automated Backups",
          primary_keyword: "Cloud Hosting",
          target_word_count: 50,
        },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.overallScore).toBeGreaterThan(60);
    expect(parsed.primaryKeywordMetric.foundInTitle).toBe(true);
  });

  it("executes seoforge_patch_codebase tool", async () => {
    const handler = (server as any)._requestHandlers?.get("tools/call");
    const res = await handler({
      method: "tools/call",
      params: {
        name: "seoforge_patch_codebase",
        arguments: {
          source_code: "export const metadata = {};",
          issue_id: "title_missing",
          file_path: "app/page.tsx",
          fix_data: {
            title: "Super Charged SEO",
          },
        },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.applied).toBe(true);
    expect(parsed.patchedCode).toContain('title: "Super Charged SEO"');
  });

  it("executes seoforge_log_audit tool with raw log", async () => {
    const handler = (server as any)._requestHandlers?.get("tools/call");
    const line = '1.1.1.1 - - [10/Oct/2026:13:00:00 +0000] "GET /docs HTTP/1.1" 200 500 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"';
    const res = await handler({
      method: "tools/call",
      params: {
        name: "seoforge_log_audit",
        arguments: {
          log_content: line,
        },
      },
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.totalLines).toBe(1);
    expect(parsed.botHits.some((b: any) => b.bot === "Googlebot")).toBe(true);
  });
});
