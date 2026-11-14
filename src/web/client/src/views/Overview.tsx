import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, CrawlSummary, PagedResult, IssueRow, CrawlStats, severityBg } from "../lib/api.js";
import { Card, Badge, Spinner, EmptyState, PageHeader } from "../components/ui.js";
import { ScoreDial, BarList, StackedBarList, ColumnChart, LineChart, TONE } from "../components/charts.js";

export default function Overview({ crawlId, crawl }: { crawlId: string; crawl: CrawlSummary | null }) {
  const [issues, setIssues] = useState<PagedResult<IssueRow> | null>(null);
  const [stats, setStats] = useState<CrawlStats | null>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    setStats(null);
    api<PagedResult<IssueRow>>(`/api/crawl/${crawlId}/issues?pageSize=8`).then(setIssues).catch(() => setIssues(null));
    api<CrawlStats>(`/api/crawl/${crawlId}/stats`).then(setStats).catch(() => setStats(null));
    api<any[]>(`/api/crawl/${crawlId}/trend`).then(setTrend).catch(() => setTrend([]));
  }, [crawlId]);

  if (!crawl || !stats) return <Spinner label="Loading overview…" />;

  const pages = (q: string) => navigate(`/pages?${q}`);
  const health = stats.health.score;
  const verdict =
    crawl.totalErrors > 0
      ? { text: `${stats.health.pagesWithErrors.toLocaleString()} pages with errors`, cls: "bg-red-500/12 text-red-300 border-red-500/25" }
      : crawl.totalWarnings > 0
      ? { text: "No errors · warnings to review", cls: "bg-amber-500/12 text-amber-300 border-amber-500/25" }
      : { text: "Clean crawl", cls: "bg-emerald-500/12 text-emerald-300 border-emerald-500/25" };

  const kpis = [
    { label: "Errors", value: crawl.totalErrors, color: "text-red-400", to: "/issues?severity=Error" },
    { label: "Warnings", value: crawl.totalWarnings, color: "text-amber-400", to: "/issues?severity=Warning" },
    { label: "Notices", value: crawl.totalNotices, color: "text-sky-400", to: "/issues?severity=Notice" },
    { label: "Pages crawled", value: crawl.totalUrlsCrawled, color: "text-text", to: "/pages" },
  ];

  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div>
      <PageHeader
        title={crawl.targetUrl}
        subtitle={`${new Date(crawl.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · ${crawl.strategy} strategy · depth ${crawl.maxDepthReached}`}
        actions={<Badge className={`border ${verdict.cls}`}>{verdict.text}</Badge>}
      />

      {/* Scores + KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_2fr] gap-4 mb-4">
        <Card className="p-5 flex items-center gap-5">
          <ScoreDial score={health} />
          <div>
            <div className="text-[10px] text-faint uppercase tracking-wide">Health score</div>
            <div className="text-xs text-muted mt-1 leading-relaxed">
              Share of crawled pages with no error-level issue
              {stats.health.pagesWithErrors > 0 ? ` (${stats.health.pagesWithErrors.toLocaleString()} affected).` : "."}
            </div>
          </div>
        </Card>
        <Card className="p-5 flex items-center gap-5">
          <ScoreDial score={crawl.averageAeoScore} />
          <div>
            <div className="text-[10px] text-faint uppercase tracking-wide">Answer engine score</div>
            <div className="text-xs text-muted mt-1 leading-relaxed">
              {crawl.averageAeoScore >= 90
                ? "Pages are easy for AI answer engines to extract and cite."
                : crawl.averageAeoScore >= 70
                ? "Some pages lack direct answers or schema."
                : "Pages are hard for answer engines to extract."}
            </div>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3">
          {kpis.map((k) => (
            <button
              key={k.label}
              onClick={() => navigate(k.to)}
              className="text-left bg-panel border border-border rounded-xl p-4 hover:border-border2 transition-colors"
            >
              <div className={`text-2xl font-bold tabular-nums ${k.color}`}>{k.value.toLocaleString()}</div>
              <div className="text-[10px] text-faint uppercase tracking-wide mt-0.5">{k.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="p-5">
          <ChartTitle title="HTTP status codes" hint="Click a row to list those pages" />
          <BarList
            total={stats.total}
            items={stats.status.map((s) => ({
              label: s.label,
              value: s.count,
              color: s.key === "2xx" ? TONE.ok : s.key === "3xx" ? TONE.warn : s.key === "failed" ? TONE.faint : TONE.err,
              onClick: () => pages(`status=${s.key}`),
            }))}
          />
          <div className="border-t border-border mt-3 pt-3">
            <BarList
              total={stats.total}
              items={[
                { label: "Indexable", value: stats.indexability.indexable, color: TONE.ok, onClick: () => pages("indexable=1") },
                { label: "Non-indexable", value: stats.indexability.nonIndexable, color: TONE.warn, onClick: () => pages("indexable=0") },
                { label: "Orphan pages", value: stats.indexability.orphans, color: TONE.err, onClick: () => pages("orphan=1") },
              ]}
            />
          </div>
        </Card>

        <Card className="p-5">
          <ChartTitle title="Crawl depth" hint="Clicks from the start URL" />
          <ColumnChart
            data={stats.depth.map((d) => ({ label: d.depth >= 10 ? "10+" : String(d.depth), value: d.count }))}
            onSelect={(i) => pages(`depth=${stats.depth[i].depth}`)}
          />
          <p className="text-[11px] text-faint mt-3">
            {(() => {
              const deep = stats.depth.filter((d) => d.depth > 3).reduce((a, d) => a + d.count, 0);
              return deep > 0
                ? `${deep.toLocaleString()} pages are more than 3 clicks deep — harder for users and crawlers to reach.`
                : "Every page is within 3 clicks of the start URL.";
            })()}
          </p>
        </Card>

        <Card className="p-5">
          <ChartTitle title="Response time" hint={`Average ${stats.responseTime.avgMs.toLocaleString()} ms`} />
          <ColumnChart
            data={stats.responseTime.buckets.map((b) => ({ label: b.label, value: b.count }))}
            color={TONE.note}
            onSelect={() => navigate("/pages?sort=responseTimeMs&dir=desc")}
          />
          <p className="text-[11px] text-faint mt-3">Full HTML download time per page, measured by the crawler.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Top issues</h2>
            {issues && issues.rows.length > 0 && (
              <button onClick={() => navigate("/issues")} className="text-[11px] text-indigo-400 hover:text-indigo-300">
                View all →
              </button>
            )}
          </div>
          {issues && issues.rows.length > 0 ? (
            <div className="space-y-0.5">
              {issues.rows.map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => navigate(`/issues?q=${encodeURIComponent(issue.name)}`)}
                  className="w-full flex items-center gap-3 text-sm py-2 border-b border-border last:border-0 hover:bg-panel2/50 -mx-2 px-2 rounded-lg transition-colors text-left"
                >
                  <Badge className={severityBg(issue.severity)}>{issue.severity}</Badge>
                  <span className="flex-1 truncate text-zinc-200" title={issue.name}>
                    {issue.name}
                  </span>
                  <span className="tabular-nums text-zinc-300">{issue.affectedPages.toLocaleString()}</span>
                  {issue.change !== 0 && (
                    <span className={`text-[11px] tabular-nums w-12 text-right ${issue.change > 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {issue.change > 0 ? `+${issue.change}` : issue.change}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState message="No issues detected — the site is clean." />
          )}
        </Card>

        <Card className="p-5">
          <ChartTitle title="Issues by category" hint="Pages affected · click to filter" />
          {stats.categories.length > 0 ? (
            <>
              <StackedBarList
                items={stats.categories.map((c) => ({
                  label: c.category,
                  onClick: () => navigate(`/issues?category=${encodeURIComponent(c.category)}`),
                  parts: [
                    { name: "Errors", value: c.errors, color: TONE.err },
                    { name: "Warnings", value: c.warnings, color: TONE.warn },
                    { name: "Notices", value: c.notices, color: TONE.note },
                  ],
                }))}
              />
              <Legend items={[["Errors", TONE.err], ["Warnings", TONE.warn], ["Notices", TONE.note]]} />
            </>
          ) : (
            <EmptyState message="No issues detected." />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <Card className="p-5">
          <ChartTitle title="History" hint={trend.length > 1 ? `${trend.length} crawls of this site` : undefined} />
          {trend.length > 1 ? (
            (() => {
              // One shared y-scale so the lines are comparable; label by time
              // when several crawls fall on the same day.
              const max = Math.max(1, ...trend.map((t) => Math.max(t.errors, t.warnings, t.notices)));
              const sameDay = new Set(trend.map((t) => date(t.date))).size < trend.length;
              const label = (iso: string) =>
                sameDay
                  ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                  : date(iso);
              return (
                <LineChart
                  labels={trend.map((t) => label(t.date))}
                  series={[
                    { name: "Errors", color: TONE.err, values: trend.map((t) => t.errors), max },
                    { name: "Warnings", color: TONE.warn, values: trend.map((t) => t.warnings), max },
                    { name: "Notices", color: TONE.note, values: trend.map((t) => t.notices), max },
                  ]}
                />
              );
            })()
          ) : (
            <EmptyState message="No history yet." hint="Crawl the same site again to see changes over time." />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-4">Crawl facts</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Fact label="Robots.txt" value={crawl.robotsAccessible ? "Accessible" : "Unreachable"} ok={crawl.robotsAccessible} />
            <Fact
              label="Sitemap"
              value={crawl.sitemapAccessible ? `${crawl.sitemapUrlCount.toLocaleString()} URLs` : "Unreachable"}
              ok={crawl.sitemapAccessible}
            />
            <Fact label="llms.txt" value={crawl.llmsTxtAccessible ? "Present" : "Not found"} ok={!!crawl.llmsTxtAccessible} />
            <Fact
              label="Issue types"
              value={issues ? issues.total.toLocaleString() : "—"}
              ok={!issues || issues.total === 0}
              neutral
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function ChartTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex gap-4 text-[11px] text-muted mt-3">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: color }} /> {label}
        </span>
      ))}
    </div>
  );
}

function Fact({ label, value, ok, neutral }: { label: string; value: string; ok: boolean; neutral?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-faint uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-medium mt-0.5 ${neutral ? "text-text" : ok ? "text-emerald-400" : "text-amber-400"}`}>
        {neutral ? "" : ok ? "✓ " : "⚠ "}
        {value}
      </div>
    </div>
  );
}
