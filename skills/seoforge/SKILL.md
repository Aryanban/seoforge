---
name: seoforge
description: >-
  Autonomous SEO and Answer Engine Optimization (AEO) specialist powered by SEOForge.
  Executes high-throughput local crawling, 35 native MCP tools, internal PageRank scoring,
  Schema.org entity generation, crawl diffing, IndexNow submissions, and direct AST code patches.
---

# SEOForge Autonomous Agent Skill

This skill allows AI agents to control SEOForge autonomously to audit, monitor, and optimize web applications.

## When to Activate
- When the user asks to crawl a site, check broken links, or run a technical SEO audit.
- When performing Answer Engine Optimization (AEO) for Google AI Overviews, Perplexity, or ChatGPT Search.
- When submitting URLs via the IndexNow protocol to Bing, Yandex, or Naver.
- When analyzing internal link opportunities or anchor text distributions.
- When creating Schema.org JSON-LD structured data.

## Tool Invocation Map

```
seoforge_crawl                 -> Run full asynchronous BFS crawl
seoforge_get_issues            -> Retrieve ranked issues (Critical, Error, Warning, Info)
seoforge_get_recommendations   -> Get deterministic code patches for discovered defects
seoforge_patch_codebase        -> Apply surgical fixes directly to project files
seoforge_submit_indexnow       -> Dispatch instant IndexNow HTTP pings
seoforge_generate_aeo_snippet  -> Generate direct-answer fact triplets for AI Overviews
seoforge_crawl_diff            -> Diff current crawl against historical snapshots
seoforge_ci_gate               -> Enforce threshold limits in CI pipelines
```
