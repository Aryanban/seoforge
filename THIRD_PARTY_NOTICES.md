# Third-Party Notices

SEOForge incorporates material ported from the following open-source project.

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
