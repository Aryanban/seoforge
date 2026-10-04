# SEOForge ⚡ • Full-Site SEO Crawler, Audit Engine & MCP Server

<p align="left">
  <a href="https://github.com/Aryanban/seoforge/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License MIT" /></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tests-156%20Passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white" alt="Tests 156 Passing" />
  <img src="https://img.shields.io/badge/Protocol-IndexNow-008080?style=for-the-badge" alt="IndexNow Protocol" />
  <img src="https://img.shields.io/badge/MCP%20Server-18%20tools-purple?style=for-the-badge" alt="Model Context Protocol" />
  <img src="https://img.shields.io/badge/AEO%20%26%20Schema.org-8B5CF6?style=for-the-badge" alt="AEO & Schema.org" />
</p>

An open-source, **Screaming Frog + Ahrefs–grade full-site crawler and technical audit engine**, built with **Answer Engine Optimization (AEO)** scoring, **Internal Link Opportunities**, **Keyword Intelligence**, **Anchor Text Profiling**, deterministic **AI fix documentation**, a local **web dashboard + REST API**, and a **Model Context Protocol (MCP)** server so AI agents can run audits on their own.

**100% Local & Free** — No subscriptions, no API keys, no cloud lock-in, and no crawled data or proprietary URLs ever leave your machine.

> **What's New in 2.0:**
> - **Ahrefs-Grade Link Opportunities Engine:** Identifies missing internal links and keyword contexts across your site to boost target rankings.
> - **Ahrefs Keywords Explorer:** Deterministic Search Intent classification, KD (0–100 Difficulty), referring domains needed, and question clusters.
> - **Anchor Text Profiler & Penguin Detector:** Analyzes brand vs. exact-match vs. generic anchor text distribution with over-optimization risk warnings.
> - **Content Readability & On-Page Optimizer:** Flesch-Kincaid grade level, Flesch Reading Ease score, n-gram keyword density analyzer, and semantic topic gap scanner.
> - **Live SERP & Social Snippet Simulator:** Real-time desktop/mobile Google SERP preview with pixel-width truncation, Open Graph, and Twitter Cards.
> - **156 Automated Vitest Tests** across 13 test suites ensuring rock-solid stability.

---

## ✨ Features & Competitive Advantages

### 🔍 Screaming Frog–Grade Full-Site Crawler
- **BFS Crawl Engine** — Configurable queue, max depth, crawl budget, concurrency, and robots.txt compliance (honoring `Crawl-delay`).
- **Flexible Crawl Strategies** — Choose between `discover` (full link following), `sitemap` (sitemap-only verification), or `config` (targeted URL list).
- **Optional Headless JS Rendering** — Playwright mode (`--render`) for JavaScript-heavy Single Page Applications (React, Next.js, Vue), measuring real Core Web Vitals (LCP, CLS, INP, FCP, TTFB). Raw fetch by default for blazing-fast speed.

### 🔗 Ahrefs-Grade Internal Link & Anchor Intelligence
- **Internal Link Opportunities Engine (`src/link-opportunities.ts`)** — Scans full HTML body copy across the entire crawl to identify non-linked keyword mentions matching your key target pages. Recommends exact anchor phrases and context snippets to pass link equity without keyword cannibalization.
- **Anchor Text Profiler & Penguin Risk Detector (`src/anchor-analyzer.ts`)** — Categorizes anchor texts into Brand, Exact Match, Partial Match, Generic, and Naked URL profiles. Automatically calculates ratios and triggers high/medium over-optimization warnings to protect against Google algorithmic penalties.
- **Link Graph & Orphan Detection** — Complete internal PageRank score, broken link attribution (source URL + HTTP status), single-internal-link warnings, and orphan page isolation.

### 🎯 Keywords Explorer & Search Intent Engine (`src/keyword-intelligence.ts`)
- **Search Intent Classifier** — Classifies queries algorithmically into Informational, Commercial, Transactional, or Navigational intents based on linguistic and syntactic indicators.
- **Keyword Difficulty (KD 0–100)** — Estimates ranking difficulty and computes the required referring domains to hit page 1.
- **Click Potential & SERP Features** — Evaluates SERP real estate, question clusters (People Also Ask style), and commercial modifier suggestions without paying expensive monthly SaaS fees.

