import React, { useEffect, useState } from "react";
import { api, PagedResult, PageRow, severityBg } from "../lib/api.js";
import { Card, Badge, Input, Select, Spinner, EmptyState, StatusDot } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";
import { Pager } from "./Issues.js";

export default function Pages({ crawlId }: { crawlId: string }) {
  const [data, setData] = useState<PagedResult<PageRow> | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pageSize = 50;

  useEffect(() => {
    setPage(1);
  }, [search, status]);

  useEffect(() => {
    const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) q.set("search", search);
    if (status !== "all") q.set("status", status);
    api<PagedResult<PageRow>>(`/api/crawl/${crawlId}/pages?${q.toString()}`)
      .then((r) => setData(r as any))
      .catch(() => setData(null));
  }, [crawlId, search, status, page]);

  if (!data) return <Spinner label="Loading pages…" />;

  return (
    <div>
      <PageHeader
        title="Pages"
        subtitle={`${data.total} page${data.total === 1 ? "" : "s"} crawled · click a row for full audit detail`}
        actions={
          <div className="flex items-center gap-2">
            <Select value={status} onChange={setStatus}>
              <option value="all">All statuses</option>
              <option value="ok">200 OK</option>
              <option value="redirect">Redirects</option>
              <option value="broken">Broken (4XX/5XX)</option>
            </Select>
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Filter by URL or title…"
              className="w-52"
            />
          </div>
        }
      />

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState message="No pages match the current filters." />
        </Card>
      ) : (
        <Card hover>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-faint uppercase tracking-wide border-b border-border whitespace-nowrap">
                  <th className="text-left p-3 font-medium">URL</th>
                  <th className="text-right p-3 font-medium">Status</th>
                  <th className="text-right p-3 font-medium">Depth</th>
                  <th className="text-right p-3 font-medium">TTFB</th>
                  <th className="text-right p-3 font-medium">Words</th>
                  <th className="text-right p-3 font-medium">Links in/out</th>
                  <th className="text-right p-3 font-medium">AEO</th>
                  <th className="text-left p-3 font-medium">Schema</th>
                  <th className="text-right p-3 font-medium">Issues</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => (
                  <React.Fragment key={p.normalizedUrl}>
                    <tr
                      className="border-b border-border hover:bg-panel2/50 cursor-pointer transition-colors"
                      onClick={() => setExpanded(expanded === p.normalizedUrl ? null : p.normalizedUrl)}
                    >
                      <td className="p-3 max-w-xs truncate">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:text-sky-300 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {p.url}
                        </a>
                        {p.isOrphan && (
                          <Badge className="ml-2 bg-red-500/12 text-red-300 border border-red-500/25">
                            orphan
                          </Badge>
                        )}
                        {!p.isIndexable && (
                          <Badge className="ml-2 bg-zinc-500/12 text-zinc-400 border border-zinc-500/25">
                            noindex
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap tabular-nums">
                        <StatusDot status={p.status} />
                        {p.status}
                      </td>
                      <td className="p-3 text-right tabular-nums">{p.depth}</td>
                      <td className="p-3 text-right tabular-nums whitespace-nowrap">
                        {p.ttfbMs ?? p.responseTimeMs}ms
                      </td>
                      <td className="p-3 text-right tabular-nums">{p.wordCount}</td>
                      <td className="p-3 text-right tabular-nums whitespace-nowrap">
                        {p.incomingLinks}/{p.outgoingLinks}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        <span className={p.aeoScore >= 70 ? "text-emerald-400" : "text-amber-400"}>
                          {p.aeoScore}
                        </span>
                      </td>
                      <td className="p-3 text-muted text-xs max-w-[180px] truncate">
                        {p.schemaTypes.join(", ") || "—"}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {(p.auditIssues?.length ?? 0) > 0 ? (
                          <span className="text-amber-400">{p.auditIssues.length}</span>
                        ) : (
                          <span className="text-faint">0</span>
                        )}
                      </td>
                    </tr>
                    {expanded === p.normalizedUrl && <PageDetail page={p} />}
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

function PageDetail({ page }: { page: PageRow }) {
  const rows = [
    { label: "Title", value: page.title },
    { label: "Description", value: page.description },
    { label: "H1", value: page.h1Text },
    { label: "Canonical", value: page.canonical },
    {
      label: "Canonical match",
      value: page.canonicalMatches ? "✓ matches requested URL" : "⚠ does not match requested URL",
    },
    {
      label: "Internal link score",
      value: `${page.internalLinkScore.toFixed(2)} · ${page.incomingLinks} incoming`,
    },
    {
      label: "Indexability",
      value: page.isIndexable ? "indexable" : "blocked (noindex / robots)",
    },
  ];

  return (
    <tr className="bg-panel2/40">
      <td colSpan={9} className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <div className="text-[10px] text-faint uppercase tracking-wide mb-2">Page detail</div>
            <dl className="space-y-2">
              {rows.map((r) => (
                <div key={r.label}>
                  <dt className="text-[10px] text-faint uppercase tracking-wide">{r.label}</dt>
                  <dd
                    className={`text-xs break-words ${
                      r.value?.startsWith("⚠")
                        ? "text-amber-400"
                        : r.value
                        ? "text-zinc-300"
                        : "text-faint italic"
                    }`}
                  >
                    {r.value || "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <div className="text-[10px] text-faint uppercase tracking-wide mb-2">
              Issues on this page ({page.auditIssues?.length ?? 0})
            </div>
            {page.auditIssues && page.auditIssues.length > 0 ? (
              <div className="space-y-1">
                {page.auditIssues.map((i: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 text-xs py-1">
                    <Badge className={severityBg(i.severity)}>{i.severity}</Badge>
                    <span className="text-zinc-300">{i.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-emerald-400 text-xs flex items-center gap-1.5">
                <span>✓</span> No issues on this page.
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
