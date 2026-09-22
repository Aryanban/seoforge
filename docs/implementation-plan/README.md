# SEOForge 2.0 — Implementation Plan

**Goal:** make SEOForge the best local SEO tool in the industry — a Screaming Frog–grade
full-site crawler with an Ahrefs-grade issue engine, AEO scoring, deterministic AI fix
documentation, a minimalistic web dashboard, and an agent-callable API.

**Scope locked with the project owner:**

| Decision | Choice |
| --- | --- |
| Competitive scope | Screaming Frog–killer + AEO. No cloud-scale keyword/backlink database. |
| AI recommendations | Deterministic template engine — fully offline, zero cost. |
| UI | Local web dashboard (React + Tailwind, served on loopback). |
| JS rendering | Optional Playwright render mode (raw fetch by default). |
| Repo layout | Single package with `src/` subfolders + this plan folder. |

---

## What changed from 1.x

SEOForge 1.x was **not a crawler** — it fetched pre-configured paths plus N random sitemap
URLs. 2.0 replaces that with a real BFS crawl engine and layers a full audit, AI
recommendation, persistence, API, dashboard, and expanded agent stack on top.

| 1.x | 2.0 |
| --- | --- |
| Configured paths + random sitemap samples | Full-site BFS: queue, depth, concurrency, crawl budget, robots compliance |
| Raw fetch only | Raw fetch **+ optional Playwright render mode** with Core Web Vitals |
| ~12 inline checks | 10 check modules, 60+ issue types, grouped Ahrefs-style |
| Static recommendation strings | Deterministic AI fix docs (why-it-matters / steps / before-after) |
| Flat JSON snapshots | SQLite (`node:sqlite`) with trend queries and full-text filters |
| CLI only | CLI + REST API + SSE live progress + web dashboard |
| 7 MCP tools | 14 MCP tools incl. async crawl, AI markdown, link/sitemap reports |

---

## Architecture

```
src/
├── crawl/          # Full-site BFS crawler (queue, robots, sitemap, render, fetcher)
├── checks/         # Audit check registry + 10 check modules + issue summary
├── ai/             # Deterministic recommendations, fix docs, AEO snippet generator
├── store/          # SQLite persistence (node:sqlite) + legacy snapshot migration
├── api/            # REST API + SSE (hono) — serves the built dashboard
├── web/client/     # React + Tailwind dashboard (built by Vite into dist/web)
├── mcp/            # Model Context Protocol server (14 agent tools)
├── report/         # Terminal, markdown, CSV, and HTML report writers
├── audit-page.ts   # Single-page deep inspection
├── config.ts       # zod-validated configuration loader
├── index.ts        # Public SDK surface
└── cli.ts          # seoforge CLI (crawl / inspect / serve / export / audit / mcp / daily)
```

Data flow:

```
URL → Crawler (BFS + robots) → fetcher|renderer → checks → issues
                                   ↓                ↓
                             link-graph pass   AI recommendation engine
                                   ↓                ↓
                              SQLite store ← markdown / CSV / HTML / terminal
                                   ↓
                        REST API + SSE → web dashboard
                                   ↓
                              MCP server → AI agents
```

---

## Specs

1. [`01-crawl-engine.md`](./01-crawl-engine.md) — BFS crawling, robots, sitemaps, rendering
2. [`02-audit-checks.md`](./02-audit-checks.md) — the full check-parity matrix
3. [`03-ai-recommendations.md`](./03-ai-recommendations.md) — deterministic fix-doc engine
4. [`04-web-dashboard.md`](./04-web-dashboard.md) — persistence, REST API, and UI
5. [`05-mcp-agent-api.md`](./05-mcp-agent-api.md) — the agent tool surface
6. [`06-quality-migration.md`](./06-quality-migration.md) — tests, tooling, backwards compatibility

---

## Commands

```bash
npm run build          # engine (tsc) + dashboard (vite)
npm run typecheck      # engine types
npm run typecheck:web  # dashboard types
npm test               # vitest suite (34 tests)
npm run lint           # eslint

npx tsx src/cli.ts crawl https://example.com --limit 200 --depth 5
npx tsx src/cli.ts crawl https://example.com --render          # SPA support
npx tsx src/cli.ts inspect https://example.com/some-page
npx tsx src/cli.ts serve                                       # dashboard on 127.0.0.1:5173
npx tsx src/cli.ts export html                                 # shareable report
npx tsx src/cli.ts mcp                                         # agent interface on stdio
```

## Status

All layers implemented, building, and tested. See [`06-quality-migration.md`](./06-quality-migration.md)
for the verification checklist and known limitations.
