import React, { useEffect, useState } from "react";
import { api, PagedResult, IssueRow, severityBg } from "../lib/api.js";
import { Card, Badge, Input, Select, Spinner, EmptyState, Button } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";

export default function Issues({ crawlId }: { crawlId: string }) {
  const [data, setData] = useState<PagedResult<IssueRow> | null>(null);
  const [severity, setSeverity] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    setPage(1);
  }, [severity, search]);

  useEffect(() => {
    const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (severity !== "all") q.set("severity", severity);
    if (search) q.set("search", search);
    api<PagedResult<IssueRow>>(`/api/crawl/${crawlId}/issues?${q.toString()}`)
      .then(setData)
      .catch(() => setData(null));
  }, [crawlId, severity, search, page]);

  if (!data) return <Spinner label="Loading issues…" />;

  return (
    <div>
      <PageHeader
        title="Issues"
        subtitle={`${data.total} distinct issue type${data.total === 1 ? "" : "s"} found across the crawl`}
        actions={
          <div className="flex items-center gap-2">
            <Select value={severity} onChange={setSeverity}>
              <option value="all">All severities</option>
              <option value="Error">Errors</option>
              <option value="Warning">Warnings</option>
              <option value="Notice">Notices</option>
            </Select>
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Filter issues…"
              className="w-44"
            />
          </div>
        }
      />

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState message="No issues match the current filters." hint="Try clearing the search or severity filter." />
        </Card>
      ) : (
        <Card hover>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-faint uppercase tracking-wide border-b border-border">
                  <th className="text-left p-3 font-medium">Issue</th>
                  <th className="text-left p-3 font-medium">Severity</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-right p-3 font-medium">Affected</th>
                  <th className="text-right p-3 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((issue) => (
                  <React.Fragment key={`${issue.id}-${issue.name}`}>
                    <tr
                      className="border-b border-border hover:bg-panel2/50 cursor-pointer transition-colors"
                      onClick={() => setExpanded(expanded === issue.name ? null : issue.name)}
                    >
                      <td className="p-3 font-medium text-zinc-200">{issue.name}</td>
                      <td className="p-3">
                        <Badge className={severityBg(issue.severity)}>{issue.severity}</Badge>
                      </td>
                      <td className="p-3 text-muted text-xs">{issue.category}</td>
                      <td className="p-3 text-right tabular-nums">{issue.affectedPages}</td>
                      <td className="p-3 text-right tabular-nums">
                        {issue.change === 0 ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className={issue.change > 0 ? "text-red-400" : "text-emerald-400"}>
                            {issue.change > 0 ? `+${issue.change}` : issue.change}
                          </span>
                        )}
                      </td>
                    </tr>
                    {expanded === issue.name && (
                      <tr className="bg-panel2/40">
                        <td colSpan={5} className="p-4">
                          <div className="text-xs text-muted mb-3 max-w-3xl">{issue.recommendation}</div>
                          <div className="text-[10px] text-faint uppercase tracking-wide mb-1.5">
                            Affected URLs
                          </div>
                          <div className="space-y-0.5">
                            {issue.affectedUrls.slice(0, 15).map((u) => (
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
                            {issue.affectedUrls.length > 15 && (
                              <div className="text-faint text-xs pt-1">
                                …and {issue.affectedUrls.length - 15} more — export the full report
                                from <a href="/reports" className="text-indigo-400 hover:underline">Reports</a> for every URL
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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

export function Pager({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-muted mt-4">
      <Button size="sm" onClick={() => onChange(page - 1)} disabled={page === 1}>
        ← Prev
      </Button>
      <span className="tabular-nums">
        Page {page} of {pages}
      </span>
      <Button size="sm" onClick={() => onChange(page + 1)} disabled={page === pages}>
        Next →
      </Button>
    </div>
  );
}
