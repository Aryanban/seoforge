# 07 — Best-in-Class Roadmap

Goal: make SEOForge the strongest local-first technical SEO crawler. Each item lists
the current state (measured or read from code), the open-source project it builds on,
the change, and the metric that proves it.

Licence rule for reuse: copy code only from MIT / BSD / Apache-2.0 / ISC projects and
record it in `THIRD_PARTY_NOTICES.md`. GPL/AGPL code (e.g. some Python crawlers) may be
studied for the algorithm but not copied. MPL-2.0 (axe-core) is fine as an unmodified
dependency.

## Baseline (2026-11-15, `scripts/bench-crawl.ts`, local synthetic site, Apple Silicon, Node 25)

| Setting | Pages/s | Peak server req/s | Peak RSS |
| --- | --- | --- | --- |
| 1000 pages, 50 ms latency, concurrency 12, `maxRequestsPerSecond` 20 | 110 | **160** (limit not enforced) | 446 MB |
| same, concurrency 32, no rps cap | 123 | 160 | 435 MB |
| same, 0 ms latency | 127 | 167 | 474 MB |
| same, every 50th request answers 429 | 82 | 161 | 482 MB |

Findings:

1. **CPU-bound, not network-bound.** Throughput stays at ~120 pages/s whatever the
   concurrency or latency. A CPU profile of the 0 ms run (8.3 s total) shows:
   `content-analyzer.ts` 3.0 s (n-gram extraction alone 1.4 s), cheerio/parse5 parsing
   ~1.5 s, `duplicates.ts` 1.0 s, `a11y.ts` 0.85 s, GC 0.55 s.
2. **The rate limit is broken.** The sliding-window throttle in `crawler.ts` computes
   `minInterval - (now - oldest)`, which is almost always negative, so the 20 req/s cap
   allowed 160 req/s. Crawl-delay is slept per worker, so it is multiplied by concurrency.
3. **429s are handled per URL only.** Other workers keep hitting a host that is already
   rate-limiting; throughput drops 25 % with only 2 % 429s.
4. **Memory is ~0.45 MB per page.** All pages, extracted links, images and body text
   stay in memory until one transaction at the end. A 100k-page crawl would need tens of GB
   and a crash loses everything.

## Performance metrics and targets

| Metric | Now | Target | How |
| --- | --- | --- | --- |
| Pages/s, local, 0 ms latency | 127 | 400+ | P1 analyzer fixes, P2 worker threads |
| Rate-limit accuracy | 160 req/s at cap 20 | ±10 % of cap | P1 politeness scheduler |
| Throughput under 2 % 429s | 82 | ≥ 90 % of the polite rate, zero retry storms | P1 AIMD backoff |
| Peak RSS per 1k pages | 446 MB | < 100 MB, flat for 100k | P2 streaming store |
| Crash recovery | none | resume from last page | P2 persistent frontier |
| Render mode requests per page | 2, sequential | 2, parallel (raw kept for raw-vs-rendered diff) | P1 |
| Broken-link false positives (HEAD-hostile servers) | any 403/405 on HEAD is "broken" | GET re-check before flagging | P1 |

## Phase 1 — correctness and quick speed wins (this change)

| Area | Change | Builds on |
| --- | --- | --- |
| Politeness | Replace the sliding window with a slot scheduler: each request reserves `next = max(now, last + interval)`, where `interval = max(1000/rps, crawlDelay)`. Race-free across workers, enforces crawl-delay globally. | Heritrix / StormCrawler per-host politeness; RFC 9309 crawl-delay semantics |
| Backoff | AIMD on the shared rate: cut to 0.85× of the observed rate on 429/503 (respect `Retry-After`), add back slowly on success, never above the configured cap. | Scrapy AutoThrottle; TCP congestion control |
| CLI | `--max-rps <n>` (0 = unlimited, for your own sites). | — |
| Content analyzer | Tokenize once for 1/2/3-grams, no per-position `slice/join`; memoize syllable counts. Same output. | — |
| Duplicates | Shingle hashes from per-word hashes (no string building). | MinHash/shingling practice (datasketch) |
| Link checks | Retry HEAD failures (≥400 or network error) with GET, body discarded, before marking broken. | linkinator HEAD→GET fallback |
| Render mode | Run raw fetch and Playwright render in parallel. Fix the CWV script: TTFB from navigation timing (was always 0), CLS using session windows (was a lifetime sum), INP from `event` entries (the `interaction` entry type does not exist). | Google `web-vitals` metric definitions (Apache-2.0) |
| Benchmark | `scripts/bench-crawl.ts` for repeatable numbers. | — |

## Progress (2026-11-15)

Done, all measured with `scripts/bench-crawl.ts` (0 ms latency unless noted):

