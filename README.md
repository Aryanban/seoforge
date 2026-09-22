# SEOForge ⚡ • Full-Site SEO Crawler, Audit Engine & MCP Server

<p align="left">
  <a href="https://github.com/Aryanban/seoforge/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License MIT" /></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Protocol-IndexNow-008080?style=for-the-badge" alt="IndexNow Protocol" />
  <img src="https://img.shields.io/badge/MCP%20Server-14%20tools-purple?style=for-the-badge" alt="Model Context Protocol" />
  <img src="https://img.shields.io/badge/AEO%20%26%20Schema.org-8B5CF6?style=for-the-badge" alt="AEO & Schema.org" />
</p>

An open-source, **Screaming Frog–grade full-site crawler** with an **Ahrefs-grade technical
audit engine**, **Answer Engine Optimization (AEO)** scoring, deterministic **AI fix
documentation**, a local **web dashboard + REST API**, and a **Model Context Protocol
(MCP)** server so AI agents can run audits on their own. 100% local — no API keys, no
cloud, no crawled URLs ever leave your machine.

> **New in 2.0:** a real BFS crawl engine (replaces the v1 path-fetcher), 60+ grouped issue
> types, SQLite persistence with trend tracking, a React dashboard with live SSE progress,
> and an expanded 15-tool MCP server. See [`docs/implementation-plan/`](./docs/implementation-plan/README.md)
> for the full design.

---

## ✨ Features

- **Full-site BFS crawler** — queue, depth, crawl budget, concurrency, robots.txt
  compliance (with `Crawl-delay`), recursive sitemap-index parsing, and three strategies:
  `discover`, `sitemap`, or `config`.
- **Optional JS rendering** — Playwright mode (`--render`) for SPAs, collecting Core Web
  Vitals (LCP / CLS / INP / FCP). Raw fetch by default; zero cost if you don't need it.
- **60+ issue types across 10 check modules** — indexability, meta, headings, content,
  links, images, sitemap, robots, performance, technical, structured data, and AEO.
- **Link graph** — broken-link attribution, **orphan-page detection**, single-internal-link
  flags, sitemap cross-referencing, and a PageRank-style internal link score.
- **Deterministic AI recommendations** — every issue ships with a full fix document
  (why-it-matters / step-by-step / before-after) generated from your real crawl data. No
  LLM, no API key, no cost, no hallucination.
- **AEO scoring** — the inverted-pyramid model: detects 40–55 word direct-answer
  paragraphs, validates `@graph` schema entities, and generates FAQPage JSON-LD.
- **Publishing & backlink planning** — a 206-source publishing catalog with DR provenance
  and a tailored, capacity-dated posting-plan builder. Filters out sites without
  documented free routes or topical fit and reports every exclusion. Ported from
  BeyondSEO (MIT, Beyond Tahir).
- **Reputation scoring (model 1.1)** — verify candidate backlink/mention source pages and
  score them under a conservative, fully transparent rubric: unknown evidence is never
  inflated, the weakest measured evidence factor gates the headline, and low-confidence
  scores cap at 49/100. Ported from BeyondSEO.
- **Competitor gap analysis** — compare your crawl against competitor crawls on measured
  evidence (AEO, issue counts, content depth, schema coverage, internal-link strength),
  with explicit crawl-budget parity disclosure so an uneven sample can't pose as a verdict.
- **SQLite persistence** — native `node:sqlite`, trend queries over time, filtered reads,
  and legacy v1 snapshot migration.
- **Local web dashboard + REST API** — React + Tailwind UI served on loopback with SSE
  live crawl progress, or drive it programmatically over HTTP.
- **17-tool MCP server** — give Claude, Cursor, Antigravity, or Zed the ability to crawl a
  site, read the audit, and get ready-to-paste fix markdown.

---

## 🚀 Quick start

```bash
git clone https://github.com/Aryanban/seoforge.git
cd seoforge
npm install
npm run build
```

Crawl a site:

```bash
# Full-site crawl with the terminal report
node dist/cli.js crawl https://dholeramap.com --limit 200 --depth 5

# SPA support via Playwright
node dist/cli.js crawl https://dholeramap.com --render

# Save markdown + AI fix-backlog reports to reports/
node dist/cli.js crawl https://dholeramap.com --limit 500 --save
```

Launch the dashboard:

```bash
node dist/cli.js serve          # → http://127.0.0.1:5173
```

---

## 🛠️ CLI commands

| Command | Purpose |
| --- | --- |
| `crawl [url]` | **Full-site BFS crawl.** Options: `--depth`, `--limit`, `--concurrency`, `--render`, `--strategy`, `--sample`, `--save`, `--no-robots` |
| `inspect <url>` | Real-time single-URL deep inspection (TTFB, canonical, meta, schema, CWV, AEO) |
| `serve` | Local web dashboard + REST API (`--port`, `--host`, `--no-open`) |
| `export <md\|csv\|html>` | Export the latest crawl (or `--crawl <id>`); CSV kinds: `pages`, `issues`, `links`, `recommendations` |
| `audit` | v1-compatible multi-domain audit with `--sample` sitemap sampling |
| `publish [query]` | Browse the 206-source publishing catalog (`--category --kind --status`), or build a tailored posting plan from a `--profile` JSON |
| `reputation` | Verify candidate backlink/mention sources and score model 1.1 (`--target --brand --sources`) |
| `compare` | Competitor gap analysis from stored crawls (`--crawl --competitors`) or live URLs (`--target --competitor-urls`) |
| `indexnow --urls a,b` | Dispatch changed URLs to Bing & Yandex |
| `report` | Audit + timestamped markdown report in `reports/` |
| `daily` | Full maintenance routine: audit, report, IndexNow |
| `mcp` | Start the MCP server on stdio |

