import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { crawlDomain, crawlPage } from "./crawler.js";
import { evaluateAeo } from "./aeo-scorer.js";
import { validateSchemaOrg } from "./schema-validator.js";
import { submitToIndexNow } from "./indexnow.js";
import { saveMarkdownReport } from "./reporter.js";
import { SeoForgeConfig, DomainAuditResult, OverallAuditReport } from "./types.js";
import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser();

async function loadConfig(configPath?: string): Promise<SeoForgeConfig> {
  const resolvedPath = path.resolve(process.cwd(), configPath || "seoforge.config.json");
  try {
    const raw = await fs.readFile(resolvedPath, "utf-8");
    return JSON.parse(raw) as SeoForgeConfig;
  } catch (err: any) {
    // Fallback default config if file is missing
    return {
      project: "Webforge Ecosystem",
      domains: [
        {
          name: "Webforge Portfolio",
          url: "https://www.webforge.me/",
          sitemap: "https://www.webforge.me/sitemap.xml",
          canonicalPolicy: "spa",
          paths: ["/"],
        },
        {
          name: "DholeraMap GIS",
          url: "https://dholeramap.com/",
          sitemap: "https://dholeramap.com/sitemap.xml",
          sampleSitemap: 5,
          paths: ["/"],
        },
      ],
    };
  }
}

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "seoforge",
      version: "1.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "seoforge_audit",
          description:
            "Crawls configured domains, verifies HTTP status, response latency, canonical integrity, robots.txt, sitemap XML, Schema.org JSON-LD validity, and AEO score (0-100).",
          inputSchema: {
            type: "object",
            properties: {
              domain: {
                type: "string",
                description: "Optional specific domain name or URL to audit. If omitted, audits all configured domains.",
              },
              sample_sitemap: {
                type: "number",
                description: "Optional number of URLs to sample from the XML sitemap for deep route testing.",
              },
            },
          },
        },
        {
          name: "seoforge_inspect_url",
          description:
            "Deep-inspects any single URL in real-time. Returns TTFB latency, canonical match status, meta tags, Schema.org entities, inverted pyramid AEO compliance, and actionable recommendations.",
          inputSchema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "The full HTTPS URL to inspect (e.g., 'https://dholeramap.com/village/bhimnath')",
              },
              expected_entities: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of Schema.org types expected (e.g. ['WebSite', 'FAQPage'])",
              },
              canonical_policy: {
                type: "string",
                enum: ["strict", "spa"],
                description: "Canonical policy: 'strict' requires exact path match; 'spa' permits root fallback for SPAs.",
              },
            },
            required: ["url"],
          },
        },
        {
          name: "seoforge_submit_indexnow",
          description:
            "Submits one or more URLs immediately to the Bing and Yandex IndexNow protocol API for rapid discovery and indexing.",
          inputSchema: {
            type: "object",
            properties: {
              urls: {
                type: "array",
                items: { type: "string" },
                description: "List of absolute URLs to submit to IndexNow.",
              },
              key: {
                type: "string",
                description: "Optional 32-character IndexNow API key. Uses default if not specified.",
              },
            },
            required: ["urls"],
          },
        },
        {
          name: "seoforge_sample_sitemap",
          description:
            "Extracts all URLs from an XML sitemap and audits N randomly selected URLs to test deep dynamic parcel or village routes.",
          inputSchema: {
            type: "object",
            properties: {
              sitemap_url: {
                type: "string",
                description: "URL of the XML sitemap (e.g., 'https://dholeramap.com/sitemap.xml')",
              },
              count: {
                type: "number",
                description: "Number of random URLs to audit (default: 5, max: 20)",
              },
            },
            required: ["sitemap_url"],
          },
        },
        {
          name: "seoforge_check_llms_txt",
          description:
            "Validates the accessibility and structure of /llms.txt and /llms-full.txt files designed for AI engine crawlers (Claude, Perplexity, GPTBot).",
          inputSchema: {
            type: "object",
            properties: {
              base_url: {
                type: "string",
                description: "Root domain URL (e.g. 'https://dholeramap.com')",
              },
            },
            required: ["base_url"],
          },
        },
        {
          name: "seoforge_generate_aeo_snippet",
          description:
            "Generates an optimal 40–55 word inverted pyramid direct-answer definition, semantic H2 subheadings, HTML/Markdown comparison table, and FAQPage Schema.org JSON-LD optimized for Google AI Overviews and Perplexity.",
          inputSchema: {
            type: "object",
            properties: {
              topic: {
                type: "string",
                description: "Core topic or page concept (e.g. 'Dholera SIR TP1 Survey Parcels')",
              },
              target_keyword: {
                type: "string",
                description: "Primary target keyword phrase (e.g. 'dholera tp1 map')",
              },
              entity_category: {
                type: "string",
                description: "Entity type (e.g. 'Geospatial GIS Map', 'Real Estate Directory', 'Systems Engineering Portfolio')",
              },
              details: {
                type: "string",
                description: "Key facts or specifications to include in the definition and comparison table.",
              },
            },
            required: ["topic", "target_keyword"],
          },
        },
        {
          name: "seoforge_daily_run",
          description:
            "Executes the full automated daily routine: multi-domain technical audit, markdown report generation, and IndexNow URL dispatch.",
          inputSchema: {
            type: "object",
            properties: {
              save_report: {
                type: "boolean",
                description: "Whether to save the markdown report to reports/ directory (default: true)",
              },
            },
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "seoforge_audit") {
        const config = await loadConfig();
        const targetDomain = args?.domain as string | undefined;
        const sampleSitemap = args?.sample_sitemap as number | undefined;

        const domainsToAudit = targetDomain
          ? config.domains.filter(
              (d) =>
                d.name.toLowerCase().includes(targetDomain.toLowerCase()) ||
                d.url.toLowerCase().includes(targetDomain.toLowerCase())
            )
          : config.domains;

        if (domainsToAudit.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `No domain matching '${targetDomain}' found in configuration.` }),
              },
            ],
          };
        }

        const results: DomainAuditResult[] = [];
        for (const d of domainsToAudit) {
          const res = await crawlDomain(d, { sampleSitemap: sampleSitemap ?? d.sampleSitemap });
          results.push(res);
        }

        const avgAeo =
          results.length > 0
            ? Math.round(results.reduce((acc, r) => acc + r.averageAeoScore, 0) / results.length)
            : 0;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  timestamp: new Date().toISOString(),
                  project: config.project,
                  domainsAudited: results.length,
                  averageAeoScore: avgAeo,
                  allPassed: results.every((r) => r.passed),
                  results,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (name === "seoforge_inspect_url") {
        const url = args?.url as string;
        const expected = (args?.expected_entities as string[]) || [];
        const policy = (args?.canonical_policy as "strict" | "spa") || "strict";

        const result = await crawlPage(url, expected, policy);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      if (name === "seoforge_submit_indexnow") {
        const urls = args?.urls as string[];
        const config = await loadConfig();
        const key = (args?.key as string) || config.indexnow?.key || "4f9d2a1b7e8c3d5f6a0b9e8d7c6b5a4f";

        // Group by host
        const byHost = new Map<string, string[]>();
        for (const u of urls) {
          try {
            const host = new URL(u).hostname;
            const list = byHost.get(host) || [];
            list.push(u);
            byHost.set(host, list);
          } catch {}
        }

        const responses: any[] = [];
        for (const [host, list] of byHost.entries()) {
          const res = await submitToIndexNow({ host, key, urlList: list });
          responses.push({ host, count: list.length, ...res });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ submitted: urls.length, results: responses }, null, 2),
            },
          ],
        };
      }

      if (name === "seoforge_sample_sitemap") {
        const sitemapUrl = args?.sitemap_url as string;
        const count = Math.min(20, Math.max(1, (args?.count as number) || 5));

        const res = await fetch(sitemapUrl, { headers: { "User-Agent": "SEOForge-Bot/1.0" } });
        if (res.status !== 200) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Sitemap returned HTTP ${res.status}` }) }],
          };
        }

        const text = await res.text();
        const parsed = xmlParser.parse(text);
        const rawList = parsed?.urlset?.url
          ? Array.isArray(parsed.urlset.url)
            ? parsed.urlset.url
            : [parsed.urlset.url]
          : [];

        const allUrls: string[] = rawList
          .map((item: any) => (typeof item === "string" ? item : item.loc))
          .filter(Boolean);

        const shuffled = [...allUrls].sort(() => 0.5 - Math.random());
        const sampled = shuffled.slice(0, count);

        const results = [];
        for (const u of sampled) {
          results.push(await crawlPage(u));
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  sitemapUrl,
                  totalUrlsInSitemap: allUrls.length,
                  sampledCount: sampled.length,
                  allPassed: results.every((r) => r.status === 200 && r.canonicalMatches),
                  results,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (name === "seoforge_check_llms_txt") {
        const base = (args?.base_url as string).replace(/\/$/, "");
        const llmsUrl = `${base}/llms.txt`;
        const llmsFullUrl = `${base}/llms-full.txt`;

        let llmsTxt = { url: llmsUrl, status: 0, length: 0, preview: "" };
        let llmsFullTxt = { url: llmsFullUrl, status: 0, length: 0, preview: "" };

        try {
          const r1 = await fetch(llmsUrl, { headers: { "User-Agent": "SEOForge-Bot/1.0" } });
          llmsTxt.status = r1.status;
          if (r1.status === 200) {
            const body = await r1.text();
            llmsTxt.length = body.length;
            llmsTxt.preview = body.slice(0, 400);
          }
        } catch (e: any) {
          llmsTxt.preview = `Error: ${e.message}`;
        }

        try {
          const r2 = await fetch(llmsFullUrl, { headers: { "User-Agent": "SEOForge-Bot/1.0" } });
          llmsFullTxt.status = r2.status;
          if (r2.status === 200) {
            const body = await r2.text();
            llmsFullTxt.length = body.length;
            llmsFullTxt.preview = body.slice(0, 400);
          }
        } catch (e: any) {
          llmsFullTxt.preview = `Error: ${e.message}`;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  domain: base,
                  llmsTxt,
                  llmsFullTxt,
                  compliant: llmsTxt.status === 200,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (name === "seoforge_generate_aeo_snippet") {
        const topic = args?.topic as string;
        const keyword = args?.target_keyword as string;
        const category = (args?.entity_category as string) || "Digital Platform";
        const details = (args?.details as string) || "official statutory specifications and real-time intelligence";

        // Inverted pyramid 40-55 words
        const snippet = `${topic} is an authoritative ${category.toLowerCase()} designed for ${keyword} queries that delivers direct access to verified layout geometry, statutory survey boundaries, and official valuation data. It consolidates ${details} into high-speed vector formats for property buyers, legal auditors, and institutional investors.`;

        const words = snippet.split(/\s+/).length;

        const faqSchema = {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: `What is ${topic}?`,
              acceptedAnswer: {
                "@type": "Answer",
                text: snippet,
              },
            },
            {
              "@type": "Question",
              name: `How does ${topic} provide data for ${keyword}?`,
              acceptedAnswer: {
                "@type": "Answer",
                text: `${topic} leverages verified municipal town planning schemes, official survey numbers, and geo-referenced GIS coordinates to eliminate broker ambiguity and provide instant statutory verification.`,
              },
            },
          ],
        };

        const comparisonTableMarkdown = `| Parameter | Specification | Statutory Reference |\n|---|---|---|\n| Primary Scope | ${topic} | Official Notification |\n| Target Query | ${keyword} | High-Intent Search |\n| Data Source | Municipal Blueprint & GIS Registry | Verified Authority |\n| Update Cycle | Continuous Automated Sync | 2026 Statutory Release |`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  topic,
                  targetKeyword: keyword,
                  wordCount: words,
                  isOptimalWordCount: words >= 40 && words <= 55,
                  invertedPyramidParagraph: snippet,
                  comparisonTableMarkdown,
                  faqJsonLd: faqSchema,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (name === "seoforge_daily_run") {
        const config = await loadConfig();
        const results: DomainAuditResult[] = [];
        const criticalIssues: string[] = [];

        for (const domain of config.domains) {
          const res = await crawlDomain(domain);
          results.push(res);
          if (!res.passed) {
            criticalIssues.push(`Domain '${domain.name}' failed one or more technical checks.`);
          }
        }

        const totalUrls = results.reduce((acc, r) => acc + r.pages.length, 0);
        const avgAeo =
          results.length > 0
            ? Math.round(results.reduce((acc, r) => acc + r.averageAeoScore, 0) / results.length)
            : 0;

        const report: OverallAuditReport = {
          timestamp: new Date().toISOString(),
          project: config.project,
          domainsAudited: results.length,
          totalUrlsChecked: totalUrls,
          averageAeoScore: avgAeo,
          criticalIssues,
          results,
        };

        let reportPath = "";
        if (args?.save_report !== false) {
          reportPath = await saveMarkdownReport(report);
        }

        // Submit to IndexNow
        const key = config.indexnow?.key || "4f9d2a1b7e8c3d5f6a0b9e8d7c6b5a4f";
        const allUrls: string[] = [];
        for (const d of config.domains) {
          const base = d.url.endsWith("/") ? d.url.slice(0, -1) : d.url;
          const paths = d.paths || ["/"];
          for (const p of paths) {
            allUrls.push(`${base}${p.startsWith("/") ? p : `/${p}`}`);
          }
        }

        const byHost = new Map<string, string[]>();
        for (const u of allUrls) {
          try {
            const host = new URL(u).hostname;
            const list = byHost.get(host) || [];
            list.push(u);
            byHost.set(host, list);
          } catch {}
        }

        const indexNowResults = [];
        for (const [host, list] of byHost.entries()) {
          const res = await submitToIndexNow({ host, key, urlList: list });
          indexNowResults.push({ host, count: list.length, ...res });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "success",
                  timestamp: report.timestamp,
                  averageAeoScore: avgAeo,
                  savedReport: reportPath,
                  indexNowResults,
                  summary: `Audited ${results.length} domains (${totalUrls} URLs). Average AEO: ${avgAeo}/100.`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [{ type: "text", text: `Error: Unknown tool '${name}'` }],
        isError: true,
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Internal tool execution error: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SEOForge MCP Server listening on stdio.");
}
