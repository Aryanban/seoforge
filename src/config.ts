import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { SeoForgeConfig, DomainConfig, CrawlOptions, CrawlStrategy, CanonicalPolicy } from "./types.js";

export interface ResolvedCrawlOptions extends CrawlOptions {
  maxDepth: number;
  concurrency: number;
  limit: number;
  render: boolean;
  strategy: CrawlStrategy;
  sampleSitemap: number;
  canonicalPolicy: CanonicalPolicy;
  respectRobots: boolean;
  maxRequestsPerSecond: number;
  excludePatterns: string[];
  checkExternalLinks: boolean;
  externalLinkTimeoutMs: number;
  timeoutMs: number;
  followSitemap: boolean;
}

export const DEFAULT_CRAWL_OPTIONS: ResolvedCrawlOptions = {
  maxDepth: 10,
  concurrency: 8,
  limit: 1000,
  render: false,
  strategy: "discover",
  sampleSitemap: 0,
  canonicalPolicy: "strict",
  respectRobots: true,
  maxRequestsPerSecond: 20,
  excludePatterns: [],
  checkExternalLinks: true,
  externalLinkTimeoutMs: 4000,
  timeoutMs: 15000,
  followSitemap: true,
};

const domainSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  sitemap: z.string().url().optional(),
  robots: z.string().url().optional(),
  llmsTxt: z.string().url().optional(),
  llmsFullTxt: z.string().url().optional(),
  sampleSitemap: z.number().int().nonnegative().optional(),
  canonicalPolicy: z.enum(["strict", "spa"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  expectedEntities: z.array(z.string()).optional(),
  paths: z.array(z.string()).optional(),
  render: z.boolean().optional(),
  crawlStrategy: z.enum(["discover", "sitemap", "config"]).optional(),
  maxDepth: z.number().int().positive().optional(),
  excludePatterns: z.array(z.string()).optional(),
  checkExternalLinks: z.boolean().optional(),
});

const configSchema = z.object({
  project: z.string().min(1),
  indexnow: z
    .object({
      key: z.string(),
      keyLocation: z.string().optional(),
    })
    .optional(),
  domains: z.array(domainSchema).min(1),
  thresholds: z
    .object({
      maxResponseTimeMs: z.number().positive().optional(),
      minAeoScore: z.number().nonnegative().optional(),
      minWordCount: z.number().nonnegative().optional(),
      requireCanonical: z.boolean().optional(),
      requireSchema: z.boolean().optional(),
    })
    .optional(),
  crawl: z.object({
    maxDepth: z.number().int().positive().optional(),
    concurrency: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
    render: z.boolean().optional(),
    strategy: z.enum(["discover", "sitemap", "config"]).optional(),
    sampleSitemap: z.number().int().nonnegative().optional(),
    canonicalPolicy: z.enum(["strict", "spa"]).optional(),
    respectRobots: z.boolean().optional(),
    maxRequestsPerSecond: z.number().positive().optional(),
    excludePatterns: z.array(z.string()).optional(),
    checkExternalLinks: z.boolean().optional(),
    externalLinkTimeoutMs: z.number().positive().optional(),
    timeoutMs: z.number().positive().optional(),
    followSitemap: z.boolean().optional(),
  }).optional(),
  server: z
    .object({
      port: z.number().int().positive().optional(),
      host: z.string().optional(),
      open: z.boolean().optional(),
    })
    .optional(),
});

export class ConfigError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = "ConfigError";
  }
}

export function validateConfig(raw: unknown): SeoForgeConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ConfigError(
      `Invalid configuration: ${first.path.join(".")} — ${first.message}`,
      parsed.error.issues
    );
  }
  return parsed.data as SeoForgeConfig;
}

export async function loadConfig(configPath?: string): Promise<SeoForgeConfig> {
  const resolvedPath = path.resolve(process.cwd(), configPath || "seoforge.config.json");
  let raw: string;
  try {
    raw = await fs.readFile(resolvedPath, "utf-8");
  } catch (err: any) {
    throw new ConfigError(`Failed to load configuration from ${resolvedPath}: ${err.message}`);
  }
  try {
    return validateConfig(JSON.parse(raw));
  } catch (err: any) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`Configuration file contains invalid JSON: ${err.message}`);
  }
}

export function mergeCrawlOptions(
  config: SeoForgeConfig,
  domain: DomainConfig,
  overrides?: CrawlOptions
): CrawlOptions & { strategy: NonNullable<CrawlOptions["strategy"]> } {
  const merged: any = {
    ...DEFAULT_CRAWL_OPTIONS,
    ...config.crawl,
    sampleSitemap: domain.sampleSitemap ?? config.crawl?.sampleSitemap ?? DEFAULT_CRAWL_OPTIONS.sampleSitemap,
    canonicalPolicy: domain.canonicalPolicy ?? config.crawl?.canonicalPolicy ?? DEFAULT_CRAWL_OPTIONS.canonicalPolicy,
    strategy: domain.crawlStrategy ?? config.crawl?.strategy ?? DEFAULT_CRAWL_OPTIONS.strategy,
    maxDepth: domain.maxDepth ?? config.crawl?.maxDepth ?? DEFAULT_CRAWL_OPTIONS.maxDepth,
    render: domain.render ?? config.crawl?.render ?? DEFAULT_CRAWL_OPTIONS.render,
    checkExternalLinks:
      domain.checkExternalLinks ?? config.crawl?.checkExternalLinks ?? DEFAULT_CRAWL_OPTIONS.checkExternalLinks,
    excludePatterns: domain.excludePatterns ?? config.crawl?.excludePatterns ?? [],
    ...overrides,
  };
  return merged;
}

export function generateConfigJsonSchema(): object {
  return zodToJsonSchemaShallow(configSchema);
}

/** Minimal JSON-Schema projection (avoids a zod-to-json-schema dependency). */
function zodToJsonSchemaShallow(schema: any): any {
  if (schema instanceof z.ZodObject) {
    const props: Record<string, any> = {};
    const required: string[] = [];
    for (const [key, val] of Object.entries(schema.shape)) {
      props[key] = zodToJsonSchemaShallow(val as z.ZodTypeAny);
      if (!(val instanceof z.ZodOptional)) required.push(key);
    }
    return { type: "object", properties: props, required, additionalProperties: true };
  }
  if (schema instanceof z.ZodOptional) return zodToJsonSchemaShallow(schema.unwrap());
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJsonSchemaShallow(schema.element) };
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  return {};
}
