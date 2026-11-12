# SEOForge 2.0

> **The frontier open-source SEO crawler, AEO audit engine, TimesFM forecasting foundation, and 38-tool Model Context Protocol (MCP) server for autonomous AI coding agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8_Strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests Passing](https://img.shields.io/badge/Tests-247%2F247_Passing-10b981?style=flat-square&logo=vitest&logoColor=white)](https://github.com/Aryanban/seoforge)
[![MCP Server](https://img.shields.io/badge/MCP_Server-38_Native_Tools-purple?style=flat-square)](https://modelcontextprotocol.io)
[![Protocol: IndexNow](https://img.shields.io/badge/Protocol-IndexNow-008080?style=flat-square)](https://www.indexnow.org)
[![Privacy: 100% Localhost](https://img.shields.io/badge/Privacy-100%25_Localhost-orange?style=flat-square)](https://github.com/Aryanban/seoforge)

---

## ⚡ Overview

SEOForge 2.0 is a **high-throughput, local-first technical SEO crawler and audit platform** built as a zero-cost, private alternative to Screaming Frog (£209/yr) and Ahrefs ($129/mo). It requires **no API keys, makes no external LLM calls**, and persists everything to a high-concurrency local SQLite store reachable via a modern React dashboard, a REST API, or a 38-tool Model Context Protocol (MCP) server.

Designed for autonomous AI coding agents (**Google Antigravity, Claude Code, Cursor, Codex CLI, OpenCode**), SEOForge crawls full sites using an event-driven asynchronous BFS queue, classifies pages against **60+ technical SEO and accessibility checks**, measures **Answer Engine Optimization (AEO)** for Google AI Overviews and Perplexity, executes **Google Research TimesFM zero-shot time series forecasting**, and generates deterministic, copy-paste-ready AI fix backlogs.

---

## 🏆 Quantitative Benchmarks: Why SEOForge is at the Frontier

SEOForge re-engineers background task execution, queue resolution, and parsing pipelines by adopting architecture from industry-leading open-source projects (**Apify Crawlee**, **ProjectDiscovery Katana**, **Litestream**, and **Google Research TimesFM**).

### 1. Component Micro-Benchmarks (Measured Speedups)

| Subsystem / Operation | Bottleneck in Traditional Crawlers | SEOForge Frontier Architecture | Benchmark Speedup |
| :--- | :--- | :--- | :--- |
| **Crawl Queue Dequeue** (`src/crawl/queue.ts`) | $O(N)$ `Array.shift()` array copy (298.95 ms / 50k) | **$O(1)$ ring buffer with head pointer** & compaction | **280x faster** (1.07 ms) |
| **Link Graph Adjacency** (`applyLinkGraph`) | $O(P \times L)$ quadratic nested loop (1,166.96 ms / 2k) | **Single-pass $O(L + P)$ inverted adjacency map** | **82x faster** (14.15 ms) |
| **Duplicate Detection** (`detectDuplicates`) | $O(G^2)$ quadratic pairwise set allocations (42.10 ms) | **Pre-fingerprinted exact grouping + set index** | **38x faster** (1.11 ms) |
| **URL Normalization** (`normalizeUrl`) | Redundant URL regex parsing on every hop (110.75 ms / 100k) | **Bounded 50k LRU cache** | **32.2x faster** (3.44 ms) |
| **DOM & AST Parsing** (`runPageChecks`) | Repeated `cheerio.load(html)` per check module (48.20 ms / 100 pgs) | **Single-pass Cheerio AST sharing** across all checks | **12.0x faster** (4.02 ms) |
| **Crawl Trap Loop Filter** (`detectLoopTrap`) | Full regex split on every discovered URL (94.92 ms / 200k) | **1-cycle ASCII slash counter fast-path filter** | **8.5x faster** (11.20 ms) |
| **SimHash Distance** (`simhash.ts`) | 64-step BigInt division loop (21.19 ms / 50k) | **4-cycle SWAR parallel bitwise popcount** | **4.3x faster** (4.88 ms) |
| **TimesFM Quantiles** (`timesfm.ts`) | Repeated Array slice allocations (13.20 ms / 10k) | **Pre-centered `Float64Array` zero-copy views** | **1.8x faster** (7.46 ms) |
| **Worker Slot Pickup** (`waitForItem`) | 25ms timer busy-wait loop (`setTimeout(25)`) | **Event-driven microtask wakeups** via Promises | **Instant (0ms vs 25ms)** |
| **DNS Contention** (`fetcher.ts`) | Blocking OS `getaddrinfo` on 4-thread `libuv` pool | **In-memory 60s TTL DNS cache** | **Instant (0ms repeat)** |
| **JS Rendering Context** (`renderer.ts`) | Launching browser process per URL (~500 ms) | **Persistent browser instance with isolated contexts** | **~25x faster** (<20 ms) |
| **Pre-Crawl Discovery** (`robots`/`llms`) | Serial roundtrips for robots.txt + llms.txt (3,235.9 ms) | **Parallel `Promise.all` discovery dispatch** | **1.67x faster** (1,938.9 ms) |

---

### 2. Live Production Benchmark: `https://cerebralvalley.ai`

Auditing a real-world, high-traffic Next.js production site with 1,000 sitemap URLs, 1,208 links, and a ~658ms origin TTFB:

```
┌────────────────────────────────────────────────────────────────────────┐
│            SEOForge 2.0 — Full-Site Crawl & Audit                      │
│      Screaming Frog–grade crawler · Ahrefs-grade issue engine           │
└────────────────────────────────────────────────────────────────────────┘
Target: https://cerebralvalley.ai · Status: completed · 50 pages crawled
Robots: ✓ · Sitemap: ✓ (1,000 URLs parsed) · llms.txt: ✓
Discovered Links: 1,208 (880 internal, 328 external)
Issues Identified: 68 Critical Errors, 236 Warnings, 391 Notices (688 total)
Average AEO Score: 34/100 · AI Fix Recommendations: 79 action tickets
```

- **Initial Baseline (Serial probes, default settings)**: **25.098 seconds**
- **Stage 1 ($O(1)$ Queue, single-pass Cheerio, concurrency 16)**: **14.175 seconds** (1.77x faster)
- **Stage 2 (Parallel discovery probes, in-memory DNS cache, dead-host fast path)**: **11.999 seconds** (**2.10x faster overall**)
- **Stage 3 (Core internal site audit via `--no-external`)**: **10.702 seconds** (**2.34x faster**)
- **Pure page crawl throughput**: **2,735.7 ms for 50 pages $\to$ 18.3 pages/second** against a remote production origin!

---

### 3. Industry Comparison Matrix

| Capability / Metric | Screaming Frog | Scrapy (Python) | Apify Crawlee | Ahrefs / Semrush | SEOForge 2.0 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **License & Pricing** | £209 / yr (Proprietary) | Open Source (BSD-3) | Open Source (Apache 2.0)| $1,548 – $2,388 / yr | **100% Free (MIT)** |
| **Memory Footprint (50k URLs)** | 4 – 8 GB (JVM heap) | 400 – 800 MB | 300 – 600 MB | Cloud Hosted | **110 – 140 MB (SQLite WAL)** |
| **Native MCP Server** | ✗ No | ✗ No | ✗ No | ✗ No | **✓ 38 Native Tools** |
| **AI Agent Automation** | ✗ No | ✗ No | Partial (REST) | ✗ No | **✓ Claude, Antigravity, Cursor, Codex** |
| **TimesFM Zero-Shot Forecasting** | ✗ No | ✗ No | ✗ No | ✗ No | **✓ Built-in (P10/P50/P90)** |
| **AEO Answer Engine Scoring** | ✗ No | ✗ No | ✗ No | ✗ No | **✓ Built-in (0–100 score)** |
| **Agent Reach Anti-Bot Bypass** | ✗ No | External middleware | ✗ No | ✗ No | **✓ Built-in** |
| **Queue Performance** | $O(N)$ Synchronized list | Python FIFO list | $O(1)$ RequestQueue | Cloud Queue (5-15m wait)| **$O(1)$ Ring Buffer (0ms pickup)** |
| **Transient Error Resilience** | Static delay | RetryMiddleware | Exponential backoff | Cloud retry | **Exponential with Full Jitter** |
| **Instant IndexNow Protocol** | Plugin required | Custom code | ✗ No | ✗ No | **✓ Built-in (Bing, Yandex, Naver)**|
| **Data Privacy** | Local (Closed) | Local | Local / Cloud | 3rd-party Cloud | **100% Private Localhost** |

---

## 📦 Installation & Setup

### Requirements
- **Node.js ≥ 22.0.0** is mandatory (SEOForge uses the native `node:sqlite` engine for zero-dependency C++ compilation).
- Compatible with macOS, Linux, and Windows (WSL / PowerShell).

### 1. Download & Build from Source (Recommended)

```bash
# Clone the repository
git clone https://github.com/Aryanban/seoforge.git
cd seoforge

# Install dependencies (zero native build dependencies required)
npm install

# Build both TypeScript CLI engine and React web dashboard
npm run build
```

Verify your installation:
```bash
node dist/cli.js --version
# Output: 2.0.0
```

### 2. Optional: Link Globally or Use with `npx`

To invoke `seoforge` directly from any directory in your terminal:
```bash
npm link
seoforge --help
```

---

## 🛠️ CLI Cheat-Sheet & Usage

| Command | Description & Options |
| :--- | :--- |
| `seoforge crawl [url]` | Full-site BFS crawl. `--depth 10 --limit 500 --concurrency 16 --save --no-external --render --reach` |
| `seoforge crawl --sitemap <url>` | Use this sitemap URL instead of auto-discovering one. |
| `seoforge crawl --seeds <file>` | Add extra seed URLs from a file (one per line; blank lines and `#` comments ignored). |
| `seoforge crawl --production-origin <origin>` | Staging/local audits: rewrite sitemap/seed URLs and treat the production origin's canonical/hreflang/og URLs as same-site. |
| `seoforge crawl --all-sitemap` | Crawl every sitemap URL (strategy=sitemap, default limit raised to 200000). |
| `seoforge inspect <url>` | Real-time single-URL inspection (TTFB, headers, canonical, meta, schema, CWV, AEO). |
| `seoforge serve` | Starts the local React dashboard + REST API on `http://127.0.0.1:5173`. (`--port --host --no-open`) |
| `seoforge export <type>` | Export latest crawl report: `md`, `csv`, `html`, or `backlog`. (`--all-urls --crawl <id>`) |
| `seoforge forecast [url]` | TimesFM zero-shot forecasting & anomaly detection. (`--metric aeo\|errors\|warnings --horizon 14`) |
| `seoforge reach <url>` | Scrapes protected, anti-bot, or login-walled URLs via Agent Reach engine. |
| `seoforge indexnow --urls <u1,u2>` | Instantly notifies Bing, Yandex, and Naver search engines of modified URLs. |
| `seoforge publish [query]` | Explores the 206-source publishing catalog or generates tailored outreach plans. (`--profile`) |
| `seoforge reputation` | Verifies candidate source URLs and computes the Model 1.1 reputation score. |
| `seoforge compare` | Generates a competitor crawl gap matrix across measured evidence. |

### Example Commands

#### High-Throughput Production Crawl
```bash
# Crawl 200 pages with 16 workers, save markdown fix backlog, and skip external links:
seoforge crawl https://example.com --limit 200 --concurrency 16 --save --no-external
```

#### SPA Crawling with Headless Chromium (Core Web Vitals)
```bash
# Requires: npx playwright install chromium
seoforge crawl https://example.com --render --limit 50
```

#### TimesFM Zero-Shot Forecast on Site Health
```bash
# Project AEO scores or critical error trends for the next 14 days with P10/P50/P90 quantile intervals:
seoforge forecast https://example.com --metric aeo --horizon 14
```

---

## 🤖 AI Agent Integration (MCP Server)

SEOForge provides **38 native tools** over standard I/O (`stdio`) via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). AI agents can independently crawl sites, inspect issues, analyze internal link graphs, and surgically patch code.

### 1. Claude Desktop / Antigravity / Cursor Configuration

Add SEOForge to your MCP configuration file:
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Google Antigravity**: `~/.gemini/antigravity/mcp_config.json`
- **Cursor**: `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "seoforge": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/seoforge/dist/cli.js", "mcp"],
      "cwd": "/ABSOLUTE/PATH/TO/seoforge",
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### 2. Claude Code CLI

```bash
claude mcp add seoforge -- node /ABSOLUTE/PATH/TO/seoforge/dist/cli.js mcp
```

### 3. OpenAI Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.seoforge]
command = "node"
args = ["/ABSOLUTE/PATH/TO/seoforge/dist/cli.js", "mcp"]
```

### 4. OpenCode (`opencode.json` / `opencode.json5`)

```json5
{
  mcp: {
    seoforge: {
      type: "local",
      command: ["node", "/ABSOLUTE/PATH/TO/seoforge/dist/cli.js", "mcp"],
      enabled: true,
    },
  },
}
```

### The 38 Native MCP Tools

| Tool Category | Tools Included |
| :--- | :--- |
| **Crawling & Inspection** | `seoforge_crawl`, `seoforge_crawl_status`, `seoforge_get_page`, `seoforge_inspect_url`, `seoforge_sample_sitemap` |
| **Anti-Bot Scraping** | `seoforge_reach_read`, `seoforge_reach_status` |
| **Foundation Forecasting** | `seoforge_forecast` (Google Research TimesFM zero-shot quantile projection) |
| **Issues & Code Patching** | `seoforge_get_issues`, `seoforge_get_recommendations`, `seoforge_patch_codebase`, `seoforge_ci_gate` |
| **Link & Graph Intelligence** | `seoforge_link_report`, `seoforge_link_opportunities`, `seoforge_anchor_profile`, `seoforge_trace_redirects` |
| **Competitive Analysis** | `seoforge_compare_competitors`, `seoforge_link_intersect`, `seoforge_content_gap`, `seoforge_keyword_intelligence` |
| **AEO & Search Engines** | `seoforge_generate_aeo_snippet`, `seoforge_check_llms_txt`, `seoforge_robots_test`, `seoforge_generate_schema`, `seoforge_submit_indexnow` |
| **Content & Diagnostics** | `seoforge_analyze_content`, `seoforge_score_content`, `seoforge_cannibalization`, `seoforge_pagespeed_lab`, `seoforge_custom_extract`, `seoforge_crawl_diff`, `seoforge_log_audit`, `seoforge_sitemap_report`, `seoforge_export_report`, `seoforge_daily_run` |
| **Publishing & Reputation** | `seoforge_publishing_plan`, `seoforge_reputation_report`, `seoforge_discover_sources` |

---

## 🔬 Core Architectural Patterns

1. **Event-Driven Task Slot Microtask Resolution (Crawlee / p-queue)**:
   Replaced polling loops (`setTimeout(25)`) with an event-driven `waitForItem()` microtask resolver. Idle workers wake up on the exact tick new URLs are enqueued ($0$ms latency vs $25$ms lag).
2. **Exponential Backoff with Full Randomized Jitter (Crawlee / AWS Architecture)**:
   Transient failures (HTTP 429 rate limits, HTTP 503 overloads, connection drops) are automatically re-queued with randomized jitter: $\min(8000, 1000 \cdot 2^{\text{retry}} + \text{jitter})$, honoring `Retry-After` headers.
3. **In-Memory DNS Cache & Connection Pooling**:
   Wired custom DNS caching directly into Undici's agent dispatcher, eliminating threadpool exhaustion on libuv's default 4-thread `getaddrinfo` limit.
4. **Passive SQLite WAL Checkpointing (Litestream Pattern)**:
   Crawls stream directly into a local SQLite database using native `node:sqlite`. Background WAL checkpointing flushes dirty pages asynchronously without locking readers or writers.
5. **TimesFM Zero-Shot Forecasting Engine**:
   Native TypeScript implementation of Google Research's TimesFM foundation model architecture: patch tokenization, local normalization, P10/P50/P90 quantile projections, and Median Absolute Deviation (MAD) anomaly detection.

---

## 🧪 Testing

SEOForge maintains a comprehensive Vitest test suite with **100% pass rate** across all checks, models, and stores:

```bash
# Run test suite
npm test

# Type checking
npm run typecheck && npm run typecheck:web

# Full production build
npm run build
```

```
Test Files  33 passed (33)
Tests       247 passed (247)
Duration    1.33s
```

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for details.

Copyright (c) 2026 Aryan Bansal. Built with pride for autonomous AI agents and open-source engineers.
