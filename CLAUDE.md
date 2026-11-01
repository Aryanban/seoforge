# CLAUDE.md — Claude Code & T3 Code Developer Guide

## Project Overview

**SEOForge** is a high-throughput, Screaming Frog + Ahrefs–grade technical crawler, search intelligence engine, and 35-tool native Model Context Protocol (MCP) server. 100% local, zero third-party API keys, zero cloud subscriptions, and zero data leakage.

- **Runtime**: Node.js $\ge$ 22 (uses native `node:sqlite`)
- **Language**: TypeScript 5.8 (Strict Mode)
- **Engine**: Asynchronous BFS raw HTTP pipelining + optional headless Playwright rendering
- **Test Framework**: Vitest (30 test files, 229 passing tests)
- **Web Dashboard**: Hono + React 19 + Tailwind CSS + Vite (SSE live updates)
- **MCP Server**: Stdio JSON-RPC 2.0 with 35 native tools

---

## Commands & Workflows

```bash
# Development & Testing
npm test                # Run all 229 tests via Vitest
npm run build           # Full build: tsc (dist/) + vite build (dist/web/)
npm run typecheck       # Strict TypeScript type check
npm run lint            # ESLint static analysis

# CLI Operations
npx tsx src/cli.ts crawl <url> [options]    # Run local BFS crawl
npx tsx src/cli.ts audit <url>              # Full audit with 60+ check types
npx tsx src/cli.ts inspect <url>            # Live single-page deep inspect
npx tsx src/cli.ts indexnow <url>           # Instant IndexNow protocol submission
npx tsx src/cli.ts serve                    # Launch web dashboard on http://localhost:3000
npx tsx src/cli.ts mcp                      # Start MCP stdio server
```

---

## Architecture & Code Map

```
src/
├── cli.ts                   # Unified CLI entry point
├── crawl/                   # BFS crawler, queue, fetcher, Playwright renderer, sitemaps
├── checks/                  # 10 audit modules (headings, meta, performance, security, etc.)
├── analysis/                # Advanced diagnostic engines:
│   ├── crawl-diff.ts        # Git-style crawl regression diffing
│   ├── cannibalization.ts   # Keyword cannibalization detection
│   ├── link-intersect.ts    # Backlink & domain overlap analysis
│   ├── content-gap.ts       # Competitor content gap matrices
│   ├── robots-simulator.ts  # RFC 9309 simulation & AI bot compliance
│   ├── redirect-tracer.ts   # Redirect chain tracer & loop detection
│   └── pagespeed-lab.ts     # Local lab Core Web Vitals profiling
├── ai/                      # Deterministic code patches & AEO snippet generators
├── mcp/mcp-server.ts        # 35-tool Model Context Protocol server
├── store/                   # Embedded SQLite persistence (node:sqlite)
└── web/                     # React dashboard client
```

---

## Development & Contribution Rules

1. **Deterministic Logic**: Never hallucinate SEO checks. Base all recommendations on Google Search Essentials, Bing Webmaster Guidelines, and W3C/IETF standards.
2. **Local-First & Zero Leakage**: All crawls, store queries, and audits must run on localhost. Never send user site data to third-party endpoints.
3. **Strict Type Safety**: All additions must pass `npm run typecheck` and `npm test` with zero errors.
