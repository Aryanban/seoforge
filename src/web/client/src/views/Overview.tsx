import React, { useEffect, useState } from "react";
import { api, CrawlSummary, PagedResult, IssueRow, severityBg } from "../lib/api.js";
import { Card, Badge, Spinner, EmptyState } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";

export default function Overview({ crawlId, crawl }: { crawlId: string; crawl: CrawlSummary | null }) {
  const [issues, setIssues] = useState<PagedResult<IssueRow> | null>(null);
  const [trend, setTrend] = useState<any[]>([]);

  useEffect(() => {
    api<PagedResult<IssueRow>>(`/api/crawl/${crawlId}/issues?pageSize=8`)
      .then(setIssues)
      .catch(() => setIssues(null));
    api<any[]>(`/api/crawl/${crawlId}/trend`).then(setTrend).catch(() => setTrend([]));
  }, [crawlId]);

  if (!crawl) return <Spinner />;

  const health = crawl.totalErrors === 0;
  const kpis = [
    { label: "Errors", value: crawl.totalErrors, color: "text-red-400", ring: "ring-red-500/20" },
    { label: "Warnings", value: crawl.totalWarnings, color: "text-amber-400", ring: "ring-amber-500/20" },
    { label: "Notices", value: crawl.totalNotices, color: "text-sky-400", ring: "ring-sky-500/20" },
    { label: "Pages", value: crawl.totalUrlsCrawled, color: "text-white", ring: "ring-zinc-500/20" },
  ];

  return (
    <div>
      <PageHeader
        title={crawl.targetUrl}
        subtitle={`${new Date(crawl.startedAt).toLocaleString()} · strategy ${crawl.strategy} · max depth ${crawl.maxDepthReached}`}
        actions={
          <Badge
            className={health ? "bg-emerald-500/12 text-emerald-300 border border-emerald-500/25" : "bg-red-500/12 text-red-300 border border-red-500/25"}
          >
            {health ? "✓ Healthy" : "✗ Blocking issues"}
          </Badge>
        }
      />

      {/* AEO + KPI band */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 mb-5">
        <Card className="p-5 flex items-center gap-5">
          <AeoDial score={crawl.averageAeoScore} />
          <div>
            <div className="text-[10px] text-faint uppercase tracking-wide">Answer Engine</div>
            <div className="text-xs text-muted mt-1 leading-relaxed">
              {crawl.averageAeoScore >= 90
                ? "Excellent — pages are well-optimized for AI answer engines."
                : crawl.averageAeoScore >= 70
                ? "Good — some pages lack direct-answer paragraphs or schema."
                : "Needs work — pages are hard for answer engines to extract."}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpis.map((kpi) => (
            <Card key={kpi.label} className={`p-4 ring-1 ${kpi.ring}`}>
              <div className={`text-2xl font-bold tabular-nums ${kpi.color}`}>{kpi.value}</div>
              <div className="text-[10px] text-faint uppercase tracking-wide mt-0.5">{kpi.label}</div>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Top issues</h2>
            {issues && issues.rows.length > 0 && (
              <a href="/issues" className="text-[11px] text-indigo-400 hover:text-indigo-300">
                View all →
              </a>
            )}
          </div>
          {issues && issues.rows.length > 0 ? (
            <div className="space-y-0.5">
              {issues.rows.map((issue) => (
                <a
                  key={issue.id}
                  href="/issues"
                  className="flex items-center gap-3 text-sm py-2 border-b border-border last:border-0 hover:bg-panel2/50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <Badge className={severityBg(issue.severity)}>{issue.severity}</Badge>
                  <span className="flex-1 truncate text-zinc-200" title={issue.name}>
                    {issue.name}
                  </span>
                  <span className="tabular-nums text-zinc-300">{issue.affectedPages}</span>
                  {issue.change !== 0 && (
                    <span
                      className={`text-[11px] tabular-nums w-12 text-right ${
                        issue.change > 0 ? "text-red-400" : "text-emerald-400"
                      }`}
                    >
                      {issue.change > 0 ? `+${issue.change}` : issue.change}
                    </span>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <EmptyState message="No issues detected — the site is clean." />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-3">Health trend</h2>
          {trend.length > 1 ? (
            <TrendChart data={trend} />
          ) : (
            <EmptyState message="No trend yet." hint="Run more crawls of the same site to build a history." />
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-4">Crawl facts</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
          <Fact
            label="Robots.txt"
            value={crawl.robotsAccessible ? "Accessible" : "Unreachable"}
            ok={crawl.robotsAccessible}
          />
          <Fact
            label="Sitemap"
            value={crawl.sitemapAccessible ? `${crawl.sitemapUrlCount} URLs` : "Unreachable"}
            ok={crawl.sitemapAccessible}
          />
          <Fact
            label="llms.txt"
            value={crawl.llmsTxtAccessible ? "Present" : "Not found"}
            ok={!!crawl.llmsTxtAccessible}
          />
          <Fact label="Issue groups" value={String(crawl.issueCount)} ok />
        </div>
      </Card>
    </div>
  );
}

function Fact({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-faint uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-medium mt-0.5 ${ok ? "text-emerald-400" : "text-amber-400"}`}>
        {ok ? "✓ " : "⚠ "}
        {value}
      </div>
    </div>
  );
}

function AeoDial({ score }: { score: number }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 90 ? "#34d399" : score >= 70 ? "#fbbf24" : "#f87171";
  return (
    <div className="relative shrink-0">
      <svg width="104" height="104" className="-rotate-90">
        <circle cx="52" cy="52" r={r} fill="none" stroke="#26262c" strokeWidth="8" />
        <circle
          cx="52"
          cy="52"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tabular-nums" style={{ color }}>
          {score}
        </span>
        <span className="text-[9px] text-faint uppercase tracking-wide">/ 100</span>
      </div>
    </div>
  );
}

function TrendChart({ data }: { data: any[] }) {
  const width = 520;
  const height = 150;
  const maxErrors = Math.max(...data.map((d) => d.errors + d.warnings), 1);
  const xStep = width / Math.max(data.length - 1, 1);

  const issuePoints = data.map((d, i) => ({
    x: i * xStep,
    y: height - ((d.errors + d.warnings) / maxErrors) * (height - 24),
  }));
  const aeoPoints = data.map((d, i) => ({
    x: i * xStep,
    y: height - (d.aeo / 100) * (height - 24),
  }));

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            y1={height * f}
            x2={width}
            y2={height * f}
            stroke="#26262c"
            strokeWidth={0.5}
          />
        ))}
        <polyline
          points={issuePoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="#f87171"
          strokeWidth={1.5}
        />
        <polyline
          points={aeoPoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="#34d399"
          strokeWidth={1.5}
        />
        {data.map((d, i) => (
          <circle
            key={d.crawlId}
            cx={i * xStep}
            cy={height - (d.aeo / 100) * (height - 24)}
            r={2.5}
            fill="#34d399"
          />
        ))}
      </svg>
      <div className="flex gap-4 text-[11px] text-muted mt-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-red-400" /> errors + warnings
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-emerald-400" /> AEO score
        </span>
      </div>
    </div>
  );
}