Publishing and reputation examples:

```bash
# Tailored posting plan from a business profile (see examples/posting-profile.json)
node dist/cli.js publish --profile examples/posting-profile.json --limit 15 --out reports/posting

# Score your backlink evidence from a list of candidate source URLs
node dist/cli.js reputation --target https://dholeramap.com --brand "DholeraMap" \
  --sources reports/sources.txt --out reports/reputation

# Compare against competitors from stored crawls
node dist/cli.js compare --crawl crawl_123 --competitors crawl_456,crawl_789
```

---

## 🌐 Web dashboard & REST API

`seoforge serve` exposes a minimalistic dashboard (Overview, Issues, Pages, Links,
Sitemaps, AI Fixes, Publishing, Reputation, Competitors, Reports, Settings) and a
loopback REST API:

| Endpoint | Role |
| --- | --- |
| `GET /api/health` | Version + running/completed counts |
| `POST /api/crawl` | Start an async crawl → returns `crawlId` |
| `GET /api/crawl/:id/stream` | **SSE** live progress |
| `GET /api/crawl/:id/issues` | Grouped issues (filter + paginate) |
| `GET /api/crawl/:id/pages` / `/links` / `/recommendations` | Crawl detail views |
| `GET /api/crawl/:id/export/{md,html,csv}` | Report export |
| `GET /api/publish/catalog` | Browse the 206-source publishing catalog |
| `POST /api/publish/plan` | Build a tailored posting plan from a profile |
| `POST /api/reputation` | Verify sources and score model 1.1 |
| `POST /api/competitors/compare` | Competitor gap analysis |
| `POST /api/inspect` | Single-page inspection |

The header doubles as a crawl runner — enter a URL, press Crawl, and progress streams in
via SSE.

---

## 🔌 MCP server (17 tools)

Give any MCP-compatible client (Claude Desktop, Cursor, Antigravity, Zed) the ability to
run audits autonomously:

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

| Tool | Purpose |
| --- | --- |
| `seoforge_crawl` | Full-site crawl → grouped issues + AI fix markdown (`async_mode` for large sites) |
| `seoforge_crawl_status` | Poll an async crawl to completion |
| `seoforge_get_issues` | Grouped issues, filterable by severity |
| `seoforge_get_recommendations` | The full AI fix backlog as markdown |
| `seoforge_get_page` | Single-page audit detail |
| `seoforge_link_report` | Broken / internal / external / redirect links, orphans, link scores |
| `seoforge_sitemap_report` | Sitemap validity + orphan-in-sitemap |
| `seoforge_export_report` | md / csv / html export to `reports/` |
| `seoforge_inspect_url` | Real-time single-URL inspection (+render) |
| `seoforge_submit_indexnow` | IndexNow dispatch to Bing/Yandex |
| `seoforge_sample_sitemap` | Audit N random deep sitemap routes |
| `seoforge_check_llms_txt` | `/llms.txt` + `/llms-full.txt` validation |
| `seoforge_generate_aeo_snippet` | Inverted-pyramid answer + FAQ JSON-LD generator |
| `seoforge_publishing_plan` | Tailored posting plan from the 206-source catalog, or catalog browse |
| `seoforge_reputation_report` | Verify candidate sources + model-1.1 reputation score |
| `seoforge_compare_competitors` | Competitor gap matrix on crawl evidence |
| `seoforge_daily_run` | Full daily routine (audit + report + IndexNow) |

Crawls persist to SQLite, so an agent's results are immediately visible in the dashboard
and re-queryable across sessions.

---

## ☁️ Autonomous 24/7 automation

Pre-configured GitHub Actions workflows:

- **`.github/workflows/ci.yml`** — typecheck, lint, test, and build on every push/PR.
- **`.github/workflows/daily-seo.yml`** — runs the daily routine at 00:00 UTC, audits your
  live properties, dispatches to IndexNow, and archives the report as an artifact.

---

## 🧪 Development

```bash
npm run typecheck       # engine types
npm run typecheck:web   # dashboard types
npm test                # 34 vitest tests
npm run lint            # eslint (flat config)
npm run build           # tsc → dist/ + vite build → dist/web/
```

Requires **Node ≥ 22** (native `node:sqlite`). Design docs live in
[`docs/implementation-plan/`](./docs/implementation-plan/README.md).

---

## 📄 License

Distributed under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Engineered with precision by <b>Aryan Bansal</b> • <a href="https://www.webforge.me/">webforge.me</a></sub>
</p>
