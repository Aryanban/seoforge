# Third-Party Notices

SEOForge incorporates architectural paradigms, ported modules, and reference implementations
from the following open-source projects.

## Google Research TimesFM — https://github.com/google-research/timesfm

Copyright (c) Google LLC. Licensed under the Apache License 2.0.

SEOForge incorporates time-series forecasting, trend projection, and confidence-band anomaly
detection inspired by and adapted from Google Research's **TimesFM** (Time Series Foundation Model):

| SEOForge module | Ported from / Inspired by |
| --- | --- |
| `src/forecasting/` | Google Research TimesFM (`google-research/timesfm`): patch-based sequential tokenization, patch normalization, zero-shot multi-horizon autoregressive forecasting, probabilistic quantile predictions (P10/P50/P90), frequency-aware harmonic decomposition (daily/weekly/monthly/crawl-based), and robust MAD confidence-band anomaly detection for crawl health, AEO scores, organic traffic, and Core Web Vitals. |

**Zero-Dependency Implementation:** Rewritten in native TypeScript to run deterministically and
ultra-fast (<10ms) without heavy Python or PyTorch dependencies, preserving TimesFM's patching
tokenization, frequency-conditioning, and probabilistic quantile semantics.

## BeyondSEO — https://github.com/beyondtahir/beyondseo

Copyright (c) Muhammad Tahir Ashraf (Beyond Tahir). Licensed under the MIT License.

The following SEOForge modules are ports of BeyondSEO's logic and data, rewritten
in TypeScript to fit SEOForge's deterministic, zero-external-call architecture:

| SEOForge module | Ported from |
| --- | --- |
| `src/publishing/` | `playbooks/backlink-system/posting-sites.json` (206-entry catalog), `scripts/backlink_sources.py` (`load_sources`, `validate_profile`, `build_plan`, `writing_outline`, `publication_role`, markdown/CSV rendering) |
| `src/reputation/` | `src/beyondseo/reputation.py` (reputation **model 1.1**: `source_score`, `assess`), `src/beyondseo/backlinks.py` (`check_sources`, `verify_source`, `target_links`, `mention_evidence`, `publisher_key`) |
| `src/competitors/` | Inspired by the `playbooks/competitor-research/` playbooks (competitor matrix, content-gap and authority-gap analysis), reimplemented natively on SEOForge crawl evidence |

**Verification:** the publishing plan builder and the model-1.1 reputation scorer
were diffed against the original Python implementation on shared fixtures and
produce identical selections, orderings, scores, ranges and coverage figures.

Ported data and logic retain the original conservative semantics: catalog DR
values are unverified provenance and never rank a shortlist; unknown reputation
dimensions earn no supported points; low-confidence headlines cap at 49/100.

## Apify Crawlee & p-queue — Background Process & Queue Architecture

- **Apify Crawlee** (https://github.com/apify/crawlee, Apache 2.0):
  Architectural reference for `CrawlQueue.requeue()` exponential backoff with full jitter on transient rate limits (HTTP 429/503/network resets), respecting `Retry-After` headers and preventing crawler IP bans.
- **p-queue** (https://github.com/sindresorhus/p-queue, MIT):
  Architectural reference for `waitForItem()` microtask slot resolution, replacing 25ms timer spin-polling with instant microtask wakeup.
- **Litestream & SQLite** (https://github.com/benbjohnson/litestream, Apache 2.0):
  Architectural reference for passive WAL checkpointing (`checkpointStore`), flushing write-ahead logs in background without blocking active read queries or crawl insertions.
