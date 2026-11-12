# CLAUDE.md — Claude Code & T3 Code Developer Guide

## Project Overview

**SEOForge** is a high-throughput, Screaming Frog + Ahrefs–grade technical crawler, search intelligence engine, and 38-tool native Model Context Protocol (MCP) server with Agent Reach anti-bot bypass and TimesFM zero-shot forecasting. 100% local, zero third-party API keys, zero cloud subscriptions, and zero data leakage.

- **Runtime**: Node.js $\ge$ 22 (uses native `node:sqlite`)
- **Language**: TypeScript 5.8 (Strict Mode)
- **Engine**: Asynchronous BFS raw HTTP pipelining + optional headless Playwright rendering + Agent Reach anti-bot engine + TimesFM time-series forecasting
- **Test Framework**: Vitest (32 test files, 244 passing tests)
- **Web Dashboard**: Hono + React 19 + Tailwind CSS + Vite (SSE live updates)
- **MCP Server**: Stdio JSON-RPC 2.0 with 38 native tools

---

## Commands & Workflows

```bash
# Development & Testing
npm test                # Run all 236 tests via Vitest
npm run build           # Full build: tsc (dist/) + vite build (dist/web/)
npm run typecheck       # Strict TypeScript type check
npm run lint            # ESLint static analysis

# CLI Operations
npx tsx src/cli.ts crawl <url> [options]    # Run local BFS crawl (--render, --reach)
npx tsx src/cli.ts forecast <url>           # TimesFM zero-shot forecasting (--metric, --horizon)
npx tsx src/cli.ts audit <url>              # Full audit with 60+ check types
npx tsx src/cli.ts inspect <url>            # Live single-page deep inspect (--reach)
npx tsx src/cli.ts reach <url>              # Scrape & read any URL via Agent Reach
npx tsx src/cli.ts reach:doctor             # Check Agent Reach channels & dependencies
npx tsx src/cli.ts indexnow <url>           # Instant IndexNow protocol submission
npx tsx src/cli.ts serve                    # Launch web dashboard on http://localhost:3000
npx tsx src/cli.ts mcp                      # Start MCP stdio server
```

---

## Architecture & Code Map

```
src/
├── cli.ts                   # Unified CLI entry point
├── crawl/                   # BFS crawler, queue, fetcher, agent-reach, Playwright renderer, sitemaps
├── checks/                  # 10 audit modules (headings, meta, performance, security, etc.)
├── forecasting/             # Google Research TimesFM zero-shot time series engine
├── analysis/                # Advanced diagnostic engines:
│   ├── crawl-diff.ts        # Git-style crawl regression diffing
│   ├── cannibalization.ts   # Keyword cannibalization detection
│   ├── link-intersect.ts    # Backlink & domain overlap analysis
│   ├── content-gap.ts       # Competitor content gap matrices
│   ├── robots-simulator.ts  # RFC 9309 simulation & AI bot compliance
│   ├── redirect-tracer.ts   # Redirect chain tracer & loop detection
│   └── pagespeed-lab.ts     # Local lab Core Web Vitals profiling
├── ai/                      # Deterministic code patches & AEO snippet generators
├── mcp/mcp-server.ts        # 37-tool Model Context Protocol server
├── store/                   # Embedded SQLite persistence (node:sqlite)
└── web/                     # React dashboard client
```

---

## Development & Contribution Rules

0. **Ponytail Operational Standard (Always-On In Every Prompt)**:
   - *The best code is the code you never wrote.* Always take the smallest complete change that fully works.
   - Solve with minimal new code: skip unrequested features/options, reuse existing codebase utilities, prefer standard library/platform features, use installed dependencies, prefer 1-line solutions over new helper files.
   - Never cut: trust boundary validation, data-loss error handling, security, accessibility, tests for non-trivial logic.
   - Always close responses with 1–2 lines stating what was skipped/omitted and any known risk.
1. **Deterministic Logic**: Never hallucinate SEO checks. Base all recommendations on Google Search Essentials, Bing Webmaster Guidelines, and W3C/IETF standards.
2. **Local-First & Zero Leakage**: All crawls, store queries, and audits must run on localhost. Never send user site data to third-party endpoints.
3. **Strict Type Safety**: All additions must pass `npm run typecheck` and `npm test` with zero errors.
