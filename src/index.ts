/**
 * SEOForge 2.0 — public SDK surface.
 *
 * Everything needed to embed the crawler, audit engine, and recommendation
 * generator in another program:
 *
 *   import { crawlSite, auditSinglePage } from "seoforge";
 *
 * The CLI (`src/cli.ts`), MCP server (`src/mcp/mcp-server.ts`), and REST API
 * (`src/api/server.ts`) are thin layers over these primitives.
 */
export * from "./types.js";
export * from "./config.js";
export { Crawler, crawlSite } from "./crawl/crawler.js";
export { auditSinglePage } from "./audit-page.js";
export { fetchPage } from "./crawl/fetcher.js";
export { parseSitemap } from "./crawl/sitemap-parser.js";
export { renderUrl, isRenderAvailable } from "./crawl/renderer.js";
export { extractLinks, extractImages } from "./crawl/link-extractor.js";
export { normalizeUrl, CrawlQueue } from "./crawl/queue.js";
export { runPageChecks, listChecks } from "./checks/registry.js";
export { buildIssueSummary } from "./checks/summary.js";
export { validateSchemaOrg } from "./checks/schema-engine.js";
export { evaluateAeo } from "./checks/aeo-engine.js";
export {
  generateRecommendations,
  generateFixBacklogMarkdown,
} from "./ai/recommendations.js";
export { generateAeoSnippet } from "./ai/snippets.js";
export { submitToIndexNow } from "./indexnow.js";
export { openStore, closeStore, migrateLegacySnapshots } from "./store/db.js";
export * as store from "./store/repository.js";
export {
  formatTerminalOutput,
  formatCrawlTerminalOutput,
  formatPageTerminal,
} from "./report/terminal.js";
export {
  generateMarkdownReport,
  generateCrawlMarkdown,
  saveMarkdownReport,
} from "./report/markdown.js";
export { toCsv } from "./report/csv.js";
export { generateHtmlReport } from "./report/html.js";
export { createServer, startServer } from "./api/server.js";
export { createMcpServer, startMcpServer } from "./mcp/mcp-server.js";

// v1 backwards compatibility
export { crawlDomain, crawlPage } from "./crawler.js";
