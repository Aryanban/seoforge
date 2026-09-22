/**
 * Fixture site for the test suite — a tiny HTTP server that deliberately
 * contains the classic SEO defects the engine must detect.
 */
import http from "node:http";

export interface FixtureSite {
  port: number;
  url: string;
  close(): Promise<void>;
}

const OK = `
<!DOCTYPE html>
<html lang="en"><head>
  <title>SEOForge Fixture — Home</title>
  <meta name="description" content="The homepage of the SEOForge fixture site used for crawler tests.">
  <link rel="canonical" href="{{ORIGIN}}/">
  <meta property="og:title" content="Home">
  <meta property="og:description" content="Home description">
  <meta property="og:image" content="{{ORIGIN}}/og.png">
  <meta property="og:url" content="{{ORIGIN}}/">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[
    {"@type":"WebSite","name":"Fixture","url":"{{ORIGIN}}"},
    {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What is this?","acceptedAnswer":{"@type":"Answer","text":"This is the SEOForge fixture site used to verify that the crawler detects common SEO defects."}}]}
  ]}
  </script>
</head><body>
  <h1>Fixture Home</h1>
  <p id="lead">The SEOForge fixture site is a deliberately imperfect demonstration property built to verify that the audit engine detects every common search engine optimization defect in a single deterministic crawl.</p>
  <h2>Sections</h2>
  <ul>
    <li><a href="/broken-link">Broken link page</a></li>
    <li><a href="/missing-title">Missing title page</a></li>
    <li><a href="/no-h1">Missing H1 page</a></li>
    <li><a href="/thin">Thin content page</a></li>
    <li><a href="/missing-alt">Missing alt image page</a></li>
  </ul>
  <table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody><tr><td>Pages</td><td>7</td></tr></tbody></table>
</body></html>
`;

const BROKEN_LINK = `
<!DOCTYPE html><html><head><title>Broken Link Page</title></head><body>
  <h1>Broken Link Page</h1>
  <p>This page links to a URL that does not exist.</p>
  <a href="/does-not-exist">Click this broken link</a>
</body></html>
`;

const MISSING_TITLE = `
<!DOCTYPE html><html><head></head><body>
  <h1>Missing Title Page</h1>
  <p>This page has no title tag at all and should be flagged as an error by the audit engine.</p>
</body></html>
`;

const NO_H1 = `
<!DOCTYPE html><html><head><title>No H1 Page</title></head><body>
  <p>This page has no H1 heading anywhere in the document body.</p>
</body></html>
`;

const THIN = `
<!DOCTYPE html><html><head><title>Thin Page</title></head><body>
  <h1>Thin</h1><p>Too short.</p>
</body></html>
`;

const MISSING_ALT = `
<!DOCTYPE html><html><head><title>Missing Alt Page</title></head><body>
  <h1>Missing Alt Page</h1>
  <img src="/logo.png">
  <img src="/banner.png" alt="" width="120" height="60">
</body></html>
`;

const ORPHAN = `
<!DOCTYPE html><html><head><title>Orphan Page</title></head><body>
  <h1>Orphan Page</h1>
  <p>This page is never linked to from anywhere, so it should be reported as an orphan page error.</p>
</body></html>
`;

const SITEMAP = (origin: string) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc><lastmod>2026-09-01</lastmod></url>
  <url><loc>${origin}/broken-link</loc></url>
  <url><loc>${origin}/orphan</loc></url>
</urlset>
`;

export async function startFixtureSite(): Promise<FixtureSite> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const origin = `http://127.0.0.1:${(server.address() as any).port}`;
      const url = req.url || "/";

      const send = (status: number, body: string, contentType = "text/html") => {
        res.writeHead(status, { "Content-Type": `${contentType}; charset=utf-8` });
        res.end(body.replace(/\{\{ORIGIN\}\}/g, origin));
      };

      if (url === "/") return send(200, OK);
      if (url === "/broken-link") return send(200, BROKEN_LINK);
      if (url === "/missing-title") return send(200, MISSING_TITLE);
      if (url === "/no-h1") return send(200, NO_H1);
      if (url === "/thin") return send(200, THIN);
      if (url === "/missing-alt") return send(200, MISSING_ALT);
      if (url === "/orphan") return send(200, ORPHAN);
      if (url === "/redirect") {
        res.writeHead(301, { Location: `${origin}/` });
        return res.end();
      }
      if (url === "/sitemap.xml") return send(200, SITEMAP(origin), "application/xml");
      return send(404, "<html><body>404 Not Found</body></html>");
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      });
    });
  });
}
