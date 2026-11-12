# AGENTS.md — SEOForge for AI agents

> **You are an AI agent (Claude Code, opencode, Codex CLI, Cursor, Antigravity, Zed, …).
> This file tells you everything you need to use SEOForge autonomously.** Read it once;
> you should not need to ask a human how to run the tool.

SEOForge 2.0 is a **local, full-site SEO crawler + audit engine**. It crawls a whole site
(BFS, robots-aware), classifies every page against **60+ issue types**, scores **AEO**
(Answer Engine Optimization), writes deterministic **AI fix documents** for each issue, and
persists everything to a local SQLite store reachable from a web dashboard, a REST API, or
MCP. It has **no API keys and makes no external LLM calls** — it is safe to run on any site.

---

## ⚡ Core Operational Doctrine: Ponytail (Always-On In Every Prompt)

> **"You are a lazy senior developer. The best code is the code never written. You solve the whole problem with the least new code."**  
> **Benchmark Impact:** -53% code, -41% latency, -26% cost, -45% tokens, 98% risky logic tested, 100% security maintained.

Every AI agent across all platforms and harnesses MUST follow this doctrine on **every single prompt**:

### 1. Before You Write
- Read the task and the code it touches.
- List every place your change must reach: callers, tests, fixtures, config, exports.
- Check what your change could break for users: data it would destroy/expose, callers that stop working.
- **That is scope. Extra features, speculative abstractions, or unsolicited options are NOT.**

### 2. The Smallest Complete Change Ladder
Take the first option that fully works:
1. **Does it need to exist?** Skip features, options, and flexibility nobody asked for. A vague request gets the smallest version that does the core job.
2. **Already in this codebase?** (Helper, component, service, pattern) Use it the way surrounding code does.
3. **Standard library or platform feature?** Use native platform primitives unless the project has its own.
4. **An installed dependency?** Use it. Never add a new dependency for a few lines.
5. **Can it be one line a reader gets at a glance?** One line.
6. **Otherwise:** The minimum code that works.

### 3. Non-Negotiable Rules
- **Lazy about the solution, never about the change:** Finish every part the task needs (callers, tests, exports).
- **Never cut:** Validation at trust boundaries, data-loss error prevention, security, accessibility, tests for non-trivial logic.
- **Surgical diffs:** The shortest working diff wins. Deletion beats addition. Avoid wrapper classes or type-bloat.
- **One-test rule:** Non-trivial logic (branches, loops, parsers, finance, security) leaves behind one small, crisp test.
- **Mandatory Reply Close:** End every reply with 1–2 lines stating what was skipped or not checked, and any risk the user must know.

---

## 1. Orientation — what's in this repo

```
seoforge/
├── src/cli.ts              # the `seoforge` CLI entrypoint (crawl/inspect/serve/export/mcp/publish/reputation/compare/…)
├── src/crawl/              # BFS crawler: queue, robots, sitemap, fetcher, Playwright renderer
├── src/checks/             # 10 audit modules + schema engine + AEO engine + issue summary
├── src/ai/                 # deterministic recommendations + fix docs + AEO snippet generator
├── src/publishing/         # 206-source publishing catalog + tailored posting-plan builder (ported from BeyondSEO)
├── src/reputation/         # source verifier + reputation model 1.1 scorer (ported from BeyondSEO)
├── src/competitors/        # crawl-based competitor gap matrix
├── src/discovery/          # bounded search leads (unverified) → feeds reputation
├── src/store/              # SQLite persistence (native node:sqlite) + repository queries
├── src/api/server.ts       # local REST API + SSE (hono) — also serves the built dashboard
├── src/mcp/mcp-server.ts   # the MCP server you connect to (18 tools)
├── src/report/             # markdown / CSV / HTML / terminal report writers
├── src/web/client/         # React + Tailwind dashboard (built by Vite into dist/web)
├── docs/implementation-plan/  # full design specs (read these if you need depth)
├── reports/                # generated reports + the SQLite store (ALL GITIGNORED)
└── seoforge.config.json    # configured domains, thresholds, IndexNow key
```

**Everything under `reports/` is generated output and gitignored** — including the SQLite
DB (`reports/seoforge.db`) and all markdown/CSV reports. Never commit crawl data.

