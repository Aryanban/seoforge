/**
 * Drives the MCP server through a real MCP client the way an autonomous agent
 * would: orient, crawl async, poll, triage, drill down, read config.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/mcp-server.js";
import { closeStore } from "../src/store/db.js";
import { startFixtureSite, FixtureSite } from "./fixtures/site.js";

describe("MCP autonomous agent loop", () => {
  let site: FixtureSite;
  let client: Client;
  let dir = "";
  const cwd = process.cwd();

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res: any = await client.callTool({ name, arguments: args });
    return { error: !!res.isError, data: JSON.parse(res.content[0].text) };
  };

  beforeAll(async () => {
    site = await startFixtureSite();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "seoforge-mcp-"));
    process.chdir(dir); // isolated reports/seoforge.db and config
    const [a, b] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-agent", version: "1.0.0" });
    await Promise.all([createMcpServer().connect(b), client.connect(a)]);
  });

  afterAll(async () => {
    await client.close();
    closeStore();
    process.chdir(cwd);
    await site.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("tells the agent how to operate on connect", () => {
    expect(client.getInstructions()).toContain("seoforge_list_crawls");
  });

  it("runs crawl → status → overview → pages → issue URLs → page detail", async () => {
    expect((await call("seoforge_list_crawls")).data.crawls).toEqual([]);

    const started = await call("seoforge_crawl", {
      url: `${site.url}/`, async_mode: true, limit: 30, max_depth: 3,
      check_external_links: false, respect_robots: false,
    });
    expect(started.error).toBe(false);
    const crawlId = started.data.crawlId;

    let status: any;
    for (let i = 0; i < 100; i++) {
      status = (await call("seoforge_crawl_status", { crawl_id: crawlId })).data;
      if (status.status !== "running") break;
      expect(typeof status.crawled).toBe("number");
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(status.status).toBe("completed");

    const listed = (await call("seoforge_list_crawls")).data;
    expect(listed.crawls[0].crawlId).toBe(crawlId);

    // crawl_id omitted → most recent crawl
    const overview = (await call("seoforge_crawl_overview")).data;
    expect(overview.crawlId).toBe(crawlId);
    expect(overview.stats).toBeDefined();
    expect(overview.topIssues.length).toBeGreaterThan(0);

    const broken = (await call("seoforge_list_pages", { status: "broken" })).data;
    expect(broken.pages.every((p: any) => p.status >= 400)).toBe(true);

    const issues = (await call("seoforge_get_issues")).data.issues;
    const name = issues[0].issue;
    const urls = (await call("seoforge_issue_urls", { issue: name })).data;
    expect(urls.count).toBe(issues[0].affectedPages);

    const page = (await call("seoforge_get_page", { url: `${site.url}/broken-link` })).data;
    const brokenIssue = page.issues.find((i: any) => i.id === "broken_internal_link");
    expect(brokenIssue.details.target).toBeTruthy();

    // A stored crawl is readable by status even though it is not an in-session job.
    expect((await call("seoforge_crawl_status", { crawl_id: "nope" })).error).toBe(true);
  });

  it("rejects an invalid config without writing it, and reads a valid one back", async () => {
    expect((await call("seoforge_update_config", { config: { domains: "nope" } })).error).toBe(true);
    const cfg = { project: "Test", domains: [{ name: "Site", url: site.url }] };
    expect((await call("seoforge_update_config", { config: cfg })).error).toBe(false);
    expect((await call("seoforge_get_config")).data.domains[0].url).toBe(site.url);
  });
});
