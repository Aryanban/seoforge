# SEOForge

The open-source full-site SEO crawler, internal link graph engine, and 35-tool Model Context Protocol (MCP) server for autonomous AI agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript 5.8](https://img.shields.io/badge/TypeScript-5.8_Strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests Passing](https://img.shields.io/badge/Tests-229%2F229_Passing-10b981?style=flat-square&logo=vitest&logoColor=white)](https://github.com/Aryanban/seoforge)
[![MCP Server](https://img.shields.io/badge/MCP_Server-35_Native_Tools-purple?style=flat-square)](https://modelcontextprotocol.io)
[![Protocol: IndexNow](https://img.shields.io/badge/Protocol-IndexNow-008080?style=flat-square)](https://www.indexnow.org)

---

## Overview

SEOForge is a local-first, zero-subscription alternative to Screaming Frog (£209/yr) and Ahrefs ($129/mo). It combines an asynchronous BFS web crawler, an internal PageRank link graph, and a 35-tool MCP server that enables AI coding agents (Claude Code, Google Antigravity, Cursor, OpenAI Codex) to autonomously audit, optimize, and patch codebases for search engines and answer engines (Google AI Overviews, Perplexity).

---

## Quickstart

### 1. Run with npx (Zero Installation)

```bash
# Run a quick crawl directly
npx seoforge crawl https://example.com --max-pages 25

# Launch the interactive local Web Studio
npx seoforge studio --port 3000

# Start the native MCP server for AI coding agents
npx seoforge mcp
```

### 2. Install from Source

```bash
git clone https://github.com/Aryanban/seoforge.git
cd seoforge
npm install
npm run build
```

---

## Usage Modes

### 1. Command Line Interface (CLI)

```bash
# High-throughput asynchronous crawl (HTTP pipelining)
seoforge crawl https://example.com --max-pages 100 --concurrency 10

# Headless Playwright SPA crawl (Core Web Vitals: LCP, CLS, INP)
seoforge crawl https://example.com --render --max-pages 20

# Identify orphan pages and compute internal PageRank
seoforge link-report --db ./seoforge.sqlite

# Find unlinked keyword opportunities across crawled copy
seoforge link-opportunities --target-url https://example.com/pricing --keyword "pricing plans"

# Instantly submit modified URLs to Bing and Yandex via IndexNow
seoforge submit-indexnow --host example.com --key YOUR_INDEXNOW_KEY --urls https://example.com/blog/new-post
```

### 2. Autonomous AI Agents (Claude Code, Antigravity, Cursor)

SEOForge provides 35 native tools over standard I/O (stdio) via the Model Context Protocol (MCP). Agents can autonomously execute site crawls, identify broken links, detect anchor text cannibalization, and patch source code without manual intervention.

#### Configuration Snippet

Add SEOForge to your MCP configuration (`claude_desktop_config.json`, `.cursor/mcp.json`, or `~/.gemini/antigravity/mcp_config.json`):

```json
{
  "mcpServers": {
    "seoforge": {
      "command": "npx",
      "args": ["-y", "seoforge", "mcp"]
    }
  }
}
```

#### Core MCP Tools Available:
- `seoforge_crawl`: Executes full BFS crawl with customizable depth and concurrency.
- `seoforge_get_issues`: Returns prioritized critical errors, warnings, and notices.
- `seoforge_link_opportunities`: Scans HTML body text to uncover unlinked high-intent keywords.
- `seoforge_anchor_profile`: Analyzes anchor text ratios to flag Google Penguin over-optimization risks.
- `seoforge_patch_codebase`: Automatically injects Schema.org JSON-LD and `/llms.txt` into local projects.
- `seoforge_submit_indexnow`: Notifies search engines of page modifications in real time.

For full agent documentation and tool parameter schemas, refer to [AGENTS.md](AGENTS.md).

---

## Competitive Comparison

| Feature | SEOForge | Screaming Frog | Ahrefs / Semrush | Sitebulb |
| :--- | :---: | :---: | :---: | :---: |
| **Annual Price** | **$0 (MIT Open Source)** | £209 / yr | $1,548 – $2,388 / yr | $162 – $420 / yr |
| **Crawl Limits** | **Unlimited (Local SQLite)** | 500 (Free tier) | Credit-gated | License tier limited |
| **Native MCP Server** | **35 Native Tools** | No | No | No |
| **AI Agent Support** | **Claude, Antigravity, Cursor, Codex** | No | No | No |
| **AEO Scorer (AI Overviews)** | **Built-in** | No | No | No |
| **Instant IndexNow Dispatch** | **Built-in** | Plugin required | No | No |
| **Data Privacy** | **100% Localhost** | Local (Proprietary) | Cloud hosted | Local (Proprietary) |
| **AST Codebase Patcher** | **Built-in** | No | No | No |

---

## Key Features

- **Asynchronous BFS Crawl Engine**: Streams raw HTTP responses into a tokenizing parser to crawl 10,000+ pages without memory exhaustion.
- **Internal PageRank & Link Graph**: Maps full domain topology, isolates orphan pages, and flags broken redirect chains.
- **Anchor Text Risk Profiler**: Classifies anchors into Brand, Exact Match, Partial Match, and Naked URL groups to avoid Google Penguin penalties.
- **Keyword Intelligence & Search Intent**: Classifies queries into Informational, Commercial, Transactional, and Navigational intents with algorithmic difficulty scores (KD 0–100).
- **Readability & Content Gap Matrix**: Evaluates Flesch Reading Ease and n-gram densities, comparing competitor crawls side-by-side to expose content gaps.
- **Answer Engine Optimization (AEO)**: Audits 40–60 word definition blocks, validates Schema.org JSON-LD graphs, and lints `/llms.txt` directories.

---

## Testing

```bash
npm test
# or with coverage
npm run test:coverage
```

All 229 automated unit and integration tests execute across Vitest with 100% pass rate.

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.

Copyright (c) 2026 Aryan Bansal.