---

## 2. First-time setup

Requires **Node ≥ 22** (uses the native `node:sqlite` module — no native build step).

```bash
npm install
npm run build          # tsc -> dist/ AND vite build -> dist/web/
```

Verify it boots:

```bash
node dist/cli.js --version    # -> 2.0.0
```

For development without building, prefix any command with `npx tsx`:

```bash
npx tsx src/cli.ts crawl https://example.com --limit 20
```

**Optional — JS rendering for SPAs** (Core Web Vitals, client-rendered content):

```bash
npm install playwright && npx playwright install chromium
# then add --render to any crawl/inspect command
```

Without Playwright, `--render` silently falls back to raw fetch and records the failure on
the page — it never crashes the crawl.

---

## 3. CLI cheat-sheet

| Command | What it does |
| --- | --- |
| `crawl [url]` | Full-site BFS crawl. `--depth --limit --concurrency --render --reach --strategy discover\|sitemap\|config --sample --save --no-robots` |
| `inspect <url>` | Real-time single-URL deep inspection (TTFB, canonical, meta, schema, CWV, AEO, `--reach`) |
| `reach <url>` | Read and scrape any URL using the Agent Reach engine (bypasses anti-bot & login walls) |
| `reach:doctor` | Check Agent Reach CLI status, installed channels, and tool dependencies |
| `serve` | Local dashboard + REST API on `http://127.0.0.1:5173` (`--port --host --no-open`) |
| `export <md\|csv\|html\|backlog>` | Export the latest crawl (or `--crawl <id>`); CSV `--kind pages\|issues\|links\|recommendations` |
| `publish [query]` | Browse the 206-source catalog (`--category --kind --status`), or build a plan from `--profile` JSON (`--limit --out`) |
| `discover` | Collect **unverified** leads: `-q --query` (repeatable), `--provider duckduckgo-html\|bing-rss`, `--saved-search`, `--host-results`, `--candidate`, `--sources-csv`, `--offline`, `--max-requests --max-queries --max-candidates --seconds` |
| `search-plan` | Plan Google discovery navigation URLs for manual capture (never searches). `--target --brand --pages` |
| `search-import [files...]` | Extract candidates from saved result-page HTML. `--target --query --captured-at --engine` |
| `reputation` | Verify candidate sources + model 1.1 score. `--target --brand --sources --alias --related-host --limit --search-pages --render --out` |
| `compare` | Competitor gap matrix. `--crawl --competitors` (stored) or `--target --competitor-urls` (live, `--limit`) |
| `audit` | v1-compatible multi-domain audit (`--sample N` sitemap sampling) |
| `indexnow --urls a,b` | Ping Bing/Yandex that URLs changed |
| `forecast [url]` | Zero-shot time-series forecasting & anomaly detection via Google Research TimesFM (`--metric --horizon --freq --series --json`) |
| `report` / `daily` | Audit + timestamped markdown report / full daily routine |
| `mcp` | Start the MCP server on stdio |

**Key flags to remember**

- `--limit` is the **crawl budget** (max pages). Set it high enough to cover the site, or
  the crawl stops early and issue counts are incomplete.
- `--save` writes `reports/crawl-<date>.md` + `reports/ai-fix-backlog-<date>.md`.
- `export backlog --all-urls` re-renders the AI fix report with **every affected URL**
  listed (the default report caps at 20 URLs per issue). This is the file you want when
  actually fixing things.
- `discover --offline` collects leads with **zero network** (supplied/imported evidence
  only). Its `sources.csv` drops straight into `reputation --sources`.

---

## 4. Connecting via MCP (recommended for agents)

Build first (`npm run build`), then point any MCP client at the compiled CLI. The server
speaks stdio and needs **no environment variables or keys**.

**Claude Desktop / Antigravity / Cursor** (`mcp_config.json` or
`claude_desktop_config.json`):

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

**Claude Code** (CLI):

```bash
claude mcp add seoforge -- node /absolute/path/to/seoforge/dist/cli.js mcp
```

**opencode** (`opencode.json` / `opencode.json5`):

```json5
{
  mcp: {
    seoforge: {
      type: "local",
      command: ["node", "/absolute/path/to/seoforge/dist/cli.js", "mcp"],
      enabled: true,
    },
  },
}
```

