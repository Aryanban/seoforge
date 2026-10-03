import React, { useState } from "react";
import { api, InspectResult, severityBg } from "../lib/api.js";
import { Card, Button, Input, Select, Badge, EmptyState, StatusDot } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";

export default function Inspect() {
  const [url, setUrl] = useState("");
  const [policy, setPolicy] = useState("strict");
  const [render, setRender] = useState(false);
  const [data, setData] = useState<InspectResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await api<InspectResult>("/api/inspect", {
        method: "POST",
        body: JSON.stringify({
          url: url.trim(),
          render,
          canonicalPolicy: policy,
        }),
      });
      setData(res);
    } catch (e: any) {
      setError(e.message || "Inspection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[1000px]">
      <PageHeader
        title="Inspect URL"
        subtitle="Real-time deep inspection of a single page — TTFB, canonical, meta, schema, Core Web Vitals, and AEO."
      />

      <Card className="p-4 mb-5">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Input
            value={url}
            onChange={setUrl}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="https://www.webforge.me/some-page"
            className="flex-1 min-w-[260px]"
          />
          <Select value={policy} onChange={setPolicy}>
            <option value="strict">canonical: strict</option>
            <option value="spa">canonical: SPA-tolerant</option>
          </Select>
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer px-1">
            <input
              type="checkbox"
              checked={render}
              onChange={(e) => setRender(e.target.checked)}
              className="accent-indigo-500"
            />
            Render
          </label>
          <Button variant="primary" onClick={run} disabled={loading || !url.trim()}>
            {loading ? "Inspecting…" : "Inspect"}
          </Button>
        </div>
        {error && <div className="text-err text-xs mt-3">⚠ {error}</div>}
      </Card>

      {!data && !loading && !error && (
        <EmptyState
          message="No URL inspected yet."
          hint="Paste a full URL above and press Inspect — no crawl required."
        />
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted">
          <div className="animate-spin h-5 w-5 border-2 border-border border-t-indigo-400 rounded-full mr-3" />
          Inspecting {url}…
        </div>
      )}

      {data && !loading && <InspectResult result={data} />}
    </div>
  );
}

function InspectResult({ result }: { result: InspectResult }) {
  const p = result.page;
  const v = p.coreWebVitals;

  const metrics = [
    { label: "Status", value: String(p.status), node: <StatusDot status={p.status} /> },
    { label: "TTFB", value: p.ttfbMs != null ? `${p.ttfbMs}ms` : "—" },
    { label: "Total time", value: `${p.responseTimeMs}ms` },
    { label: "Words", value: String(p.wordCount) },
    {
      label: "Canonical",
      value: p.canonicalMatches ? "matches" : "mismatch",
      ok: p.canonicalMatches,
    },
    { label: "Indexable", value: p.isIndexable ? "yes" : "no", ok: p.isIndexable },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* AEO hero */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
        <Card className="p-5 flex flex-col items-center justify-center">
          <AeoDial score={p.aeo.score} />
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {metrics.map((m) => (
            <Card key={m.label} className="p-3.5">
              <div className="text-[10px] text-faint uppercase tracking-wide mb-1">{m.label}</div>
              <div className="flex items-center text-sm font-medium">
                {m.node}
                <span className={m.ok === false ? "text-err" : m.ok === true ? "text-emerald-400" : ""}>
                  {m.value}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Core Web Vitals (render mode only) */}
      {v && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-3">Core Web Vitals</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Vital label="LCP" value={v.lcp} unit="s" good={1.2} needs={2.4} />
            <Vital label="INP" value={v.inp} unit="ms" good={200} needs={500} />
            <Vital label="CLS" value={v.cls} unit="" good={0.1} needs={0.25} />
            <Vital label="FCP" value={v.fcp} unit="s" good={1.8} needs={3} />
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Meta */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-3">Page meta</h2>
          <dl className="space-y-2.5 text-sm">
            <Meta label="Title" value={p.title} />
            <Meta label="Description" value={p.description} />
            <Meta label="H1" value={p.h1Text} />
            <Meta
              label="Canonical"
              value={p.canonical}
              hint={p.canonicalMatches ? "" : "does not match requested URL"}
            />
            <Meta label="Final URL" value={p.finalUrl && p.finalUrl !== p.url ? p.finalUrl : undefined} />
          </dl>
        </Card>

        {/* Schema */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-3">Structured data</h2>
          {p.schema.hasJsonLd ? (
            <>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {p.schema.typesFound.map((t) => (
                  <Badge key={t} className="bg-indigo-500/12 text-indigo-300 border border-indigo-500/25">
                    {t}
                  </Badge>
                ))}
              </div>
              {p.schema.missingExpected.length > 0 && (
                <div className="text-xs text-warn mb-2">
                  Missing expected entities: {p.schema.missingExpected.join(", ")}
                </div>
              )}
              {p.schema.errors.length > 0 && (
                <ul className="text-xs text-err space-y-1 list-disc pl-4">
                  {p.schema.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="text-muted text-sm">No JSON-LD structured data found on this page.</div>
          )}
        </Card>
      </div>

      {/* Issues */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3">
          Issues found <span className="text-muted font-normal">({result.issues.length})</span>
        </h2>
        {result.issues.length === 0 ? (
          <div className="text-emerald-400 text-sm flex items-center gap-2">
            <span>✓</span> No issues detected on this page.
          </div>
        ) : (
          <div className="space-y-1.5">
            {result.issues.map((i, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 py-2 border-b border-border last:border-0 last:pb-0"
              >
                <Badge className={severityBg(i.severity)}>{i.severity}</Badge>
                <span className="text-sm font-medium">{i.name}</span>
                <span className="text-xs text-muted flex-1 truncate" title={i.message}>
                  {i.message}
                </span>
                <span className="text-[10px] text-faint uppercase tracking-wide">{i.category}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function AeoDial({ score }: { score: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 90 ? "#34d399" : score >= 70 ? "#fbbf24" : "#f87171";
  return (
    <div className="relative">
      <svg width="120" height="120" className="-rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#26262c" strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold" style={{ color }}>
          {score}
        </span>
        <span className="text-[10px] text-faint uppercase tracking-wide">AEO</span>
      </div>
    </div>
  );
}

function Vital({
  label,
  value,
  unit,
  good,
  needs,
}: {
  label: string;
  value?: number;
  unit: string;
  good: number;
  needs: number;
}) {
  if (value == null)
    return (
      <div className="bg-panel2 border border-border rounded-lg p-3">
        <div className="text-[10px] text-faint uppercase tracking-wide">{label}</div>
        <div className="text-sm text-muted mt-1">n/a</div>
      </div>
    );
  const ok = value <= good;
  const mid = value <= needs;
  const color = ok ? "text-emerald-400" : mid ? "text-amber-400" : "text-red-400";
  return (
    <div className="bg-panel2 border border-border rounded-lg p-3">
      <div className="text-[10px] text-faint uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${color}`}>
        {unit === "s" ? (value / 1000).toFixed(2) : value}
        <span className="text-xs text-faint ml-0.5">{unit}</span>
      </div>
    </div>
  );
}

function Meta({ label, value, hint }: { label: string; value?: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[10px] text-faint uppercase tracking-wide">{label}</dt>
      <dd className={`text-sm break-words ${value ? "text-zinc-200" : "text-faint italic"}`}>
        {value || "—"}
        {hint && <span className="text-err text-xs ml-1.5">⚠ {hint}</span>}
      </dd>
    </div>
  );
}
