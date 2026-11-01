# Google Antigravity & Gemini Agent Instructions: SEOForge

> **SEOForge**: Local-first technical SEO crawler, audit engine, and 35-tool Model Context Protocol (MCP) server.
> Tailored for **Google Antigravity (AGY)** with **Gemini models** (`gemini-2.5-pro`, `gemini-2.5-flash`),
> compatible across Claude Code, Cursor, Codex, OpenCode, and Windsurf.

---

## 1. Antigravity MCP Integration

SEOForge is registered as a native Antigravity MCP server:
```json
{
  "mcpServers": {
    "seoforge": {
      "command": "node",
      "args": ["/Users/aryanbansal/Documents/seoforge/dist/cli.js", "mcp"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### Available Antigravity Tools (35 Tools)
- **Crawling & Inspection**: `seoforge_crawl`, `seoforge_crawl_status`, `seoforge_get_page`, `seoforge_inspect_url`
- **Issue Diagnostics & Patches**: `seoforge_get_issues`, `seoforge_get_recommendations`, `seoforge_patch_codebase`
- **Link & Graph Analysis**: `seoforge_link_report`, `seoforge_link_opportunities`, `seoforge_anchor_profile`
- **Competitive & Strategy**: `seoforge_compare_competitors`, `seoforge_link_intersect`, `seoforge_content_gap`, `seoforge_keyword_intelligence`
- **AEO & Modern AI Search**: `seoforge_generate_aeo_snippet`, `seoforge_check_llms_txt`, `seoforge_robots_test`, `seoforge_generate_schema`
- **Performance & Protocol**: `seoforge_pagespeed_lab`, `seoforge_trace_redirects`, `seoforge_submit_indexnow`, `seoforge_ci_gate`

---

## 2. Gemini Model Routing

- **Site-Wide Audits & Competitive Intelligence**: Use `Model: 'pro'` (`gemini-2.5-pro`) or `'inherit'`.
- **Fast Tool Calls, Pings & Status Checks**: Use `Model: 'flash'` (`gemini-2.5-flash`) or `'flash_lite'`.

---

## 3. CLI Fallback Commands

If MCP is not active, run tasks via `run_command`:
```bash
# Run 100-page crawl:
node dist/cli.js crawl https://example.com --max-pages 100

# Full audit with markdown output:
node dist/cli.js audit https://example.com --output reports/audit.md

# Instant IndexNow protocol submission:
node dist/cli.js indexnow https://example.com/updated-page
```
