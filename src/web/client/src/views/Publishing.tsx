import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Card, Button, Badge, Input, Select, Spinner, EmptyState, PageHeader } from "../components/ui.js";

interface CatalogEntry {
  id: string;
  name: string;
  kind: string;
  topics: string[];
  review_status: string;
  cost_status: string;
  posting_url: string;
  website_url: string;
  sheet_dr_values: number[];
  sheet_dr_conflict: boolean;
}

interface PlanRow {
  id: string;
  business: string;
  website: string;
  selectedSources: number;
  createdAt: string;
}

export default function Publishing() {
  const [tab, setTab] = useState<"catalog" | "plan" | "saved">("catalog");
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("guidance_reviewed");
  const [kindFilter, setKindFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<PlanRow[]>([]);

  const [form, setForm] = useState({
    business: "",
    website: "",
    audience: "",
    topics: "",
    posts_per_week: "2",
    pages: "",
  });
  const [planResult, setPlanResult] = useState<any>(null);
  const [planError, setPlanError] = useState("");
  const [busy, setBusy] = useState(false);

  function loadCatalog() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (statusFilter) qs.set("status", statusFilter);
    if (kindFilter) qs.set("kind", kindFilter);
    qs.set("limit", "50");
    api<{ total: number; matching: number; entries: CatalogEntry[] }>(
      `/api/publish/catalog?${qs.toString()}`,
    )
      .then((r) => {
        setEntries(r.entries);
        setTotal(r.total);
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (tab === "catalog") loadCatalog();
    if (tab === "saved") {
      api<{ plans: PlanRow[] }>(`/api/publish/plans`).then((r) => setPlans(r.plans)).catch(() => setPlans([]));
    }
  }, [tab, statusFilter, kindFilter]);

  function parsePages(text: string): Array<{ url: string; topic: string }> {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [url, topic] = l.split("|").map((p) => p.trim());
        return { url: url ?? "", topic: topic ?? "" };
      })
      .filter((p) => p.url && p.topic);
  }

  async function buildPlan() {
    setBusy(true);
    setPlanError("");
    setPlanResult(null);
    try {
      const pages = parsePages(form.pages);
      if (pages.length === 0) throw new Error("Add at least one target page as 'url | topic' per line.");
      const body = {
        business: form.business,
        website: form.website,
        audience: form.audience,
        topics: form.topics.split(",").map((t) => t.trim()).filter(Boolean),
        posts_per_week: parseInt(form.posts_per_week, 10) || 2,
        pages,
        limit: 15,
      };
      const r = await api<{ planId: string; plan: any; markdown: string }>(`/api/publish/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setPlanResult(r);
    } catch (err: any) {
      setPlanError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Publishing & Backlinks"
        subtitle="206-source publishing catalog and tailored posting plans. Ported from BeyondSEO (MIT, Beyond Tahir)."
      />

      <div className="flex gap-2 mb-5">
        {(["catalog", "plan", "saved"] as const).map((t) => (
          <Button key={t} onClick={() => setTab(t)} variant={tab === t ? "primary" : "ghost"}>
            {t === "catalog" ? "Browse catalog" : t === "plan" ? "Build plan" : "Saved plans"}
          </Button>
        ))}
      </div>

      {tab === "catalog" && (
        <div>
          <div className="flex gap-3 mb-4 flex-wrap">
            <Select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="text-xs"
            >
              <option value="">All review statuses</option>
              <option value="guidance_reviewed">Guidance reviewed</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="closed">Closed</option>
              <option value="temporarily_unavailable">Temporarily unavailable</option>
            </Select>
            <Input
              placeholder="Filter by format (article, community…)"
              value={kindFilter}
              onChange={(e: any) => setKindFilter(e.target.value)}
              className="text-xs"
            />
          </div>
          <div className="text-xs text-muted mb-3">
            {total} entries in the catalog · showing {entries.length} · sheet DR values are unverified provenance, never a ranking signal.
          </div>
          {loading ? (
            <Spinner label="Loading catalog…" />
          ) : entries.length === 0 ? (
            <EmptyState message="No entries match these filters." />
          ) : (
            <Card hover>
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-panel2">
                    <tr className="text-left text-[10px] uppercase tracking-wide text-faint">
                      <th className="p-2.5">Site</th>
                      <th className="p-2.5">Format</th>
                      <th className="p-2.5">Topics</th>
                      <th className="p-2.5">Review</th>
                      <th className="p-2.5">Free terms</th>
                      <th className="p-2.5">Sheet DR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="border-b border-border hover:bg-panel2/50">
                        <td className="p-2.5">
                          <a href={e.website_url} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 text-xs">
                            {e.name}
                          </a>
                        </td>
                        <td className="p-2.5 text-xs text-muted">{e.kind}</td>
                        <td className="p-2.5 text-xs text-muted">{e.topics.join(", ")}</td>
                        <td className="p-2.5">
                          <Badge className={e.review_status === "guidance_reviewed" ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-400"}>
                            {e.review_status}
                          </Badge>
                        </td>
                        <td className="p-2.5 text-xs text-muted">{e.cost_status}</td>
                        <td className="p-2.5 text-xs tabular-nums text-muted">
                          {e.sheet_dr_values.join(", ")}
                          {e.sheet_dr_conflict ? " ⚠" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "plan" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-4">Business profile</h2>
            <div className="space-y-3">
              <Input placeholder="Business name *" value={form.business} onChange={(e: any) => setForm({ ...form, business: e.target.value })} />
              <Input placeholder="Website URL *" value={form.website} onChange={(e: any) => setForm({ ...form, website: e.target.value })} />
              <Input placeholder="Audience *" value={form.audience} onChange={(e: any) => setForm({ ...form, audience: e.target.value })} />
              <Input placeholder="Topics, comma-separated (technology, business…)" value={form.topics} onChange={(e: any) => setForm({ ...form, topics: e.target.value })} />
              <Input placeholder="Posts per week (1-7)" value={form.posts_per_week} onChange={(e: any) => setForm({ ...form, posts_per_week: e.target.value })} />
              <div>
                <div className="text-[10px] uppercase tracking-wide text-faint mb-1">Target pages (one per line: url | topic)</div>
                <textarea
                  className="w-full bg-bg border border-border rounded-md p-2 text-xs text-white font-mono h-24"
                  placeholder={"https://example.com/guide | AI automation\nhttps://example.com/about | company background"}
                  value={form.pages}
                  onChange={(e) => setForm({ ...form, pages: e.target.value })}
                />
              </div>
              <Button onClick={buildPlan} variant="primary" disabled={busy}>
                {busy ? "Building…" : "Build posting plan"}
              </Button>
              {planError && <div className="text-xs text-red-400">{planError}</div>}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold mb-4">Result</h2>
            {!planResult ? (
              <EmptyState message="Build a plan to see the prioritized shortlist." />
            ) : (
              <div>
                <div className="flex gap-3 mb-4 text-xs">
                  <Badge className="bg-emerald-500/15 text-emerald-300">
                    {planResult.plan.selected_sources} selected
                  </Badge>
                  {planResult.plan.shortfall > 0 && (
                    <Badge className="bg-amber-500/15 text-amber-300">
                      {planResult.plan.shortfall} more needed
                    </Badge>
                  )}
                  <span className="text-muted">id: {planResult.planId}</span>
                </div>
                <div className="space-y-3 max-h-[460px] overflow-auto pr-1">
                  {planResult.plan.tasks.map((t: any) => (
                    <div key={t.position} className="border border-border rounded-md p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold tabular-nums text-muted">{t.position}.</span>
                        <a href={t.posting_url} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 text-xs font-semibold">
                          {t.website}
                        </a>
                        <Badge className="bg-zinc-500/15 text-zinc-400">{t.format}</Badge>
                      </div>
                      <div className="text-xs text-white mb-1">{t.suggested_title_or_action}</div>
                      <div className="text-[10px] text-muted">
                        Target: {t.target_page} · Week {t.suggested_week} ({t.suggested_date}) · {t.cost_status}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "saved" && (
        <Card hover>
          <div className="p-4 border-b border-border">
            <span className="text-sm font-semibold">Saved plans</span>
          </div>
          {plans.length === 0 ? (
            <EmptyState message="No saved plans yet." />
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm">
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} className="border-b border-border hover:bg-panel2/50">
                      <td className="p-2.5 text-xs text-white">{p.business}</td>
                      <td className="p-2.5 text-xs text-muted truncate">{p.website}</td>
                      <td className="p-2.5 text-xs tabular-nums text-muted">{p.selectedSources} sources</td>
                      <td className="p-2.5 text-xs text-faint tabular-nums">{p.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