**OpenAI Codex CLI** (`~/.codex/config.toml`):

```toml
[mcp_servers.seoforge]
command = "node"
args = ["/absolute/path/to/seoforge/dist/cli.js", "mcp"]
```

**Google Antigravity (AGY)** (`~/.gemini/antigravity/mcp_config.json`):

```json
{
  "mcpServers": {
    "seoforge": {
      "command": "node",
      "args": ["/absolute/path/to/seoforge/dist/cli.js", "mcp"],
      "env": { "NODE_ENV": "production" }
    }
  }
}
```

**Cursor / Windsurf** (`.cursor/mcp.json` / `~/.codeium/windsurf/mcp_config.json`):

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

### The 38 Native MCP Tools

| Tool | Purpose |
| --- | --- |
| `seoforge_crawl` | Full-site crawl → grouped issues + AI fix markdown. `async_mode` for large sites, `reach: true` for anti-bot scraping. |
| `seoforge_crawl_status` | Poll an async crawl until `status === "completed"` |
| `seoforge_get_issues` | Grouped issues, filterable by severity, with affected URLs |
| `seoforge_get_recommendations` | Full AI fix backlog as markdown — paste-ready for tickets/PRs |
| `seoforge_get_page` | Full audit detail for one page |
| `seoforge_link_report` | broken / internal / external / redirects, orphans, link scores |
| `seoforge_sitemap_report` | Sitemap validity + orphan-in-sitemap |
| `seoforge_export_report` | md / csv / html export into `reports/` |
| `seoforge_inspect_url` | Live single-URL inspection (+render, +reach) |
| `seoforge_reach_read` | Scrape & read any URL via Agent Reach anti-bot engine (bypasses login/anti-bot walls) |
| `seoforge_reach_status` | Inspect Agent Reach engine version, channels, and dependencies |
| `seoforge_forecast` | TimesFM zero-shot time series forecasting & anomaly detection (P10/P50/P90 quantile intervals for AEO, errors, CWV, traffic) |
| `seoforge_submit_indexnow` | IndexNow dispatch to Bing, Yandex, and Naver |
| `seoforge_sample_sitemap` | Audit N random deep sitemap routes |
| `seoforge_check_llms_txt` | `/llms.txt` + `/llms-full.txt` validation |
| `seoforge_generate_aeo_snippet` | Inverted-pyramid answer paragraph + FAQ JSON-LD |
| `seoforge_publishing_plan` | Tailored posting plan from the 206-source catalog |
| `seoforge_reputation_report` | Verify candidate source URLs + model-1.1 reputation score |
| `seoforge_discover_sources` | Collect unverified leads from bounded search / saved HTML |
| `seoforge_compare_competitors` | Competitor gap matrix from stored crawls or live URLs |
| `seoforge_daily_run` | Full daily routine: audit + report + IndexNow |
| `seoforge_analyze_content` | Flesch readability, word counts, heading hierarchy, keyword density |
| `seoforge_generate_schema` | Automated Schema.org JSON-LD generation (Article, FAQ, Product, LocalBusiness) |
| `seoforge_link_opportunities` | Unlinked target keyword mentions across internal pages |
| `seoforge_keyword_intelligence` | Search intent classification, term frequencies, TF-IDF scoring |
| `seoforge_crawl_diff` | Git-style crawl diffing & SEO regression detection |
| `seoforge_log_audit` | Server log audit (Googlebot hit frequency vs wasted crawl budget) |
| `seoforge_cannibalization` | Detect competing URLs targeting identical keyword intent |
| `seoforge_custom_extract` | Extract arbitrary data using CSS selectors, XPath, or Regex |
| `seoforge_score_content` | Real-time content grade & SEO optimization scoring |
| `seoforge_patch_codebase` | Surgical AST-based code patcher for Next.js, HTML, Astro |
| `seoforge_link_intersect` | Common backlink opportunities and competitor domain overlap |
| `seoforge_content_gap` | Keyword and topic gap vs top competitor URLs |
| `seoforge_robots_test` | RFC 9309 simulation & AI crawler (GPTBot, ClaudeBot) permission check |
| `seoforge_trace_redirects` | Trace complete redirect hops, status codes, and loop risks |
| `seoforge_pagespeed_lab` | Local lab Core Web Vitals (LCP, CLS, INP, TTFB) estimator |
| `seoforge_ci_gate` | Enforce zero-regression thresholds in GitHub Actions & CI |
| `seoforge_anchor_profile` | Anchor text distribution & Google Penguin risk profiling |

