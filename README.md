# SEOForge ⚡ • Autonomous SEO & AEO Autopilot & MCP Server

<p align="left">
  <a href="https://github.com/Aryanban/seoforge/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License MIT" /></a>
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Protocol-IndexNow-008080?style=for-the-badge" alt="IndexNow Protocol" />
  <img src="https://img.shields.io/badge/MCP%20Server-Standard-purple?style=for-the-badge" alt="Model Context Protocol" />
  <img src="https://img.shields.io/badge/Optimization-AEO%20%26%20Schema.org-8B5CF6?style=for-the-badge" alt="AEO & Schema.org" />
</p>

An open-source, autonomous **Search Engine Optimization (SEO)** and **Answer Engine Optimization (AEO)** engine and **Model Context Protocol (MCP)** server. Designed for modern web properties to audit technical compliance, enforce Google Search Essentials and Bing Webmaster Guidelines, validate Schema.org entity graphs, check `/llms.txt` files for AI crawlers, and dispatch real-time index pings via the **IndexNow protocol**.

---

## 🌟 Why AEO (Answer Engine Optimization)?

Traditional search engines index keywords; **AI answer engines** (Google AI Overviews, Perplexity AI, ChatGPT Search, Claude) extract **fact triplets** and direct answers:
`[Entity] -> [Predicate] -> [Object]`

SEOForge evaluates your pages against:
- **The Inverted Pyramid**: Detects whether concise (40–55 word) declarative answers follow `<h1>` and `<h2>` headings.
- **Schema.org Knowledge Graph Validation**: Validates `@graph` structures (`Person`, `Organization`, `WebSite`, `SoftwareApplication`, `Dataset`, `FAQPage`).
- **Canonical & Crawl Consistency**: Validates `<link rel="canonical">`, single-page app (SPA) origins, `robots.txt`, and XML sitemaps.
- **Dynamic Route Sampling**: Randomly audits $N$ deep URLs directly from large sitemaps (e.g. municipal parcels and village routes).
- **AI Crawler Standards (`/llms.txt`)**: Validates accessibility and formatting of `/llms.txt` and `/llms-full.txt`.
- **Instant IndexNow Dispatch**: Notifies Bing and Yandex immediately when URLs are published or modified.

---

## 🔌 Model Context Protocol (MCP) Server

SEOForge includes a native **Model Context Protocol (MCP)** server that connects directly to **Antigravity**, **Claude Desktop**, **Cursor**, **Zed**, and any agentic IDE over `stdio`.

### MCP Tools Provided:
1. `seoforge_audit`: Run complete multi-domain technical audit across configured web properties.
2. `seoforge_inspect_url`: Deep-dive inspect any single URL for TTFB latency, canonical match, meta tags, schema validation, AEO score, and actionable issues.
3. `seoforge_submit_indexnow`: Dispatch URLs directly to Bing & Yandex IndexNow API for instant indexing.
4. `seoforge_sample_sitemap`: Randomly sample $N$ dynamic survey or village URLs from an XML sitemap.
5. `seoforge_check_llms_txt`: Validate presence and formatting of `/llms.txt` and `/llms-full.txt`.
6. `seoforge_generate_aeo_snippet`: Auto-generate 40–55 word declarative definition paragraphs, comparison tables, and FAQPage JSON-LD.
7. `seoforge_daily_run`: Run full daily maintenance cycle (audit + report + IndexNow).

### Start the MCP Server:
```bash
seoforge mcp
# or with tsx:
npx tsx src/cli.ts mcp
```

### Connect to Claude Desktop or Antigravity (`mcp_config.json`):
```json
{
  "mcpServers": {
    "seoforge": {
      "command": "node",
      "args": ["/absolute/path/to/seoforge/dist/cli.js", "mcp"],
      "cwd": "/absolute/path/to/seoforge"
    }
  }
}
```

---

## 🛠️ CLI Commands

### 1. Real-Time Single URL Inspection
```bash
node dist/cli.js inspect https://dholeramap.com
# with SPA canonical tolerance:
node dist/cli.js inspect https://www.webforge.me/projects -p spa
```

### 2. Multi-Domain Audit with Dynamic Sitemap Sampling
Crawls all configured domains, validates HTTP status, checks canonicals, verifies Schema.org microdata, and samples $N$ random sitemap URLs:
```bash
node dist/cli.js audit --sample 5
```

### 3. Dispatch URLs to IndexNow
Submits changed or new URLs directly to Bing and Yandex search crawlers:
```bash
node dist/cli.js indexnow --urls https://dholeramap.com,https://www.webforge.me
```

### 4. Complete Daily Maintenance Routine
Audits all domains with sitemap sampling, saves the report, and submits updated paths to IndexNow:
```bash
node dist/cli.js daily --sample 3
```

---

## ☁️ Autonomous 24/7 Cloud Automation

SEOForge includes a pre-configured **GitHub Actions workflow** (`.github/workflows/daily-seo.yml`) that runs daily at **00:00 UTC**.

- Automatically audits your live web properties.
- Dispatches sitemap URLs to the IndexNow network.
- Archives daily markdown audit reports in GitHub Artifacts.

---

## 📄 License

Distributed under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Engineered with precision by <b>Aryan Bansal</b> • <a href="https://www.webforge.me/">webforge.me</a></sub>
</p>
