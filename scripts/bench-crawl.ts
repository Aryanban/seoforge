/**
 * Local crawl benchmark. Serves a synthetic N-page site on localhost with a
 * fixed per-request latency, crawls it, and reports throughput, peak server
 * request rate and memory. Nothing leaves the machine.
 *
 *   npx tsx scripts/bench-crawl.ts --pages 1000 --latency 50 --concurrency 12 --rps 20
 *   --server-limit N  answer 429 (Retry-After: 1) once the server sees more than N req/s, like a real rate limiter
 */
import http from "node:http";
import { crawlSite } from "../src/crawl/crawler.js";

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const PAGES = arg("pages", 1000);
const LATENCY = arg("latency", 50);
const CONCURRENCY = arg("concurrency", 12);
const RPS = arg("rps", 20);
const SERVER_LIMIT = arg("server-limit", 0);
let served429 = 0;
const FILLER = "<p>" + "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(40) + "</p>";

function page(i: number): string {
  const links = Array.from({ length: 10 }, (_, k) => (i * 10 + k + 1) % PAGES)
    .map((n) => `<li><a href="/p/${n}">Page ${n}</a></li>`)
    .join("");
  return `<!DOCTYPE html><html lang="en"><head><title>Benchmark page ${i}</title>
<meta name="description" content="Synthetic benchmark page number ${i} used to measure crawl throughput locally.">
<link rel="canonical" href="/p/${i}"></head><body><h1>Page ${i}</h1>${FILLER.repeat(8)}<ul>${links}</ul></body></html>`;
}

let requests = 0;
const perSecond = new Map<number, number>();
const server = http.createServer((req, res) => {
  requests++;
  const sec = Math.floor(Date.now() / 1000);
  perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
  setTimeout(() => {
    if (SERVER_LIMIT && (perSecond.get(sec) ?? 0) > SERVER_LIMIT) {
      served429++;
      res.writeHead(429, { "retry-after": "1" }).end();
      return;
    }
    const m = /^\/p\/(\d+)$/.exec(req.url ?? "") ?? (req.url === "/" ? [, "0"] : null);
    if (!m) return void res.writeHead(404).end("not found");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page(Number(m[1])));
  }, LATENCY);
});

await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
let peakRss = 0;
const rssTimer = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 100);

const t0 = performance.now();
const result = await crawlSite(`http://127.0.0.1:${port}/`, {
  limit: PAGES,
  maxDepth: 100,
  concurrency: CONCURRENCY,
  maxRequestsPerSecond: RPS,
  respectRobots: false,
  followSitemap: false,
  checkExternalLinks: false, ...(process.env.PW ? { pageWorkers: Number(process.env.PW) } : {}),
});
const secs = (performance.now() - t0) / 1000;
clearInterval(rssTimer);
server.close();

const crawled = result.pages.filter((p) => p.status === 200).length;
console.log(
  JSON.stringify(
    {
      pages: result.pages.length,
      ok200: crawled,
      seconds: +secs.toFixed(2),
      pagesPerSec: +(result.pages.length / secs).toFixed(1),
      serverRequests: requests,
      peakServerRps: Math.max(...perSecond.values()),
      peakRssMB: Math.round(peakRss / 1048576),
      settings: { PAGES, LATENCY, CONCURRENCY, RPS, SERVER_LIMIT },
      served429,
    },
    null,
    2,
  ),
);
process.exit(0);
