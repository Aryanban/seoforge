# SEOForge ⚡ • Autonomous SEO & AEO Autopilot

<p align="left">
  <a href="https://github.com/Aryanban/seoforge/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License MIT" /></a>
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Protocol-IndexNow-008080?style=for-the-badge" alt="IndexNow Protocol" />
  <img src="https://img.shields.io/badge/Optimization-AEO%20%26%20Schema.org-8B5CF6?style=for-the-badge" alt="AEO & Schema.org" />
</p>

An open-source, autonomous **Search Engine Optimization (SEO)** and **Answer Engine Optimization (AEO)** engine. Designed for modern web properties to audit technical compliance, enforce Google Search Essentials and Bing Webmaster Guidelines, validate Schema.org entity graphs, and dispatch real-time index pings via the **IndexNow protocol**.

---

## 🌟 Why AEO (Answer Engine Optimization)?

Traditional search engines index keywords; **AI answer engines** (Google AI Overviews, Perplexity AI, ChatGPT Search, Claude) extract **fact triplets** and direct answers:
`[Entity] -> [Predicate] -> [Object]`

SEOForge evaluates your pages against:
- **The Inverted Pyramid**: Detects whether concise (35–65 word) declarative answers follow `<h1>` and `<h2>` headings.
- **Schema.org Knowledge Graph Validation**: Validates `@graph` structures (`Person`, `Organization`, `WebSite`, `SoftwareApplication`, `FAQPage`).
- **Canonical & Crawl Consistency**: Validates `<link rel="canonical">`, `robots.txt`, and XML sitemaps.
- **Instant IndexNow Dispatch**: Notifies Bing and Yandex immediately when URLs are published or modified.

---

## 🚀 Quick Start

### 1. Installation

Clone the repository:
```bash
git clone https://github.com/Aryanban/seoforge.git
cd seoforge
npm install
```

### 2. Configure Your Domains

Edit `seoforge.config.json`:
```json
{
  "project": "My Digital Ecosystem",
  "indexnow": {
    "key": "your-indexnow-key",
    "keyLocation": "https://yourdomain.com/your-indexnow-key.txt"
  },
  "domains": [
    {
      "name": "Production App",
      "url": "https://yourdomain.com/",
      "sitemap": "https://yourdomain.com/sitemap.xml",
      "robots": "https://yourdomain.com/robots.txt",
      "expectedEntities": ["WebSite", "SoftwareApplication"],
      "paths": ["/", "/pricing", "/features"]
    }
  ]
}
```

---

## 🛠️ CLI Commands

### Run Multi-Domain Audit
Crawls all configured domains, validates HTTP status, checks canonicals, verifies Schema.org microdata, and scores AEO answer readiness:
```bash
npm run audit
# or with save flag:
npm run dev -- audit --save
```

### Dispatch URLs to IndexNow
Submits changed or new URLs directly to Bing and Yandex search crawlers:
```bash
npm run indexnow
# or submit specific URLs:
npm run dev -- indexnow --urls https://yourdomain.com/page-1,https://yourdomain.com/page-2
```

### Generate Daily Markdown Health Report
Executes a crawl and writes a timestamped markdown report to `reports/daily-YYYY-MM-DD.md`:
```bash
npm run report
```

### Complete Daily Maintenance Routine
Audits all domains, saves the report, and submits updated paths to IndexNow in a single command:
```bash
npm run daily
```

---

## ☁️ Autonomous 24/7 Cloud Automation

SEOForge includes a pre-configured **GitHub Actions workflow** (`.github/workflows/daily-seo.yml`) that runs daily at **00:00 UTC**.

- Automatically audits your live web properties.
- Dispatches sitemap URLs to the IndexNow network.
- Archives daily markdown audit reports in GitHub Artifacts.

---

## 🤖 Antigravity & Agent Integration

SEOForge can be paired with the custom **Antigravity Skill** (`seo-aeo-autopilot`), allowing AI coding assistants to autonomously execute daily maintenance routines and generate AEO-optimized content directly from chat conversations.

---

## 📄 License

Distributed under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Engineered with precision by <b>Aryan Bansal</b> • <a href="https://www.webforge.me/">webforge.me</a></sub>
</p>
