# 04 — Persistence, REST API, and Web Dashboard

## Persistence

`src/store/db.ts` + `src/store/repository.ts` — SQLite via the **native `node:sqlite`**
module (Node ≥ 22, no native build step, no `better-sqlite3` compilation).

Tables: `crawls`, `pages`, `issues`, `links`, `sitemap_urls`, `recommendations`.

Enabled features: `WAL` journal mode, transactional bulk inserts, indexes on
`crawl_id` and `severity`.

Capabilities:

- **Trend queries** — health over time per target (errors/warnings/AEO per crawl).
- **Filtered reads** — issues by severity/category/search, pages by status/text/orphan,
  links by kind (internal/external/broken/redirects), all paginated.
- **Full-result reconstruction** — `getFullCrawl` rebuilds a complete `CrawlResult` after a
  server restart so exports still work from disk.
- **Legacy migration** — `reports/.snapshots/*.json` (1.x format) are imported into the
  store on first run so historical change deltas survive the upgrade.

## REST API

`src/api/server.ts` — [hono](https://hono.dev/) on `@hono/node-server`, bound to
`127.0.0.1` by default (loopback only — the tool is local-first).

| Endpoint | Role |
| --- | --- |
| `GET /api/health` | version + running/completed counts |
| `GET/PUT /api/config` | read/write `seoforge.config.json` |
| `POST /api/crawl` | start a crawl (returns `crawlId` immediately) |
| `POST /api/crawl/:id/stop` | stop a running crawl |
| `GET /api/crawl/:id/progress` | last progress snapshot |
| `GET /api/crawl/:id/stream` | **SSE** live progress for the dashboard |
| `GET /api/crawls` | crawl history |
| `GET /api/crawl/:id` | crawl summary |
| `GET /api/crawl/:id/issues` | grouped issues (filter + paginate) |
| `GET /api/crawl/:id/issue-urls` | URLs for one issue group |
| `GET /api/crawl/:id/pages` | pages (search/status/orphan/minAEO + paginate) |
| `GET /api/crawl/:id/links` | links (kind: broken/internal/external/redirects) |
| `GET /api/crawl/:id/recommendations` | AI fix docs |
| `GET /api/crawl/:id/sitemap` | sitemap URLs |
| `GET /api/crawl/:id/trend` | health trend |
| `GET /api/crawl/:id/export/{md,html,csv}` | report export |
| `POST /api/inspect` | single-page deep inspection |

Static asset serving: the built dashboard in `dist/web` is served from the same origin, so
one `seoforge serve` process exposes both UI and API.

## Web dashboard

`src/web/client/` — React 19 + React Router 7 + Tailwind v4, built by Vite into `dist/web`.
Deliberately minimalistic: a single flat sidebar, no nested menus.

Views:

| View | Content |
| --- | --- |
| **Overview** | AEO dial, KPI cards, top issues, SVG health trend, crawl facts |
| **Issues** | Ahrefs-style grouped table, severity/search filters, expandable affected URLs |
| **Pages** | page metrics table with status filter/search + click-to-expand page detail (meta, canonical, schema, per-page issues) |
| **Links** | broken / internal / external / redirects tabs |
| **Sitemaps** | accessibility, counts, orphan-in-sitemap |
| **AI Fixes** | prioritized recommendations, rendered fix markdown, copy button |
| **Inspect** | real-time single-URL deep inspection — TTFB, canonical, meta, schema, Core Web Vitals, AEO dial (no crawl required) |
| **Reports** | md / html / csv exports (pages, issues, links, recommendations) |
| **Settings** | domain cards + live config editor with JSON validation + CLI cheat sheet |

The header doubles as the **crawl runner** — enter a URL, press Crawl, and SSE progress
streams into a live progress bar until completion. A gear popover exposes crawl options
(budget, depth, concurrency, strategy, JS rendering), and a **Stop** button cancels a
running crawl via `POST /api/crawl/:id/stop`.

No dashboard dependencies beyond React/Router/Tailwind: tables, pagination, the SVG trend
chart, and the markdown renderer (`src/web/client/src/components/Markdown.tsx`) are
hand-rolled to keep the bundle small and the surface auditable.

## Dev workflow

```bash
npm run build:web    # vite build → dist/web
npm run build:engine # tsc       → dist
# or
npm run build        # both
```

For UI development, `vite`'s dev server proxies `/api` to the API on port 5173, so run
`seoforge serve` in one terminal and `npx vite` in another.
