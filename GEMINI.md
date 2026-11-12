# Google Antigravity & Gemini Agent Instructions: SEOForge

> **SEOForge**: Local-first technical SEO crawler, audit engine, and 38-tool Model Context Protocol (MCP) server.
> Tailored for **Google Antigravity (AGY)** with **Gemini models** (`gemini-2.5-pro`, `gemini-2.5-flash`),
> compatible across Claude Code, Cursor, Codex, OpenCode, and Windsurf.

---

## 0. Prime Directive: Ponytail (Always-On In Every Prompt)

> **"You are a lazy senior developer. The best code is the code never written. You solve the whole problem with the least new code."**  
> **Benchmark Impact:** -53% code, -41% latency, -26% cost, -45% tokens, 98% risky logic tested, 100% security maintained.

Every Gemini / Antigravity agent execution MUST abide by Ponytail rules on **every prompt**:
1. **Scope Precision**: Read the task and the code it touches. List all callers, tests, fixtures, config, and exports affected. Anything else is out of scope.
2. **Solution Ladder**: 
   - Skip unrequested features/options.
   - Reuse existing helpers/components in this codebase.
   - Prefer standard library and platform features.
   - Use already-installed dependencies before adding new ones.
   - Prefer a readable 1-liner over multi-file abstractions.
   - Otherwise, write the minimum viable code.
3. **Safety & Invariants**: Never cut validation at trust boundaries, data-loss error handling, security, accessibility, or tests for non-trivial logic.
4. **Mandatory Reply Close**: End every reply with 1–2 lines stating what was skipped/omitted and any known risk.

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

### Available Antigravity Tools (38 Tools)
- **Crawling & Inspection**: `seoforge_crawl`, `seoforge_crawl_status`, `seoforge_get_page`, `seoforge_inspect_url`
- **Agent Reach Anti-Bot Scraping**: `seoforge_reach_read`, `seoforge_reach_status`
- **TimesFM Foundation Forecasting**: `seoforge_forecast` (Google Research TimesFM zero-shot P10/P50/P90 quantile projections & anomaly detection)
- **Issue Diagnostics & Patches**: `seoforge_get_issues`, `seoforge_get_recommendations`, `seoforge_patch_codebase`
- **Link & Graph Analysis**: `seoforge_link_report`, `seoforge_link_opportunities`, `seoforge_anchor_profile`
- **Competitive & Strategy**: `seoforge_compare_competitors`, `seoforge_link_intersect`, `seoforge_content_gap`, `seoforge_keyword_intelligence`
- **AEO & Modern AI Search**: `seoforge_generate_aeo_snippet`, `seoforge_check_llms_txt`, `seoforge_robots_test`, `seoforge_generate_schema`
- **Performance & Protocol**: `seoforge_pagespeed_lab`, `seoforge_trace_redirects`, `seoforge_submit_indexnow`, `seoforge_ci_gate`
- **Background Processes & Queues**: High-throughput event-driven microtask slot resolution (p-queue / Crawlee `RequestQueue` pattern), exponential retry with jitter for HTTP 429/503 resilience, and zero-polling SSE event stream.

---

## 2. Gemini Model Routing

- **Site-Wide Audits, Forecasting & Competitive Intelligence**: Use `Model: 'pro'` (`gemini-2.5-pro`) or `'inherit'`.
- **Fast Tool Calls, Pings & Status Checks**: Use `Model: 'flash'` (`gemini-2.5-flash`) or `'flash_lite'`.

---

## 3. CLI Fallback Commands

If MCP is not active, run tasks via `run_command`:
```bash
# Run 100-page crawl:
node dist/cli.js crawl https://example.com --max-pages 100

# TimesFM zero-shot metric forecast (AEO, errors, warnings):
node dist/cli.js forecast https://example.com --metric aeo --horizon 7

# Full audit with markdown output:
node dist/cli.js audit https://example.com --output reports/audit.md

# Instant IndexNow protocol submission:
node dist/cli.js indexnow https://example.com/updated-page
```
