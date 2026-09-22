/**
 * Static, shareable HTML report — self-contained, zero dependencies.
 */
import { CrawlResult } from "../types.js";

export function generateHtmlReport(result: CrawlResult): string {
  const issues = [...result.issuesSummary].sort((a, b) => {
    const w = { Error: 3, Warning: 2, Notice: 1 };
    return w[b.severity] - w[a.severity] || b.affectedPages - a.affectedPages;
  });

  const sevClass = (s: string) => (s === "Error" ? "err" : s === "Warning" ? "warn" : "note");

  const issueRows = issues.length
    ? issues
        .map(
          (i) => `<tr class="${sevClass(i.severity)}">
        <td>${esc(i.name)}</td>
        <td><span class="badge ${sevClass(i.severity)}">${i.severity}</span></td>
        <td>${esc(i.category)}</td>
        <td class="num">${i.affectedPages}</td>
        <td class="num ${i.change > 0 ? "up" : i.change < 0 ? "down" : ""}">${i.change > 0 ? "+" + i.change : i.change}</td>
        <td>${esc(i.recommendation)}</td>
        <td class="urls">${i.affectedUrls.slice(0, 5).map((u) => `<div>${esc(u)}</div>`).join("")}${i.affectedUrls.length > 5 ? `<div class="more">+${i.affectedUrls.length - 5} more</div>` : ""}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="7" style="text-align:center;padding:2rem">✅ No issues detected</td></tr>`;

  const pages = [...result.pages].sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url)).slice(0, 300);
  const pageRows = pages
    .map(
      (p) => `<tr>
        <td class="url">${esc(p.url)}</td>
        <td class="num ${p.status === 200 ? "ok" : "bad"}">${p.status}</td>
        <td class="num">${p.depth}</td>
        <td class="num">${p.ttfbMs ?? p.responseTimeMs}</td>
        <td class="num">${p.wordCount}</td>
        <td class="num">${p.incomingInternalLinks.length}</td>
        <td class="num">${p.aeo.score}</td>
        <td>${esc(p.schema.typesFound.join(", ") || "—")}</td>
        <td>${p.auditIssues.length ? `<span class="badge ${sevClass(p.auditIssues[0].severity)}">${p.auditIssues.length}</span>` : '<span class="badge ok">0</span>'}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SEOForge Audit — ${esc(result.targetUrl)}</title>
<style>
  :root { --bg:#0d1117; --panel:#161b22; --border:#30363d; --text:#e6edf3; --muted:#8b949e;
    --err:#f85149; --warn:#d29922; --note:#58a6ff; --ok:#3fb950; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  header { padding:1.5rem 2rem; border-bottom:1px solid var(--border); position:sticky; top:0; background:rgba(13,17,23,.92); backdrop-filter:blur(6px); }
  h1 { margin:0 .25rem .25rem 0; font-size:1.25rem; }
  .meta { color:var(--muted); font-size:.8rem; }
  main { padding:1.5rem 2rem 4rem; max-width:100%; overflow-x:auto; }
  h2 { font-size:1rem; margin:2rem 0 .75rem; color:var(--text); }
  .kpis { display:flex; gap:1rem; flex-wrap:wrap; margin:.75rem 0 1.5rem; }
  .kpi { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:.75rem 1.25rem; min-width:120px; }
  .kpi b { display:block; font-size:1.4rem; }
  .kpi span { color:var(--muted); font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  th, td { padding:.5rem .75rem; text-align:left; border-bottom:1px solid var(--border); }
  th { background:#21262d; font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  td.url, .urls div { max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#79c0ff; }
  .urls div { font-size:.8rem; }
  .more { color:var(--muted); font-size:.75rem; }
  .badge { display:inline-block; padding:.1rem .5rem; border-radius:12px; font-size:.7rem; font-weight:600; }
  .badge.err, tr.err td:first-child { border-left:3px solid var(--err); }
  .badge.warn, tr.warn td:first-child { border-left:3px solid var(--warn); }
  .badge.note, tr.note td:first-child { border-left:3px solid var(--note); }
  .badge.err { background:rgba(248,81,73,.15); color:var(--err); }
  .badge.warn { background:rgba(210,153,34,.15); color:var(--warn); }
  .badge.note { background:rgba(88,166,255,.15); color:var(--note); }
  .badge.ok { background:rgba(63,185,80,.15); color:var(--ok); }
  .ok { color:var(--ok); } .bad { color:var(--err); }
  .up { color:var(--err); } .down { color:var(--ok); }
  footer { color:var(--muted); font-size:.75rem; padding:1rem 2rem 2rem; }
  input { background:var(--panel); border:1px solid var(--border); color:var(--text); border-radius:6px; padding:.4rem .6rem; margin-bottom:.75rem; width:100%; max-width:360px; }
</style>
</head>
<body>
<header>
  <h1>SEOForge 2.0 Audit Report</h1>
  <div class="meta">${esc(result.targetUrl)} · ${esc(result.startedAt)} · strategy ${esc(result.strategy)} · ${result.totalUrlsCrawled} pages · depth ${result.maxDepthReached}</div>
</header>
<main>
  <div class="kpis">
    <div class="kpi"><b style="color:var(--err)">${result.totalErrors}</b><span>Errors</span></div>
    <div class="kpi"><b style="color:var(--warn)">${result.totalWarnings}</b><span>Warnings</span></div>
    <div class="kpi"><b style="color:var(--note)">${result.totalNotices}</b><span>Notices</span></div>
    <div class="kpi"><b>${result.averageAeoScore}</b><span>AEO / 100</span></div>
    <div class="kpi"><b>${result.sitemapUrlCount}</b><span>Sitemap URLs</span></div>
  </div>

  <h2>Issues Overview</h2>
  <input id="issueFilter" placeholder="Filter issues…" oninput="filterTable('issueFilter','issuesTable')">
  <table id="issuesTable">
    <thead><tr><th>Issue</th><th>Severity</th><th>Category</th><th>Affected</th><th>Change</th><th>Recommendation</th><th>URLs</th></tr></thead>
    <tbody>${issueRows}</tbody>
  </table>

  <h2>Pages</h2>
  <input id="pageFilter" placeholder="Filter pages…" oninput="filterTable('pageFilter','pagesTable')">
  <table id="pagesTable">
    <thead><tr><th>URL</th><th>Status</th><th>Depth</th><th>TTFB ms</th><th>Words</th><th>In-links</th><th>AEO</th><th>Schema</th><th>Issues</th></tr></thead>
    <tbody>${pageRows}</tbody>
  </table>
</main>
<footer>Generated by SEOForge 2.0 — local crawler, audit engine &amp; MCP server.</footer>
<script>
function filterTable(inputId, tableId) {
  const q = document.getElementById(inputId).value.toLowerCase();
  document.querySelectorAll('#' + tableId + ' tbody tr').forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