### 📝 Content Optimizer & Readability Auditor (`src/content-optimizer.ts`)
- **Readability Metrics** — Computes Flesch Reading Ease and Flesch-Kincaid Grade Level to keep copy accessible and engaging.
- **N-Gram Keyword Density** — Analyzes 1-gram, 2-gram, and 3-gram frequencies to eliminate keyword stuffing while preserving topical relevance.
- **Competitor Content Gap Matrix** — Compares two crawls side-by-side to highlight missing headings, entities, and keyword gaps.

### 🤖 Answer Engine Optimization (AEO) & Structured Data
- **Inverted-Pyramid AEO Analyzer** — Detects concise 40–55 word direct-answer definitions optimized for Google AI Overviews, Perplexity, and ChatGPT Search.
- **Schema.org JSON-LD Generator & Validator** — Generates and validates Article, Organization, Product, LocalBusiness, FAQPage, and BreadcrumbList schemas.
- **LLMs.txt Validator** — Validates presence and formatting of `/llms.txt` and `/llms-full.txt` for AI agent consumption.

### 📋 Deterministic AI Recommendations & Automation
- **Zero-Hallucination AI Fix Backlog** — Every discovered issue generates actionable, structured fix documentation with root causes, step-by-step instructions, and exact code snippets directly from crawl data.
- **206-Source Publishing Engine & Reputation Scorer** — Vetted publishing catalog with DR provenance and a conservative Model 1.1 reputation scorer (ported from BeyondSEO).
- **Instant Search Engine Indexing** — Native IndexNow integration for automated instant submission of new/modified URLs to Bing, Yandex, and IndexNow engines.

---

## 🚀 Quick Start

### 1. Installation

```bash
git clone https://github.com/Aryanban/seoforge.git
cd seoforge
npm install
npm run build
```

### 2. Crawl a Website

```bash
# Blazing-fast raw crawl with terminal report
node dist/cli.js crawl https://example.com --limit 200 --depth 5

# Full SPA rendering with Playwright & Core Web Vitals
node dist/cli.js crawl https://example.com --render

# Export markdown audit and AI fix backlog to reports/
node dist/cli.js crawl https://example.com --limit 500 --save
```

### 3. Launch Local Dashboard

```bash
node dist/cli.js serve          # Opens http://127.0.0.1:5173
```

---

## 🛠️ CLI Reference

| Command | Purpose & Options |
| --- | --- |
| `crawl [url]` | **Full-site BFS crawl.** Options: `--depth`, `--limit`, `--concurrency`, `--render`, `--strategy`, `--sample`, `--save`, `--no-robots` |
| `inspect <url>` | Real-time single-URL deep inspection (TTFB, canonical, meta, schema, CWV, AEO, KD & Intent) |
| `serve` | Local web dashboard + REST API (`--port`, `--host`, `--no-open`) |
| `export <md\|csv\|html>` | Export latest crawl report; CSV types: `pages`, `issues`, `links`, `recommendations` |
| `audit` | Multi-domain audit with sitemap sampling |
| `publish [query]` | Browse 206-source publishing catalog or generate tailored posting plan from `--profile` JSON |
| `discover` | Collect unverified backlink/mention leads via open search (`--query`, `--provider`, `--offline`) |
| `reputation` | Verify candidate backlink/mention sources and score Model 1.1 (`--target --brand --sources`) |
| `compare` | Competitor gap analysis from stored crawls (`--crawl --competitors`) |
| `indexnow --urls a,b` | Dispatch updated URLs to Bing & Yandex via IndexNow protocol |
| `daily` | Complete automated maintenance: crawl, audit, report generation, and IndexNow ping |
| `mcp` | Start Model Context Protocol server on stdio for AI agent pairing |

---

## 🌐 Web Dashboard & REST API

