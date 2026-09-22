# 01 — Crawl Engine

The core differentiator. SEOForge 1.x fetched configured paths; 2.0 is a real crawler.

## Requirements

- **BFS discovery** from a seed URL, following internal `href` links.
- **Crawl budget** (`--limit`), **max depth** (`--depth`), and **concurrency** (`--concurrency`).
- **robots.txt compliance** — parse allow/deny per user agent, honor `Crawl-delay`,
  discover `Sitemap:` directives. `--no-robots` escape hatch for authorized crawling.
- **Politeness** — global requests-per-second cap, per-host crawl-delay.
- **Sitemap parsing** — sitemap indexes (recursive), `<urlset>`, `lastmod`,
  `changefreq`, `priority`. Strategy-driven seeding.
- **Three strategies**: `discover` (BFS from root), `sitemap` (seed from sitemap URLs,
  optional random sampling), `config` (configured paths).
- **Optional render mode** — Playwright Chromium for SPAs, collecting Core Web Vitals
  (LCP / CLS / INP / FCP / resource count). Dynamic import so non-render users pay zero cost.
- **Redirect handling** — chains, loops, HTTP→HTTPS detection.
- **Live progress** — `EventEmitter` progress/page/issue events consumed by SSE.

## Implementation

| File | Role |
| --- | --- |
| `src/crawl/crawler.ts` | `Crawler` class — orchestrates the whole pass, emits events |
| `src/crawl/queue.ts` | De-duplicating priority queue with depth tracking |
| `src/crawl/fetcher.ts` | `fetch` with timeout, TTFB timing, redirect capture |
| `src/crawl/robots.ts` | robots.txt fetch + allow/deny + crawl-delay (`robots-parser`) |
| `src/crawl/sitemap-parser.ts` | Recursive XML sitemap / sitemap-index parsing |
| `src/crawl/renderer.ts` | Optional Playwright render + CWV collection |
| `src/crawl/link-extractor.ts` | `href`/`src` extraction, anchor text, images |

### Post-crawl passes

1. **Link verification** — uncrawled internal targets and all external targets are
   HEAD-checked (bounded pool) to resolve their status; results become `LinkRecord`s.
2. **Link graph** — incoming link counts, **orphan detection**, single-internal-link flags,
   and a simplified **PageRank-style internal link score** (20 iterations, d=0.85).
3. **Sitemap cross-reference** — *orphan in sitemap* (listed but never linked) and
   *not in sitemap* (indexable but absent).
4. **Broken-link attribution** — broken/redirecting links are attached to the source page.

## Design notes

- The crawl root (not every seeded URL) is exempt from orphan detection, so sitemap-seeded
  orphans are still reported correctly.
- Render mode falls back to raw fetch if Playwright is unavailable, preserving the render
  error in the page record rather than crashing the crawl.
- Non-HTML responses are stored as pages with empty HTML so links to PDFs/zip files still
  get verified instead of silently parsed as markup.

## Verification

- `tests/crawler.test.ts` — a fixture site with planted defects; asserts detection of
  broken links, missing title/H1, thin content, missing image alt, orphan pages, redirect
  chains, and sitemap seeding.
- Live smoke test against `https://example.com` exercises robots, fetch, checks, and
  persistence end to end.
