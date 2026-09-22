# 02 — Audit Checks

The check-parity matrix against Screaming Frog and Ahrefs Site Audit.

## Model

Every issue is a structured `AuditIssue`:

```ts
{ id, name, severity: "Error"|"Warning"|"Notice", category, message, url, details }
```

Categories: `Indexability · Meta · Headings · Content · Links · Images · Sitemap ·
Robots · Performance · StructuredData · AEO · Technical`.

Issues are grouped per crawl into an `IssueSummary` with affected-page counts,
cross-crawl change deltas, and a recommendation.

## Registry

`src/checks/registry.ts` extracts page metadata **once** (`PageMeta`: title, description,
canonical, headings, word count, hreflang, Open Graph, Twitter, schema, AEO, indexability)
and passes a shared `PageCheckContext` to every check module. A failing check cannot break
the crawl — errors are captured and surfaced as a single `check_error` notice.

## Check matrix

| Module (`src/checks/`) | Checks |
| --- | --- |
| `status-indexability.ts` | 4XX broken, 5XX server error, unreachable, 3XX redirect, long redirect chain, **redirect loop**, HTTP→HTTPS, insecure HTTP, `noindex` meta, `X-Robots-Tag` |
| `meta.ts` | title missing/long/short, description missing/long/short, canonical missing/mismatch, OG incomplete, Twitter card incomplete, hreflang missing/invalid |
| `headings.ts` | H1 missing (incl. **noscript-only detection**), multiple H1, H1 too long, no H2, heading hierarchy skips |
| `content.ts` | thin content / low word count (configurable threshold) |
| `links.ts` | generic anchor text, empty anchor text, internal `nofollow` leakage, >100 links per page |
| `images.ts` | missing alt, missing width/height (CLS), alt too long, legacy formats, image-link without anchor |
| `performance.ts` | slow TTFB (>800ms), high latency vs threshold, poor LCP/CLS/INP (render mode) |
| `technical.ts` | mixed content, missing security headers, no compression |
| `schema.ts` | no structured data, schema.org errors, Google Rich Results errors, malformed JSON-LD, missing expected entities |
| `aeo.ts` | low AEO score, missing direct-answer paragraph |

**Link-graph pass** (in the crawler, after verification): broken internal/external links,
redirecting links, orphan pages, single-incoming-link, orphan-in-sitemap, not-in-sitemap.

## Schema coverage

`src/checks/schema-engine.ts` validates 12+ entity types against both schema.org property
correctness and Google Rich Results requirements:

`SoftwareApplication`, `WebApplication`, `Person`, `WebSite`, `Organization`, `FAQPage`,
`Article`/`NewsArticle`/`BlogPosting`, `Product`, `Offer`, `Event`, `LocalBusiness`,
`BreadcrumbList`, `HowTo`, `Review`, `Rating`, `VideoObject`, `Dataset`.

Handles `@graph` arrays, multi-typed nodes, and distinguishes Google-level from
schema.org-level failures.

## Severity policy

Errors block indexing or access (4XX/5XX, loops, orphans, mixed content).
Warnings weaken rankings (missing meta, redirects, slow responses).
Notices are polish items (schema completeness, AEO, headers).

## Verification

`tests/checks.test.ts` — 20 unit tests over the check modules, schema engine, AEO engine,
and summary/recommendation generation.