Running `node dist/cli.js serve` launches a modern React + Tailwind UI featuring live Server-Sent Events (SSE) streaming and REST endpoints:

| Endpoint | Method | Role |
| --- | --- | --- |
| `/api/health` | `GET` | System health, version, running jobs |
| `/api/crawl` | `POST` | Dispatch async crawl job |
| `/api/crawl/:id/stream` | `GET` | **SSE live crawl progress & stats** |
| `/api/crawl/:id/issues` | `GET` | Grouped issue list with severity filters |
| `/api/crawl/:id/pages` | `GET` | Crawled pages, status codes, metrics |
| `/api/crawl/:id/links` | `GET` | Internal link opportunities, anchor profile & orphan pages |
| `/api/crawl/:id/recommendations` | `GET` | Actionable AI fix backlog in markdown |
| `/api/crawl/:id/export/:format` | `GET` | Export report as `md`, `csv`, or `html` |
| `/api/inspect` | `POST` | Live single-URL inspection & SERP preview |
| `/api/publish/catalog` | `GET` | 206-source publication catalog |
| `/api/publish/plan` | `POST` | Generate tailored publication plan |
| `/api/reputation` | `POST` | Model 1.1 reputation audit on candidate sources |
| `/api/competitors/compare` | `POST` | Side-by-side competitor audit matrix |

---

## 🔌 Model Context Protocol (MCP) Server (18 Tools)

Connect SEOForge to **Cursor**, **Claude Desktop**, **Antigravity**, or **Zed** to empower AI coding agents to autonomously run audits, optimize content, and review links:

```json
{
  "mcpServers": {
    "seoforge": {
      "command": "node",
      "args": ["/absolute/path/to/seoforge/dist/cli.js", "mcp"],
      "cwd": "/absolute/path/to/seoforge"
    }
  }
}
```

### Available Tools:
1. `seoforge_crawl` — Execute full-site crawl and receive grouped issues with AI fix markdown.
2. `seoforge_crawl_status` — Poll status of async crawl jobs.
3. `seoforge_get_issues` — Retrieve categorized issues filtered by severity (critical, warning, notice).
4. `seoforge_get_recommendations` — Fetch ready-to-implement code fix documentation.
5. `seoforge_get_page` — Deep on-page technical metrics for a specific crawled URL.
6. `seoforge_link_report` — Broken links, redirect chains, orphan pages, internal PageRank scores.
7. `seoforge_sitemap_report` — XML sitemap validity and index coverage.
8. `seoforge_export_report` — Export full reports to markdown, CSV, or HTML.
9. `seoforge_inspect_url` — Real-time on-the-fly inspection of any live URL.
10. `seoforge_submit_indexnow` — Instant URL submission to Bing and Yandex.
11. `seoforge_sample_sitemap` — Fast audit of random sample pages across large sitemaps.
12. `seoforge_check_llms_txt` — Validate `/llms.txt` and `/llms-full.txt` compliance.
13. `seoforge_generate_aeo_snippet` — Synthesize direct-answer paragraphs and FAQPage JSON-LD.
14. `seoforge_publishing_plan` — Build custom outreach publication plans.
15. `seoforge_reputation_report` — Score candidate backlink authority using Model 1.1 rubric.
16. `seoforge_discover_sources` — Discover candidate backlink and mention opportunities.
17. `seoforge_compare_competitors` — Generate competitor gap analysis on crawl data.
18. `seoforge_daily_run` — Trigger complete daily routine (crawl, audit, export, IndexNow).

---

## 🧪 Testing & Verification

SEOForge comes with a comprehensive test suite of **156 tests** covering crawler logic, anchor text distributions, keyword intelligence, link opportunities, reputation scoring, and SQLite persistence:

```bash
# Run all 156 Vitest unit and integration tests
npm test

# Typecheck TypeScript codebase
npm run typecheck
npm run typecheck:web

# Run linter
npm run lint

# Build CLI and React dashboard
npm run build
```

---

## 📄 License

Distributed under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Engineered with precision by <b>Aryan Bansal</b> • <a href="https://www.webforge.me/">webforge.me</a></sub>
</p>
