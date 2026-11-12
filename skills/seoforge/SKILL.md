---
name: seoforge
description: >-
  Autonomous SEO and Answer Engine Optimization (AEO) specialist powered by SEOForge.
  Executes high-throughput local crawling, 38 native MCP tools, TimesFM time-series forecasting,
  Agent Reach anti-bot scraping, internal PageRank scoring, Schema.org entity generation, crawl diffing,
  IndexNow submissions, and direct AST code patches.
---

# SEOForge Autonomous Agent Skill

This skill allows AI agents to control SEOForge autonomously to audit, monitor, and optimize web applications.

## When to Activate
- When the user asks to crawl a site, check broken links, or run a technical SEO audit.
- When performing Answer Engine Optimization (AEO) for Google AI Overviews, Perplexity, or ChatGPT Search.
- When forecasting SEO & AEO trajectories, organic traffic, CWV, or detecting anomalies via Google Research TimesFM.
- When submitting URLs via the IndexNow protocol to Bing, Yandex, or Naver.
- When analyzing internal link opportunities or anchor text distributions.
- When creating Schema.org JSON-LD structured data.
- When scraping or auditing anti-bot protected pages, login-walled platforms (Reddit, Twitter/X, LinkedIn), or media transcripts (YouTube, Bilibili) using Agent Reach.

## Tool Invocation Map

```
seoforge_crawl                 -> Run full asynchronous BFS crawl (with optional --reach)
seoforge_inspect_url           -> Deep-inspect single URL (supports --reach anti-bot bypass)
seoforge_reach_read            -> Scrape & read any URL via Agent Reach anti-bot engine
seoforge_reach_status          -> Inspect Agent Reach engine version, channels, and dependencies
seoforge_forecast              -> TimesFM zero-shot time series forecasting & anomaly detection
seoforge_get_issues            -> Retrieve ranked issues (Critical, Error, Warning, Info)
seoforge_get_recommendations   -> Get deterministic code patches for discovered defects
seoforge_patch_codebase        -> Apply surgical fixes directly to project files
seoforge_submit_indexnow       -> Dispatch instant IndexNow HTTP pings
seoforge_generate_aeo_snippet  -> Generate direct-answer fact triplets for AI Overviews
seoforge_crawl_diff            -> Diff current crawl against historical snapshots
seoforge_ci_gate               -> Enforce threshold limits in CI pipelines
```
