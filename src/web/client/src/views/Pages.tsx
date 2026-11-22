import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi, PagedResult, PageRow, severityBg, safeHref } from "../lib/api.js";
import { Card, Badge, Input, Select, Spinner, EmptyState, ErrorState, StatusDot, Button } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";
import { Pager } from "./Issues.js";

/** Filters that come from Overview chart links (shown as removable chips). */
const CHIP_KEYS: Record<string, (v: string) => string> = {
  depth: (v) => `Depth ${v === "10" ? "10+" : v}`,
  indexable: (v) => (v === "1" ? "Indexable" : "Non-indexable"),
  orphan: () => "Orphan pages",
};

export default function Pages({ crawlId }: { crawlId: string }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pageSize = 50;
  const status = params.get("status") ?? "all";
  const sort = params.get("sort") ?? "";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "" || value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const toggleSort = (col: string) => {
    const next = new URLSearchParams(params);
    if (sort === col && dir === "desc") {
      next.set("dir", "asc");
    } else if (sort === col) {
      next.delete("sort");
      next.delete("dir");
    } else {
      next.set("sort", col);
      next.set("dir", "desc");
    }
    setParams(next, { replace: true });
  };

  useEffect(() => {
    setPage(1);
  }, [search, params]);

  const q = new URLSearchParams(params);
  q.delete("q");
  q.set("page", String(page));
  q.set("pageSize", String(pageSize));
  if (search) q.set("search", search);
  // Aborts the superseded request: no stale page/filter response can overwrite the current one.
  const { data, error } = useApi<PagedResult<PageRow>>(`/api/crawl/${crawlId}/pages?${q.toString()}`);

  if (!data) return error ? <ErrorState message={error} /> : <Spinner label="Loading pages…" />;

  const chips = Object.keys(CHIP_KEYS).filter((k) => params.get(k));
  const Th = ({ col, label, align = "right" }: { col?: string; label: string; align?: "left" | "right" }) => (
    <th className={`p-3 font-medium text-${align}`} aria-sort={col && sort === col ? (dir === "desc" ? "descending" : "ascending") : undefined}>
      {col ? (
        <button onClick={() => toggleSort(col)} className={`uppercase tracking-wide hover:text-text ${sort === col ? "text-text" : ""}`}>
          {label}
          <span className="ml-1 inline-block w-2">{sort === col ? (dir === "desc" ? "↓" : "↑") : ""}</span>
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div>
      <PageHeader
        title="Pages"
        subtitle={`${data.total.toLocaleString()} page${data.total === 1 ? "" : "s"} · click a row for audit detail · click a column to sort`}
        actions={
          <div className="flex items-center gap-2">
            <Select value={status} onChange={(v) => setParam("status", v)}>
              <option value="all">All statuses</option>
              <option value="2xx">2xx Success</option>
              <option value="3xx">3xx Redirects</option>
              <option value="4xx">4xx Client errors</option>
              <option value="5xx">5xx Server errors</option>
              <option value="failed">Failed / blocked</option>
            </Select>
            <Input value={search} onChange={setSearch} placeholder="Filter by URL or title…" className="w-52" />
            <a href={`/api/crawl/${crawlId}/export/pages`} download>
              <Button title="Download every crawled page as CSV">Export CSV</Button>
            </a>
          </div>
        }
      />

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 -mt-2 mb-4">
          {chips.map((k) => (
            <button
              key={k}
              onClick={() => setParam(k, null)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-indigo-500/12 text-indigo-300 border border-indigo-500/25 hover:bg-indigo-500/20"
              aria-label={`Remove filter ${CHIP_KEYS[k](params.get(k)!)}`}
            >
              {CHIP_KEYS[k](params.get(k)!)} <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}

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
                  <Th col="url" label="URL" align="left" />
                  <Th col="status" label="Status" />
                  <Th col="depth" label="Depth" />
                  <Th col="responseTimeMs" label="Time" />
                  <Th col="wordCount" label="Words" />
                  <Th col="incomingLinks" label="Links in/out" />
                  <Th col="aeoScore" label="AEO" />
                  <Th label="Schema" align="left" />
                  <Th label="Issues" />
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
                          href={safeHref(p.url)}
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
                        <span title={p.ttfbMs !== undefined ? `TTFB ${p.ttfbMs} ms` : undefined}>{p.responseTimeMs.toLocaleString()} ms</span>
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
