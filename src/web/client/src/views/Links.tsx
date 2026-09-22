import React, { useEffect, useState } from "react";
import { api, PagedResult, LinkRow } from "../lib/api.js";
import { Card, Badge, Input, Spinner, EmptyState, StatusDot, Tabs } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";
import { Pager } from "./Issues.js";

type Kind = "broken" | "internal" | "external" | "redirects";

export default function Links({ crawlId }: { crawlId: string }) {
  const [data, setData] = useState<PagedResult<LinkRow> | null>(null);
  const [kind, setKind] = useState<Kind>("broken");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    setPage(1);
  }, [kind, search]);

  useEffect(() => {
    const q = new URLSearchParams({ kind, page: String(page), pageSize: String(pageSize) });
    if (search) q.set("search", search);
    api<PagedResult<LinkRow>>(`/api/crawl/${crawlId}/links?${q.toString()}`)
      .then(setData)
      .catch(() => setData(null));
  }, [crawlId, kind, search, page]);

  if (!data) return <Spinner label="Loading links…" />;

  const tabs: { id: Kind; label: string }[] = [
    { id: "broken", label: "Broken" },
    { id: "internal", label: "Internal" },
    { id: "external", label: "External" },
    { id: "redirects", label: "Redirects" },
  ];

  return (
    <div>
      <PageHeader
        title="Links"
        subtitle={`${data.total} ${kind} link${data.total === 1 ? "" : "s"} in the link graph`}
        actions={
          <div className="flex items-center gap-2">
            <Tabs tabs={tabs} value={kind} onChange={setKind} />
            <Input value={search} onChange={setSearch} placeholder="Filter…" className="w-40" />
          </div>
        }
      />

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState
            message={kind === "broken" ? "No broken links found." : "No links match the current filters."}
            hint={kind === "broken" ? "The site's internal and external links all resolve." : undefined}
          />
        </Card>
      ) : (
        <Card hover>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-faint uppercase tracking-wide border-b border-border whitespace-nowrap">
                  <th className="text-left p-3 font-medium">From</th>
                  <th className="text-left p-3 font-medium">To</th>
                  <th className="text-left p-3 font-medium">Anchor text</th>
                  <th className="text-left p-3 font-medium">Type</th>
                  <th className="text-right p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((l, i) => (
                  <tr key={i} className="border-b border-border hover:bg-panel2/50 transition-colors">
                    <td className="p-3 max-w-[220px] truncate text-xs text-zinc-400">{l.source}</td>
                    <td className="p-3 max-w-[260px] truncate">
                      <a
                        href={l.target}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-400 hover:text-sky-300 text-xs transition-colors"
                      >
                        {l.target}
                      </a>
                    </td>
                    <td className="p-3 text-xs text-muted max-w-[180px] truncate italic">
                      {l.anchorText || "(empty)"}
                    </td>
                    <td className="p-3 text-xs text-zinc-400">{l.isInternal ? "internal" : "external"}</td>
                    <td className="p-3 text-right whitespace-nowrap tabular-nums">
                      <StatusDot status={l.targetStatus} />
                      {l.targetStatus || "—"}
                    </td>
                    <td className="p-3 space-x-1">
                      {l.isBroken && (
                        <Badge className="bg-red-500/12 text-red-300 border border-red-500/25">broken</Badge>
                      )}
                      {l.isRedirect && (
                        <Badge className="bg-amber-500/12 text-amber-300 border border-amber-500/25">
                          redirect
                        </Badge>
                      )}
                      {l.nofollow && (
                        <Badge className="bg-zinc-500/12 text-zinc-400 border border-zinc-500/25">
                          nofollow
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Pager page={page} total={data.total} pageSize={pageSize} onChange={setPage} />
    </div>
  );
}
