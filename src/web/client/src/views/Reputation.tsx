import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Card, Button, Badge, Input, EmptyState, PageHeader } from "../components/ui.js";

interface AssessmentRow {
  id: string;
  target: string;
  brand: string;
  score: number | null;
  scoreStatus: string;
  confidence: string;
  sourcesChecked: number;
  createdAt: string;
}

function ScoreBadge({ result }: { result: any }) {
  const score = result.score;
  const tone =
    score === null
      ? "bg-zinc-500/15 text-zinc-300"
      : score >= 50
        ? "bg-emerald-500/15 text-emerald-300"
        : "bg-amber-500/15 text-amber-300";
  return (
    <div className="flex items-baseline gap-3">
      <span className={`text-4xl font-bold tabular-nums ${tone.replace("bg-", "text-").replace("/15", "")}`}>
        {score === null ? "withheld" : score}
      </span>
      {score !== null && <span className="text-sm text-faint">/ 100</span>}
      <Badge className={tone}>{result.score_status}</Badge>
    </div>
  );
}

export default function Reputation() {
  const [form, setForm] = useState({
    target: "",
    brand: "",
    sources: "",
    aliases: "",
  });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);

  useEffect(() => {
    api<{ assessments: AssessmentRow[] }>(`/api/reputation`)
      .then((r) => setAssessments(r.assessments))
      .catch(() => setAssessments([]));
  }, [result]);

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const sources = form.sources.split("\n").map((s) => s.trim()).filter(Boolean);
      if (!form.target || !form.brand) throw new Error("Target URL and brand are required.");
      if (sources.length === 0) throw new Error("Add at least one candidate source URL.");
      const r = await api<{ assessmentId: string; result: any; markdown: string }>(`/api/reputation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_url: form.target,
          brand: form.brand,
          sources,
          aliases: form.aliases.split(",").map((a) => a.trim()).filter(Boolean),
          limit: 50,
        }),
      });
      setResult(r);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Reputation"
        subtitle="Verify candidate backlink/mention sources and score them under model 1.1 — conservative: unknown evidence is never inflated, low-confidence headlines cap at 49/100."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-4">Verify sources</h2>
          <div className="space-y-3">
            <Input placeholder="Your site URL *" value={form.target} onChange={(e: any) => setForm({ ...form, target: e.target.value })} />
            <Input placeholder="Brand name *" value={form.brand} onChange={(e: any) => setForm({ ...form, brand: e.target.value })} />
            <Input placeholder="Brand aliases (comma-separated)" value={form.aliases} onChange={(e: any) => setForm({ ...form, aliases: e.target.value })} />
            <div>
              <div className="text-[10px] uppercase tracking-wide text-faint mb-1">Candidate source URLs (one per line)</div>
              <textarea
                className="w-full bg-bg border border-border rounded-md p-2 text-xs text-white font-mono h-28"
                placeholder={"https://en.wikipedia.org/wiki/Example.com\nhttps://news.example.com/article"}
                value={form.sources}
                onChange={(e) => setForm({ ...form, sources: e.target.value })}
              />
            </div>
            <Button onClick={run} variant="primary" disabled={busy}>
              {busy ? "Verifying…" : "Verify & score"}
            </Button>
            {error && <div className="text-xs text-red-400">{error}</div>}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-4">Assessment</h2>
          {!result ? (
            <EmptyState message="Run a verification to see the score." />
          ) : (
            <div className="space-y-4">
              <ScoreBadge result={result.result} />
              <div className="text-xs text-muted">
                Sensitivity range:{" "}
                <span className="text-white tabular-nums">
                  {result.result.score_range ? result.result.score_range.join(" – ") : "withheld"}
                </span>{" "}
                · confidence: <span className="text-white">{result.result.confidence}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Observed links" value={result.result.observed_link_pages} />
                <Stat label="Brand mentions" value={result.result.observed_mention_pages} />
                <Stat label="Sources checked" value={result.result.coverage.sources_checked} />
                <Stat label="Evidence factor" value={result.result.evidence_adjustment.factor} />
              </div>
              <div className="text-[10px] text-faint">
                Limits: {result.result.evidence_adjustment.limiting_factors.join(", ") || "none within the recorded sample"}
              </div>
              {result.result.top_backlinks.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-faint mb-1">Strongest observed backlinks</div>
                  {result.result.top_backlinks.slice(0, 5).map((s: any) => (
                    <a
                      key={s.source_url}
                      href={s.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sky-400 hover:text-sky-300 text-xs truncate"
                    >
                      {s.source_url} — {s.supported_quality_points}/100 pts
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card hover>
        <div className="p-4 border-b border-border">
          <span className="text-sm font-semibold">Assessment history</span>
        </div>
        {assessments.length === 0 ? (
          <EmptyState message="No assessments yet." />
        ) : (
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-sm">
              <tbody>
                {assessments.map((a) => (
                  <tr key={a.id} className="border-b border-border hover:bg-panel2/50">
                    <td className="p-2.5 text-xs text-white tabular-nums w-20">
                      {a.score === null ? "—" : a.score}
                    </td>
                    <td className="p-2.5 text-xs text-muted truncate">{a.target}</td>
                    <td className="p-2.5 text-xs text-muted">{a.brand}</td>
                    <td className="p-2.5 text-xs text-muted">{a.sourcesChecked} checked</td>
                    <td className="p-2.5 text-xs text-faint">{a.confidence}</td>
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

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-panel2/50 rounded-md p-2.5">
      <div className="text-lg font-bold tabular-nums text-white">{value}</div>
      <div className="text-[10px] text-faint uppercase tracking-wide">{label}</div>
    </div>
  );
}