- Phase 1 complete. Throughput 127 → 293 pages/s inline (analyzer + shingle fixes).
- Worker pool (Piscina, default `min(4, cores-1)` threads, 384 MB heap each): 636 pages/s at 2k pages, 728 pages/s at 10k pages (1.46 GB peak RSS). Worker and inline output are identical on the fixture site.
- Politeness: `--max-rps 20` now gives 20 req/s (was 160). AIMD against a server limit: 27.7 pages/s with 12 × 429 (was 156 × 429).
- Duplicate detection already used MinHash + LSH (16 bands × 8 rows); removed from Phase 2.
- "Too many links": threshold moved from 100 links to Screaming Frog's 1,000 followed internal outlinks (was flagging 4,878 of 4,920 pages).
- New checks: JS rendering diff (raw vs rendered: noindex, canonical, title, H1, links, content), content-language mismatch (franc-min), invalid elements in `<head>` that end it early (htmlparser2), Google rich-result required properties per type, verified Googlebot/Bingbot by reverse+forward DNS (`verifyCrawlerHits`, not yet exposed in CLI/API).
- Dashboard: health score, clickable charts that filter Pages/Issues, sortable Pages table, CSV export, light/dark theme.

## Phase 2 — scale

| Area | Status | Result |
| --- | --- | --- |
| HTTP/2 | Done. `allowH2` on the undici agent, hop-by-hop `Connection` header removed. | Local TLS site, 2k pages, 50 ms latency: 13.8 s (h1) → 10.9 s (h2). |
| Per-host politeness | Done, where it applies. The BFS crawl is single-origin, so the gaps were in link verification: internal link checks now share the crawl's rate cap and crawl-delay (were unpaced: 20 req/s against a cap of 8), external checks run at most 2 in flight per host, and a 429 target is no longer reported as a broken link. | Tests in `tests/politeness.test.ts`. |
| Memory | Done (partial streaming). Pages no longer keep their body text; the worker computes duplicate hashes (fingerprint, shingles, MinHash) instead. | Retained page state at 2k pages: 60.5 MB → 24.7 MB (−59%). Peak RSS is unchanged (~1.2 GB at 2k, 1.5 GB at 10k): it is worker heaps and transient garbage. |
| Resume | Done. Heritrix-style checkpoint (`v8.serialize`, tmp + rename) every 30 s and on stop; `crawl --resume <id>`. Ctrl-C stops cleanly and keeps the checkpoint; SIGTERM/SIGHUP checkpoint and exit at once. | 10k pages: 147 MB checkpoint, 225 ms write, 342 ms read. Tests in `tests/resume.test.ts`. |
| Streaming store | Open. Writing pages to SQLite as they arrive and running the sitewide passes from the DB would bound memory for 100k+ page crawls. Large change; do it when a crawl that size is needed. | — |
| a11y speed | Open. Single DOM walk for all rules. | — |

## Phase 3 — accuracy and parity with Screaming Frog / Ahrefs / Sitebulb

| Area | Gap | Change | Builds on |
| --- | --- | --- | --- |
| JavaScript SEO | Raw HTML is fetched in render mode but never compared | Raw-vs-rendered diff: title, meta robots, canonical, H1, links, word count changed by JS | Screaming Frog "JavaScript" tab (behaviour) |
| Main-content extraction | Thin content and duplicates count nav/footer text | Use Readability to isolate main content for word count, duplicates and n-grams | `@mozilla/readability` (Apache-2.0) |
| Core Web Vitals | Lab-only, custom observer | Optional Lighthouse per page in render mode; site-wide scan with a worker pool | Lighthouse (Apache-2.0), Unlighthouse (MIT) |
| Accessibility | ~12 hand-written rules | Run axe-core inside the rendered page when `--render` is on | axe-core (MPL-2.0, as dependency) |
| HTML validity | none | Parse-error and invalid-head checks (elements that close `<head>` early break meta tags) | html-validate (MIT) |
| Structured data | Generic schema.org checks | Encode Google rich-result required/recommended properties per type as data; validate against them | Google Search Central docs; schema.org vocabulary |
| Language | `lang` attribute only | Detect content language and flag `lang` / hreflang mismatches | franc (MIT) |
| robots.txt | robots-parser | Add RFC 9309 conformance tests from Google's robotstxt test suite | google/robotstxt (Apache-2.0) tests |
| Sitemaps | Whole-document parse | Streaming parse for 50k-URL / gzip sitemaps, lastmod validation | `sitemap` npm (MIT) stream parser |
| Log files | Parser exists | Verify Googlebot/Bingbot by reverse + forward DNS before counting hits | Google's documented verification method |
| Keyword volume | GSC + Trends estimate | Keep, but show confidence band in every UI/MCP surface; never present as exact | — |
| Backlinks | Local link-intersect only | Optional import of the Common Crawl host-level web graph (open data, no key) | Common Crawl web graphs |

## Phase 4 — product surface

| Area | Change | Builds on |
| --- | --- | --- |
| Dashboard tables | Virtualized, sortable, filterable tables for 100k+ rows | TanStack Table + TanStack Virtual (MIT) |
| Exports | Streamed CSV/XLSX for every table, matching Screaming Frog export names | — |
| Scheduling | Recurring crawls with diff alerts (crawl-diff exists) | — |
| MCP | Fix tool-count drift in docs (code registers 39); add pagination to large results | — |

## Out of scope

- Scraping Google SERPs for rank tracking (against Google's terms).
- Expanding anti-bot evasion beyond the existing Agent Reach fallback.
