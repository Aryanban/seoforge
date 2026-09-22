import React, { useEffect, useState } from "react";
import { api, CrawlSummary } from "../lib/api.js";
import { Card, Button, Spinner } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";

const EXPORTS = [
  {
    kind: "md",
    label: "Markdown report",
    desc: "Full audit report — issue tables, per-page metrics, recommendations.",
    icon: "M6 2h12v20l-3-2-3 2-3-2-3 2V2Z",
    action: "Open",
  },
  {
    kind: "html",
    label: "HTML report",
    desc: "Self-contained, shareable interactive report — send it to anyone.",
    icon: "M3 3h18v14H3V3Zm0 16h18v2H3v-2Z",
    action: "Open",
  },
  {
    kind: "csv-pages",
    label: "CSV — pages",
    desc: "One row per crawled page with every collected metric.",
    icon: "M4 4h16v4H4V4Zm0 6h16v4H4v-4Zm0 6h16v4H4v-4Z",
    action: "Download",
  },
  {
    kind: "csv-issues",
    label: "CSV — issues",
    desc: "One row per page-level issue — for bulk spreadsheet triage.",
    icon: "M12 3 2 21h20L12 3Zm1 6v6h-2V9h2Zm-1 9.5a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z",
    action: "Download",
  },
  {
    kind: "csv-links",
    label: "CSV — links",
    desc: "Internal + external link graph with statuses and flags.",
    icon: "M7 7h6v6h4V7h-4V5h6v4h-2v6h-6v-2H7v6H5v-8h2V7Z",
    action: "Download",
  },
  {
    kind: "csv-recommendations",
    label: "CSV — recommendations",
    desc: "Prioritized fix backlog for ticketing (Linear, Jira, GitHub).",
    icon: "m12 2 2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2Z",
    action: "Download",
  },
];

export default function Reports({ crawlId }: { crawlId: string }) {
  const [crawl, setCrawl] = useState<CrawlSummary | null>(null);

  useEffect(() => {
    api<CrawlSummary>(`/api/crawl/${crawlId}`).then(setCrawl).catch(() => setCrawl(null));
  }, [crawlId]);

  if (!crawl) return <Spinner label="Loading crawl…" />;

  const open = (kind: string) => {
    window.open(`/api/crawl/${crawlId}/export/${kind}`, "_blank");
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Export the crawl for sharing, spreadsheets, or ticketing. Files are generated on demand."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {EXPORTS.map((e) => (
          <Card key={e.kind} hover className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 shrink-0 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4.5 h-4.5 text-indigo-300">
                <path d={e.icon} />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{e.label}</div>
              <div className="text-muted text-xs mt-0.5">{e.desc}</div>
            </div>
            <Button variant="primary" size="sm" onClick={() => open(e.kind.replace("csv-", ""))}>
              {e.action}
            </Button>
          </Card>
        ))}
      </div>

      <Card className="p-4 mt-4">
        <div className="text-xs text-muted">
          <span className="text-zinc-300 font-medium">Tip:</span> for the full AI fix backlog with
          every affected URL (no 20-URL cap), run in a terminal:
          <code className="ml-1.5 bg-panel3 border border-border px-1.5 py-0.5 rounded text-[11px]">
            seoforge export backlog --all-urls
          </code>
        </div>
      </Card>
    </div>
  );
}
