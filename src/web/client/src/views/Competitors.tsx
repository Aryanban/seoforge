import React, { useEffect, useState } from "react";
import { api, CrawlSummary } from "../lib/api.js";
import { Card, Button, Badge, EmptyState, PageHeader } from "../components/ui.js";
interface ComparisonRow {
  id: string;
  baselineUrl: string;
  competitorUrls: string[];
  createdAt: string;
}

export default function Competitors({ crawlId }: { crawlId: string }) {
  const [crawls, setCrawls] = useState<CrawlSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ComparisonRow[]>([]);

  useEffect(() => {
    api<{ crawls: CrawlSummary[] }>(`/api/crawls?limit=30`)
      .then((r) => setCrawls(r.crawls ?? []))
      .catch(() => setCrawls([]));
    api<{ comparisons: ComparisonRow[] }>(`/api/competitors`)
      .then((r) => setHistory(r.comparisons))
      .catch(() => setHistory([]));
  }, [result]);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(0, 5)));
  }

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      if (selected.length === 0) throw new Error("Select at least one competitor crawl.");
      const r = await api<{ comparisonId: string; comparison: any }>(`/api/competitors/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crawl_id: crawlId || undefined, competitor_crawl_ids: selected }),
      });
      setResult(r);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  const comparison = result?.comparison;

  return (
    <div>
      <PageHeader
        title="Competitors"
        subtitle="Gap analysis on measured crawl evidence (AEO, issues, depth, schema, links) — not search rankings. Same rules for every site."
      />

      <Card className="p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Pick competitor crawls</h2>
          <span className="text-[10px] text-faint">select 1–5</span>
        </div>
        {crawls.length === 0 ? (
          <EmptyState message="No crawls available yet. Run `seoforge crawl <url>` for each competitor first." />
        ) : (
          <div className="max-h-[280px] overflow-auto space-y-1">
            {crawls.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-panel2/50 cursor-pointer border border-transparent has-[:checked]:border-sky-500/40 has-[:checked]:bg-sky-500/5"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                  className="accent-sky-500"
                />
                <span className="text-xs text-white truncate flex-1">{c.targetUrl}</span>
                <span className="text-[10px] text-faint tabular-nums">{c.totalUrlsCrawled} pages</span>
                <span className="text-[10px] text-faint tabular-nums">AEO {c.averageAeoScore ?? 0}</span>
              </label>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={run} variant="primary" disabled={busy || selected.length === 0}>
            {busy ? "Comparing…" : `Compare ${selected.length} competitor${selected.length === 1 ? "" : "s"}`}
          </Button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </Card>

      {comparison && (
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <h2 className="text-sm font-semibold">Metric matrix</h2>
              <Badge className={comparison.budgetComparable ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}>
                {comparison.budgetComparable ? "budgets comparable" : "budgets NOT comparable"}
              </Badge>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-faint">
                    <th className="p-2.5">Metric</th>
                    <th className="p-2.5 text-sky-300">{comparison.baselineUrl}</th>
                    {comparison.competitorUrls.map((u: string) => (
                      <th key={u} className="p-2.5 text-muted">
                        {u}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.metrics.map((m: any) => (
                    <tr key={m.key} className="border-b border-border">
                      <td className="p-2.5 text-xs text-white">{m.label}</td>
                      <td className="p-2.5 text-xs font-bold tabular-nums text-sky-300">
                        {m.baseline === null ? "n/a" : m.baseline}
                        <span className="text-faint font-normal">{m.unit}</span>
                      </td>
                      {m.competitors.map((v: number | null, i: number) => {
                        const leading = v !== null && (m.direction === "higher" ? v > (m.baseline ?? -Infinity) : v < (m.baseline ?? Infinity));
                        return (
                          <td key={i} className={`p-2.5 text-xs tabular-nums ${leading ? "text-emerald-300" : "text-muted"}`}>
                            {v === null ? "n/a" : v}
                            <span className="text-faint">{m.unit}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {comparison.strengths.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold mb-3">Where the baseline leads</h2>
              <ul className="space-y-1">
                {comparison.strengths.map((s: string) => (
                  <li key={s} className="text-xs text-emerald-300">
                    ✓ {s}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {comparison.gaps.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold mb-3">Prioritized gaps</h2>
              <div className="space-y-4">
                {comparison.gaps.map((g: any, i: number) => (
                  <div key={i} className="border-l-2 border-amber-500/40 pl-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-white">{g.label}</span>
                      <Badge className="bg-amber-500/15 text-amber-300">{g.severity}</Badge>
                    </div>
                    <div className="text-[10px] text-muted mb-1">
                      behind {g.competitor} by {g.shortfall} (baseline {g.baselineValue} vs {g.competitorValue})
                    </div>
                    <div className="text-xs text-muted">{g.recommendation}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-3">Limits</h2>
            <ul className="space-y-1">
              {comparison.limitations.map((l: string, i: number) => (
                <li key={i} className="text-xs text-faint">
                  · {l}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {history.length > 0 && !comparison && (
        <Card hover>
          <div className="p-4 border-b border-border">
            <span className="text-sm font-semibold">Comparison history</span>
          </div>
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-sm">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-border hover:bg-panel2/50">
                    <td className="p-2.5 text-xs text-white truncate">{h.baselineUrl}</td>
                    <td className="p-2.5 text-xs text-muted truncate">{h.competitorUrls.join(", ")}</td>
                    <td className="p-2.5 text-xs text-faint">{h.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
