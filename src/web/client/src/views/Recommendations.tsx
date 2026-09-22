import React, { useEffect, useState } from "react";
import { api, RecommendationRow, priorityClass } from "../lib/api.js";
import { Card, Badge, Spinner, EmptyState, Tabs } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";
import Markdown from "../components/Markdown.js";

type Priority = "all" | "Critical" | "High" | "Medium" | "Low";

export default function Recommendations({ crawlId }: { crawlId: string }) {
  const [recs, setRecs] = useState<RecommendationRow[] | null>(null);
  const [filter, setFilter] = useState<Priority>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api<RecommendationRow[]>(`/api/crawl/${crawlId}/recommendations`)
      .then(setRecs)
      .catch(() => setRecs([]));
  }, [crawlId]);

  if (!recs) return <Spinner label="Loading recommendations…" />;

  const counts = {
    Critical: recs.filter((r) => r.priority === "Critical").length,
    High: recs.filter((r) => r.priority === "High").length,
    Medium: recs.filter((r) => r.priority === "Medium").length,
    Low: recs.filter((r) => r.priority === "Low").length,
  };

  const tabs: { id: Priority; label: string }[] = [
    { id: "all", label: `All ${recs.length}` },
    { id: "Critical", label: `Critical ${counts.Critical}` },
    { id: "High", label: `High ${counts.High}` },
    { id: "Medium", label: `Medium ${counts.Medium}` },
    { id: "Low", label: `Low ${counts.Low}` },
  ];

  const filtered = filter === "all" ? recs : recs.filter((r) => r.priority === filter);

  const copy = (rec: RecommendationRow) => {
    navigator.clipboard.writeText(rec.markdown);
    setCopied(rec.id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div>
      <PageHeader
        title="AI Fixes"
        subtitle="Deterministic, ready-to-paste fix documents for every issue — why it matters, steps, and before/after."
        actions={<Tabs tabs={tabs} value={filter} onChange={setFilter} />}
      />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState message="No recommendations at this priority." hint="The audited pages are clean." />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((rec) => (
            <Card key={rec.id} hover className="overflow-hidden">
              <div
                className="p-4 flex items-center gap-3 cursor-pointer hover:bg-panel2/40 transition-colors"
                onClick={() => setExpanded(expanded === rec.id ? null : rec.id)}
              >
                <Badge className={priorityClass(rec.priority)}>{rec.priority}</Badge>
                <span className="flex-1 font-medium text-sm text-zinc-200 truncate">{rec.name}</span>
                <span className="text-xs text-muted tabular-nums whitespace-nowrap">
                  {rec.affectedPages} page{rec.affectedPages === 1 ? "" : "s"}
                </span>
                <Badge className="bg-zinc-500/12 text-zinc-400 border border-zinc-500/25">
                  effort {rec.effort}
                </Badge>
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className={`w-3.5 h-3.5 text-faint transition-transform duration-200 ${
                    expanded === rec.id ? "rotate-90" : ""
                  }`}
                >
                  <path d="M8 5l8 7-8 7V5Z" />
                </svg>
              </div>
              {expanded === rec.id && (
                <div className="px-4 pb-4 border-t border-border pt-3.5 animate-fade-in">
                  <Markdown source={rec.markdown} />
                  <button
                    onClick={() => copy(rec)}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    {copied === rec.id ? "✓ Copied" : "⧉ Copy fix doc as markdown"}
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
