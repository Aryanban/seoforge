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
├── src/store/              # SQLite persistence (native node:sqlite) + repository queries
├── src/api/server.ts       # local REST API + SSE (hono) — also serves the built dashboard
├── src/mcp/mcp-server.ts   # the MCP server you connect to (17 tools)
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
| `crawl [url]` | Full-site BFS crawl. `--depth --limit --concurrency --render --strategy discover\|sitemap\|config --sample --save --no-robots` |
| `inspect <url>` | Real-time single-URL deep inspection (TTFB, canonical, meta, schema, CWV, AEO) |
| `serve` | Local dashboard + REST API on `http://127.0.0.1:5173` (`--port --host --no-open`) |
| `export <md\|csv\|html\|backlog>` | Export the latest crawl (or `--crawl <id>`); CSV `--kind pages\|issues\|links\|recommendations` |
| `publish [query]` | Browse the 206-source catalog (`--category --kind --status`), or build a plan from `--profile` JSON (`--limit --out`) |
| `reputation` | Verify candidate sources + model 1.1 score. `--target --brand --sources --alias --related-host --limit --search-pages --render --out` |
| `compare` | Competitor gap matrix. `--crawl --competitors` (stored) or `--target --competitor-urls` (live, `--limit`) |
| `audit` | v1-compatible multi-domain audit (`--sample N` sitemap sampling) |
| `indexnow --urls a,b` | Ping Bing/Yandex that URLs changed |
| `report` / `daily` | Audit + timestamped markdown report / full daily routine |
| `mcp` | Start the MCP server on stdio |

**Key flags to remember**

- `--limit` is the **crawl budget** (max pages). Set it high enough to cover the site, or
  the crawl stops early and issue counts are incomplete.
- `--save` writes `reports/crawl-<date>.md` + `reports/ai-fix-backlog-<date>.md`.
- `export backlog --all-urls` re-renders the AI fix report with **every affected URL**
  listed (the default report caps at 20 URLs per issue). This is the file you want when
  actually fixing things.

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

### The 17 MCP tools

| Tool | Purpose |
| --- | --- |
| `seoforge_crawl` | Full-site crawl → grouped issues + AI fix markdown. `async_mode` for large sites. |
| `seoforge_crawl_status` | Poll an async crawl until `status === "completed"` |
| `seoforge_get_issues` | Grouped issues, filterable by severity, with affected URLs |
| `seoforge_get_recommendations` | Full AI fix backlog as markdown — paste-ready for tickets/PRs |
| `seoforge_get_page` | Full audit detail for one page |
| `seoforge_link_report` | broken / internal / external / redirects, orphans, link scores |
| `seoforge_sitemap_report` | Sitemap validity + orphan-in-sitemap |
| `seoforge_export_report` | md / csv / html export into `reports/` |
| `seoforge_inspect_url` | Live single-URL inspection (+render) |
| `seoforge_submit_indexnow` | IndexNow dispatch to Bing/Yandex |
| `seoforge_sample_sitemap` | Audit N random deep sitemap routes |
| `seoforge_check_llms_txt` | `/llms.txt` + `/llms-full.txt` validation |
| `seoforge_generate_aeo_snippet` | Inverted-pyramid answer paragraph + FAQ JSON-LD |
| `seoforge_publishing_plan` | Tailored posting plan from the 206-source catalog (or catalog browse). Deterministic, no network. |
| `seoforge_reputation_report` | Verify candidate source URLs + model-1.1 reputation score (conservative: low-confidence cap 49/100) |
| `seoforge_compare_competitors` | Competitor gap matrix from stored crawls or live URLs |
| `seoforge_daily_run` | Full daily routine: audit + report + IndexNow |

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
| `GET /api/crawl/:id/export/{md,html,csv}` | report export |
| `GET /api/publish/catalog` | browse the 206-source publishing catalog (`?category=&kind=&status=`) |
| `POST /api/publish/plan` | build a tailored posting plan from a profile |
| `GET /api/publish/plans[/:id]` | list / fetch saved plans |
| `POST /api/reputation` | verify source URLs + model-1.1 score |
| `GET /api/reputation[/:id]` | list / fetch assessments |
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
| `reports/dholeramap-full-ai-report.md` | Same backlog with **every affected URL** (`export backlog --all-urls`) — **the handoff file** |
| `reports/crawl-issues-<date>.csv` | One row per (issue × page URL) — for bulk/spreadsheet work |
| `reports/seoforge.db` | the SQLite store — query directly with `node:sqlite` if needed |

Issue severities: **Error** (blocks indexing/access) → **Warning** (weakens rankings) →
**Notice** (polish). Each issue carries a `change` delta vs the previous crawl of the same
target, so `📈 +N` means newly introduced and `📉 -N` means resolved.

---

## 7. Current state of this project

Crawled `https://dholeramap.com` at budget 1000 / depth 10: **1000 pages**, robots ✓,
sitemap ✓ (282 URLs), llms.txt ✓, **AEO 100/100**, health **0 Errors / 1988 Warnings /
2968 Notices**. The full, every-URL fix report is:

```
/Users/aryanbansal/Documents/seoforge/reports/dholeramap-full-ai-report.md
/Users/aryanbansal/Documents/seoforge/reports/dholeramap-issues.csv
```

Top items (the two **High** ones are almost certainly a single template fix):

| Issue | Severity | Pages |
| --- | --- | --- |
| Meta description too long | Warning | 991 |
| Title tag too long | Warning | 988 |
| Image uses legacy format | Notice | 998 |
| Structured data schema.org error | Notice | 998 |
| Indexable page not in sitemap | Notice | 718 |
| Only one incoming internal link | Notice | 237 |

---

## 8. Ported BeyondSEO modules (`publishing`, `reputation`, `competitors`)

Three modules were ported from [BeyondSEO](https://github.com/beyondtahir/beyondseo)
(MIT, Muhammad Tahir Ashraf) into native TypeScript — see `THIRD_PARTY_NOTICES.md`
for exact provenance. They keep SEOForge's deterministic, no-API-key contract.

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

All three persist to SQLite (`publishing_plans`, `reputation_assessments` +
`reputation_sources`, `competitor_comparisons`) and are reachable from CLI, the three new
MCP tools, the REST API, and dashboard views (Publishing / Reputation / Competitors).

---

## 9. Conventions & gotchas

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

## 10. Quality gates (run these before declaring done)

```bash
npm run typecheck         # engine types
npm run typecheck:web     # dashboard types
npm run lint              # eslint flat config (typescript-eslint)
npm test                  # vitest — 96 tests incl. fixture-site crawl
npm run build             # tsc -> dist/ + vite -> dist/web/
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push and PR. Design docs:
`docs/implementation-plan/README.md`.
