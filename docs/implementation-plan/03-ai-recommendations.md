# 03 — AI Recommendations (Deterministic)

The "AI markdown for all the issues" requirement, satisfied **without any LLM, API key, or
network call** — the project owner chose a fully offline deterministic engine.

## Structure

`src/ai/recommendations.ts` converts each grouped issue into a `RecommendationDoc`:

```ts
{ priority: Critical|High|Medium|Low, effort: S|M|L,
  recommendation, markdown /* full fix doc */ }
```

`src/ai/fix-docs.ts` renders the markdown for each issue from a **fix library** entry:

```markdown
> Why it matters
<impact — what this costs in rankings/crawl budget/AEO>

> How to fix
1. <step>
2. <step>

> Before / after
```diff
- <broken>
+ <fixed>
```

> Affected URLs (20 shown)
- https://…

📈 +3 new since last crawl
```

## Fix library

`FIX_LIBRARY` in `src/ai/recommendations.ts` maps issue IDs to `{ impact, steps,
beforeAfter, effort }`. Every entry is templated from the real affected URLs and page data
of the current crawl, so no two reports are identical.

Coverage: all 60+ issue IDs — broken links, redirects, orphans, meta, headings, content,
links, images, performance, Core Web Vitals, mixed content, schema, AEO, sitemaps, robots.

## Priority model

```
Error     → affectedPages >= 10 ? Critical : High
Warning   → affectedPages >= 10 ? High     : Medium
Notice    → Low
```

Sorted by priority, then affected pages.

## Outputs

- **Dashboard** → "AI Fixes" view: expandable, priority-filtered, copy-as-markdown.
- **CLI** → `seoforge export backlog` writes `reports/ai-fix-backlog-<date>.md`.
- **Crawl report** → top 15 recommendations embedded in `reports/crawl-<date>.md`.
- **MCP** → `seoforge_get_recommendations` returns the full backlog markdown so an agent
  can write fix tickets or pull requests directly.

## AEO snippet generator

`src/ai/snippets.ts` (migrated from the 1.x MCP server) produces a 40–55 word
inverted-pyramid answer paragraph, a comparison table, and `FAQPage` JSON-LD — the
prescriptive counterpart to the AEO checker.

## Why deterministic

No key, no latency, no cost, no hallucination, no privacy exposure of crawled URLs to a
third party. Every output is reproducible from the same crawl. If an LLM-backed mode is
later desired, `fix-docs.ts` is the single swap point.