**Agent ergonomics:** every tool returns structured JSON and returns errors as
`{ "error": … }` instead of throwing — recover programmatically. Crawls persist to SQLite,
so results survive across sessions and are visible in the dashboard.

### Standard autonomous pattern

```
1. seoforge_crawl(url, async_mode: true, limit: 1000)      -> crawlId
2. loop: seoforge_crawl_status(crawlId)  until completed
3. seoforge_get_recommendations(crawlId)                   -> fix markdown per issue
4. apply fixes in the codebase
5. seoforge_crawl(url, ...) again                          -> "change" deltas show what resolved
6. seoforge_submit_indexnow(urls)                          -> ask engines to re-crawl
```

---

## 5. REST API (when MCP isn't available)

Start `node dist/cli.js serve` (binds to `127.0.0.1:5173` — **loopback only, no auth**),
then:

| Endpoint | Role |
| --- | --- |
| `GET /api/health` | liveness + version |
| `POST /api/crawl` | start async crawl → `{"crawlId":…}` |
| `GET /api/crawl/:id/stream` | **SSE** live progress |
| `POST /api/crawl/:id/stop` | stop a running crawl |
| `GET /api/crawls` / `GET /api/crawl/:id` | history / summary |
| `GET /api/crawl/:id/issues` | grouped issues (`?severity=&category=&search=&page=&pageSize=`) |
| `GET /api/crawl/:id/issue-urls` | URLs for one issue group |
| `GET /api/crawl/:id/pages` / `/links` / `/recommendations` / `/sitemap` / `/trend` | detail views |
| `GET /api/crawl/:id/forecast` | TimesFM zero-shot forecast for crawl metric (`?metric=&horizon=&freq=`) |
| `POST /api/forecast` | TimesFM arbitrary time series forecast (`{series, horizon, freq, metric}`) |
| `GET /api/crawl/:id/export/{md,html,csv}` | report export |
| `GET /api/publish/catalog` | browse the 206-source publishing catalog (`?category=&kind=&status=`) |
| `POST /api/publish/plan` | build a tailored posting plan from a profile |
| `GET /api/publish/plans[/:id]` | list / fetch saved plans |
| `POST /api/reputation` | verify source URLs + model-1.1 score |
| `GET /api/reputation[/:id]` | list / fetch assessments |
| `POST /api/discover` | collect unverified search leads (`offline` for zero network) |
| `GET /api/discover` / `/api/discover/:id` | list / fetch discovery runs |
| `POST /api/competitors/compare` | competitor gap matrix (stored crawls or live URLs) |
| `GET /api/competitors[/:id]` | list / fetch comparisons |
| `POST /api/inspect` | single-page inspection |
| `GET` / `PUT /api/config` | read/write `seoforge.config.json` |

---

## 6. Reading the output (report formats)

| File | Contents |
| --- | --- |
| `reports/crawl-<date>.md` | Full audit report: issue overview table + per-page metrics |
| `reports/ai-fix-backlog-<date>.md` | Prioritized AI fixes (why-it-matters / steps / before-after), 20 URLs per issue |
| `reports/<target>-full-ai-report.md` | Same backlog with **every affected URL** (`export backlog --all-urls`) — **the handoff file** |
| `reports/crawl-issues-<date>.csv` | One row per (issue × page URL) — for bulk/spreadsheet work |
| `reports/seoforge.db` | the SQLite store — query directly with `node:sqlite` if needed |

Issue severities: **Error** (blocks indexing/access) → **Warning** (weakens rankings) →
**Notice** (polish). Each issue carries a `change` delta vs the previous crawl of the same
target, so `📈 +N` means newly introduced and `📉 -N` means resolved.

---

## 7. Current state of this project

