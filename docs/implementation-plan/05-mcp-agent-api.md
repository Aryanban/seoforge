# 05 — MCP Agent API

The "functionality for an AI to call and use it on its own" requirement.

`src/mcp/mcp-server.ts` exposes 14 tools over stdio, connectable from Claude Desktop,
Cursor, Antigravity, Zed, or any MCP client:

```json
{
  "mcpServers": {
    "seoforge": {
      "command": "node",
      "args": ["/absolute/path/to/seoforge/dist/cli.js", "mcp"]
    }
  }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `seoforge_crawl` | **Full-site crawl.** Returns grouped issues + AI fix markdown. Supports `async_mode` for large sites. |
| `seoforge_crawl_status` | Poll an async crawl to completion |
| `seoforge_get_issues` | Grouped issues, filterable by severity |
| `seoforge_get_recommendations` | The full AI fix backlog as markdown |
| `seoforge_get_page` | Single-page audit detail |
| `seoforge_link_report` | Broken / internal / external / redirecting links, orphans, link scores |
| `seoforge_sitemap_report` | Sitemap validity + orphan-in-sitemap |
| `seoforge_export_report` | md / csv / html export to `reports/` |
| `seoforge_inspect_url` | Real-time single-URL deep inspection (+render mode) |
| `seoforge_submit_indexnow` | IndexNow dispatch to Bing/Yandex |
| `seoforge_sample_sitemap` | Audit N random deep sitemap routes |
| `seoforge_check_llms_txt` | `/llms.txt` + `/llms-full.txt` validation |
| `seoforge_generate_aeo_snippet` | Inverted-pyramid answer + FAQ JSON-LD generator |
| `seoforge_daily_run` | Full daily routine (audit + report + IndexNow) |

## Agent ergonomics

- **Crawls persist to SQLite**, so an agent's results are immediately visible in the
  dashboard and re-queryable across sessions.
- **`async_mode`** lets an agent start a 10k-page crawl, poll cheaply, and read results
  only when `status === "completed"`.
- **AI markdown in-band** — `seoforge_get_recommendations` returns ready-to-paste fix docs,
  so an agent can file tickets or open pull requests without synthesizing advice itself.
- Every tool returns structured JSON; errors are returned as `{ "error": … }` rather than
  throwing, so agents can recover.

## Autonomous loop

A pre-configured GitHub Actions workflow (`.github/workflows/daily-seo.yml`) runs the daily
routine unattended, so the crawl store and reports stay current with zero human input.
