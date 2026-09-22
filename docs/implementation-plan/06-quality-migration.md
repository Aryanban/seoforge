# 06 — Quality, Tooling & Migration

How the 2.0 rewrite is verified, and how 1.x users get across the line without losing data.

## Verification gates

Every gate must pass before a change is considered done. CI (`.github/workflows/ci.yml`)
runs all of them on every push and pull request.

| Gate | Command | What it catches |
| --- | --- | --- |
| Engine types | `npm run typecheck` | Type errors across `src` (excluding the web client) |
| Web types | `npm run typecheck:web` | Type errors in the React dashboard |
| Unit tests | `npm test` | 34 vitest tests: checks, schema engine, AEO engine, crawler, store, config |
| Lint | `npm run lint` | `typescript-eslint` flat config — dead imports, unused vars |
| Build | `npm run build` | `tsc` → `dist` + `vite build` → `dist/web` |

```bash
npm run typecheck && npm run typecheck:web && npm test && npm run lint && npm run build
```

## Test suite

| File | Tests | Coverage |
| --- | --- | --- |
| `tests/checks.test.ts` | 20 | Every check module, the schema engine, the AEO engine, issue summary + recommendation generation |
| `tests/store.test.ts` | 6 | SQLite repository: insert, filtered reads, full-result reconstruction, trend queries |
| `tests/config.test.ts` | 5 | zod schema validation for `seoforge.config.json` |
| `tests/crawler.test.ts` | 3 | End-to-end crawl over `tests/fixtures/site.ts` — a fixture site with planted defects |

The fixture site (`tests/fixtures/site.ts`) is a synthetic HTTP server that deliberately
contains broken links, a redirect chain, a redirect loop, missing title/H1, thin content,
images without `alt`, orphan pages, and a sitemap with orphans — so the crawler and check
engine are asserted against *real* defects rather than mocks.

### Manual smoke test

After a build, verify the whole stack end to end against a live or fixture site:

```bash
# 1. CLI crawl → issues → persistence → report
npx tsx src/cli.ts crawl https://example.com --limit 10 --depth 2

# 2. API + dashboard boot
npx tsx src/cli.ts serve --port 5199 &
curl -s http://127.0.0.1:5199/api/health          # → {"status":"ok",...}
curl -s -X POST http://127.0.0.1:5199/api/crawl \
     -H 'Content-Type: application/json' \
     -d '{"url":"https://example.com"}'           # → {"crawlId":"crawl_...",...}
curl -s http://127.0.0.1:5199/api/crawls          # → completed crawl is persisted
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5199/   # → 200
```

## Tooling

- **Node ≥ 22** — required for the native `node:sqlite` module (no `better-sqlite3`
  build step). Enforced via `engines.node` and in both workflows.
- **ESLint 9 flat config** (`eslint.config.mjs`) with `typescript-eslint`. Lint is
  deliberately permissive about `any` (the store row boundary and dashboard API payloads
  are loosely typed) but strict about dead imports and unused variables.
- **Prettier** is available for formatting; it is not wired into a gate.
- **Vitest** with a 30s timeout — generous because the crawler test starts a real server.
- **tsconfig split** — `tsconfig.json` builds the engine and excludes `src/web`;
  `web.tsconfig.json` typechecks the dashboard only. Both must pass.

## Backwards compatibility with 1.x

The 1.x command surface is preserved so existing automation keeps working:

| 1.x command | 2.0 status |
| --- | --- |
| `seoforge audit` | Kept — v1 multi-domain audit, now backed by the new check engine |
| `seoforge inspect` | Kept — single-page deep inspection |
| `seoforge indexnow` | Kept |
| `seoforge daily` | Kept — same routine, richer report |
| `seoforge report` | Kept |
| `seoforge mcp` | Kept — now served by `src/mcp/mcp-server.ts` (15 tools); the v1 tool names still resolve |

New in 2.0: `crawl`, `serve`, `export`.

### Data migration

- **Legacy snapshots** — `reports/.snapshots/*.json` (the 1.x on-disk format) are imported
  into the SQLite store on first run via `migrateLegacySnapshots`, so historical change
  deltas (`+N new since last crawl`) survive the upgrade.
- **Config** — `seoforge.config.json` uses the same domain-list shape; 2.0 adds optional
  fields under a zod schema, and unknown keys are rejected in tests rather than silently
  ignored.
- **No destructive writes** — 2.0 never deletes the old snapshots; it only reads them.

## Known limitations

- **Render mode needs Playwright** — `--render` requires the optional `playwright`
  dependency and a Chromium download. Without it the crawl silently falls back to raw
  fetch and records the failure on the page record. Core Web Vitals issues are only
  produced in render mode.
- **Local-first** — the API binds to `127.0.0.1` by design. There is no auth; exposing it
  on a public interface is unsupported.
- **No keyword or backlink database** — by the locked scope decision, SEOForge is a
  technical-audit tool. It does not track rankings, search volume, or inbound links.
- **AEO score is heuristic** — the answer-engine score encodes best practices (inverted
  pyramid, direct-answer paragraph, schema coverage, FAQ presence), not an actual
  measurement of answer-engine visibility.
- **Rate limits are polite, not invisible** — crawls respect robots and a global RPS cap,
  but very large sites still take time; use `--limit` and async mode (`serve` /
  MCP `async_mode`) for them.

## Release checklist

1. All gates green locally and in CI.
2. `npm run build` produces both `dist/` and `dist/web/`.
3. Smoke test passes against a live site (crawl + serve + health).
4. `reports/` artifacts and the SQLite DB are gitignored — the repo ships no crawl data.
5. Version bumped in `package.json` and the CLI banner.