Configured audit targets in `seoforge.config.json`: **Webforge Portfolio**
(`https://www.webforge.me/`) and **PlotBook Real Estate Intelligence**
(`https://plotbook.webforge.me/`). The scheduled GitHub Actions autopilot is **disabled** —
nothing crawls on a schedule; run audits manually instead:

```bash
npx tsx src/cli.ts crawl https://www.webforge.me --limit 200 --save
node dist/cli.js export backlog --all-urls     # → reports/<target>-full-ai-report.md
```

When one issue flags hundreds of pages, the root cause is nearly always a shared
layout/component — fix it once at the template level, then re-crawl to confirm the delta
drops. The prioritized fix backlog groups issues like this (illustrative example):

| Issue | Severity | Pages |
| --- | --- | --- |
| Meta description too long | Warning | 991 |
| Title tag too long | Warning | 988 |
| Image uses legacy format | Notice | 998 |
| Structured data schema.org error | Notice | 998 |
| Indexable page not in sitemap | Notice | 718 |
| Only one incoming internal link | Notice | 237 |

---

## 8. Ported BeyondSEO modules (`publishing`, `reputation`, `competitors`, `discovery`)

Four modules were ported from [BeyondSEO](https://github.com/beyondtahir/beyondseo)
(MIT, Muhammad Tahir Ashraf) into native TypeScript — see `THIRD_PARTY_NOTICES.md`
for exact provenance. They keep SEOForge's deterministic, no-API-key contract.

**`src/discovery/` — bounded search leads.** `discover` collects candidate URLs for
`reputation` without a paid index. Sources are tried in strict precedence per query:
host-recorded results first (your own search tool, never impersonated), then native
providers (`duckduckgo-html`, `bing-rss`) in order. Native attempts have **zero retries**
— a failure advances to the next provider — and share one request + wall-clock budget that
also covers robots. robots.txt is honoured per provider origin; when the policy cannot be
retrieved the request is **withheld, not sent**. `--offline` runs on supplied/imported
evidence only (zero network). Own-site, subdomain and search-provider hosts are filtered
out of the leads, and every survivor is recorded as `unverified_lead`:

- A search result is a lead, never a confirmed backlink or mention. `sources.csv` is the
  handoff file — it drops straight into `reputation --sources`.
- `search-plan` emits Google *navigation* URLs only and `search-import` extracts links
  from pages you already saved; neither claims to have run a live search.
- A failed/withheld provider is not a failed audit: supply URLs or import saved pages
  instead. Attempt status codes (`robots_restricted`, `provider_challenge`,
  `provider_rate_limited`, …) record the *observed evidence*, not a blamed cause.

**`src/publishing/` — 206-source catalog + posting plans.** Feed `publish --profile`
a business profile (example at `examples/posting-profile.json`) for a capacity-dated
shortlist. The eligibility gates are the point: only `guidance_reviewed` sites with a
documented route, established free terms, fresh guidance (≤90 days) and topical fit are
selected; everything else lands in `excluded_summary`. A short plan is *explained*,
never padded. **Sheet DR values are unverified provenance and never rank the shortlist.**

**`src/reputation/` — model 1.1.** `reputation --target --brand --sources` fetches each
candidate, looks for an actual link to your host and your brand in captured text, then
scores. The conservatism is deliberate and load-bearing:
- Unknown rubric dimensions earn **no** supported points — an unreviewed observed link is
  40 supported points, range 40–100, never a strong-authority verdict.
- The headline multiplies supported points by the **weakest measured evidence factor**, so
  checking only a favourable subset cannot imply complete evidence.
- Low-confidence headlines **cap at 49/100**; no conclusive link checks **withhold** the
  headline. Unchecked candidates stay in the coverage denominator.

**`src/competitors/` — gap matrix.** `compare` diffs a baseline crawl against competitor
crawls on measured evidence (AEO, issue counts, depth, schema coverage, internal links).
It discloses crawl-budget parity — an uneven sample is a sampling artifact, not a
performance gap. **Not a ranking or traffic estimate.**

All four persist to SQLite (`publishing_plans`, `reputation_assessments` +
`reputation_sources`, `competitor_comparisons`, `discovery_runs`) and are reachable from
CLI, the four new MCP tools, the REST API, and dashboard views (Publishing / Reputation /
Competitors).

---

## 9. Foundation Models & Reference Implementations: Google TimesFM

SEOForge continually improves feature depth, mathematical accuracy, and execution speed by
taking direct architectural reference from industry-leading open-source repositories:

**`src/forecasting/` — Google Research TimesFM (`google-research/timesfm`).** Time-series
forecasting foundation model architecture ported to native zero-dependency TypeScript:
- **Patch-based sequential tokenization & normalization:** groups sequential crawl/search
  observations into multi-scale patches, normalizing local variance to resist sudden outliers.
- **Zero-shot multi-horizon projection:** projects arbitrary horizon lengths ($T+1$ through
  $T+365$) with empirical P10, P50, and P90 quantile confidence bounds that expand over time.
- **Frequency conditioning:** native support for daily, weekly, monthly, and event-based crawl
  intervals with harmonic seasonal cycle detection.
- **In-sample anomaly detection:** utilizes robust Median Absolute Deviation (MAD) residual
  scoring to flag sudden traffic drops, algorithm penalty drops, or error spikes without
  contamination from outlier inflation.
- **Direct SEO metrics:** seamlessly forecasts AEO scores, critical errors, warnings, notices,
  crawled URL volumes, Core Web Vitals, or custom user-supplied time series.

---

## 10. Background Task & Process Engine (Crawlee, p-queue & Litestream)

SEOForge implements background processing patterns inspired by industry-standard background task architectures:
- **`src/crawl/queue.ts` — Event-Driven Zero-Polling Task Slot Resolution (p-queue / Crawlee):** Replaces busy-wait spin loops (`setTimeout(25)`) with an event-driven `waitForItem()` slot notification. Waiting worker threads wake up on the exact microtask new URLs are enqueued (0ms task pickup latency vs 25ms timer lag).
- **`src/crawl/crawler.ts` — Exponential Retry with Full Jitter (Crawlee RequestQueue / AWS Architecture):** Transient failures (HTTP 429 rate limits, HTTP 503 overloads, connection drops) are automatically re-queued with exponential backoff and randomized jitter: $\min(8000, 1000 \cdot 2^{\text{retry}} + \text{jitter})$, honoring `Retry-After` response headers without dropping crawl data.
- **`src/api/server.ts` — Event-Driven SSE Stream Backpressure:** Replaces timer-based polling (`while(running) setTimeout(500)`) with event-driven lifecycle listeners (`crawler.once("done")` and `signal.onabort`), eliminating 100% of background timer wakeups for connected clients.
- **`src/store/db.ts` — Passive WAL Checkpointing (Litestream / SQLite Daemon Pattern):** Flushes accumulated write-ahead log pages (`checkpointStore`) in the background after crawl batch transactions without locking active readers or writers, preventing SQLite WAL disk bloat.

---

## 11. Conventions & gotchas

- **Node ≥ 22 is mandatory** — `node:sqlite`. Enforced in `engines` and in CI.
- **Never commit `reports/`** — the DB, WAL/SHM sidecars, and all generated reports are
  gitignored on purpose. The repo ships no crawl data.
- **API is loopback-only by design** (`127.0.0.1`). No auth — do not expose it publicly.
- **Set `--limit` generously.** A budget smaller than the site truncates the crawl and
  under-counts issues. Full reconstruction from the store returns the whole crawl, but
  only for pages that were actually crawled.
- **`--render` needs Playwright** (optional dependency); otherwise it falls back to raw
  fetch. Core Web Vitals issues only appear in render mode.
- **Fixes should be template-level first.** When one issue flags hundreds of pages, the
  root cause is nearly always a shared layout/component — fix it once, then re-crawl to
  confirm the delta drops.
- **Deterministic, not generative:** the "AI" recommendations are template-rendered from
  real crawl data. They never hallucinate, and they never send your URLs anywhere.

---

## 12. Quality gates (run these before declaring done)

```bash
npm run typecheck         # engine types
npm run typecheck:web     # dashboard types
npm run lint              # eslint flat config (typescript-eslint)
npm test                  # vitest — 135 tests incl. fixture-site crawl
npm run build             # tsc -> dist/ + vite -> dist/web/
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push and PR. Design docs:
`docs/implementation-plan/README.md`.
