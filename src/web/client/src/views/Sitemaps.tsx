import React, { useEffect, useState } from "react";
import { api, PagedResult, IssueRow, severityBg } from "../lib/api.js";
import { Card, Badge, Spinner, EmptyState } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";

export default function Sitemaps({ crawlId }: { crawlId: string }) {
  const [crawl, setCrawl] = useState<any>(null);
  const [urls, setUrls] = useState<any[]>([]);
  const [orphanIssue, setOrphanIssue] = useState<IssueRow | null>(null);

  useEffect(() => {
    api<any>(`/api/crawl/${crawlId}`).then(setCrawl).catch(() => setCrawl(null));
    api<any[]>(`/api/crawl/${crawlId}/sitemap`).then(setUrls).catch(() => setUrls([]));
    api<PagedResult<IssueRow>>(`/api/crawl/${crawlId}/issues?search=sitemap&pageSize=10`)
      .then((r) => setOrphanIssue(r.rows.find((i) => i.id === "orphan_in_sitemap") || null))
      .catch(() => setOrphanIssue(null));
  }, [crawlId]);

  if (!crawl) return <Spinner label="Loading sitemap data…" />;

  const stats = [
    {
      label: "Accessible",
      value: crawl.sitemapAccessible ? "✓ Yes" : "✗ No",
      ok: crawl.sitemapAccessible,
    },
    { label: "URLs in sitemap", value: String(crawl.sitemapUrlCount), ok: true },
    { label: "Pages crawled", value: String(crawl.totalUrlsCrawled), ok: true },
    {
      label: "Orphan in sitemap",
      value: String(orphanIssue?.affectedPages ?? 0),
      ok: !orphanIssue,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sitemaps"
        subtitle="XML sitemap coverage, accessibility, and URLs listed but never internally linked."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div
              className={`text-2xl font-bold tabular-nums ${s.ok ? "text-white" : "text-amber-400"}`}
            >
              {s.value}
            </div>
            <div className="text-[10px] text-faint uppercase tracking-wide mt-0.5">{s.label}</div>
          </Card>
        ))}
      </div>

      {orphanIssue && (
        <Card className="p-5 mb-5 border-amber-500/25">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Badge className={severityBg(orphanIssue.severity)}>{orphanIssue.severity}</Badge>
            {orphanIssue.name}
          </h2>
          <div className="text-xs text-muted mb-3 max-w-3xl">{orphanIssue.recommendation}</div>
          <div className="space-y-0.5">
            {orphanIssue.affectedUrls.slice(0, 20).map((u) => (
              <a
                key={u}
                href={u}
                target="_blank"
                rel="noreferrer"
                className="block text-sky-400 hover:text-sky-300 text-xs truncate transition-colors"
              >
                {u}
              </a>
            ))}
            {orphanIssue.affectedUrls.length > 20 && (
              <div className="text-faint text-xs pt-1">
                …and {orphanIssue.affectedUrls.length - 20} more
              </div>
            )}
          </div>
        </Card>
      )}

      <Card hover>
        <div className="p-4 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold">Sitemap URLs</span>
          <span className="text-xs text-muted">{urls.length} stored</span>
        </div>
        {urls.length === 0 ? (
          <EmptyState message="No sitemap URLs stored for this crawl." />
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <tbody>
                {urls.map((u, i) => (
                  <tr key={i} className="border-b border-border hover:bg-panel2/50 transition-colors">
                    <td className="p-2.5">
                      <a
                        href={u.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:text-sky-300 text-xs transition-colors"
                      >
                        {u.url}
                      </a>
                    </td>
                    <td className="p-2.5 text-muted text-xs whitespace-nowrap text-right tabular-nums">
                      {u.lastmod || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
