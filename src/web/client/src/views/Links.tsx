import React, { useEffect, useState } from "react";
import { api, PagedResult, LinkRow } from "../lib/api.js";
import { Card, Badge, Input, Spinner, EmptyState, StatusDot, Tabs, Button } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";
import { Pager } from "./Issues.js";

type Kind = "broken" | "internal" | "external" | "redirects" | "opportunities" | "anchors";

interface LinkOpportunityRow {
  sourceUrl: string;
  sourceTitle: string;
  targetUrl: string;
  targetTitle: string;
  keyword: string;
  contextSnippet: string;
  sourceEquity: number;
  targetEquity: number;
  equityBoost: "High" | "Medium" | "Low";
  opportunityScore: number;
}

interface AnchorEntry {
  anchorText: string;
  count: number;
  percentage: number;
  category: "exact_match" | "branded" | "partial_match" | "generic" | "naked_url" | "empty_image";
  dofollowCount: number;
  nofollowCount: number;
}

interface AnchorProfileData {
  totalLinks: number;
  uniqueAnchors: number;
  topAnchors: AnchorEntry[];
  distribution: {
    exactMatchPct: number;
    brandedPct: number;
    partialMatchPct: number;
    genericPct: number;
    nakedUrlPct: number;
    emptyImagePct: number;
  };
  dofollowRatio: number;
  nofollowRatio: number;
  penguinRiskLevel: "Low" | "Medium" | "High";
  warnings: string[];
}

export default function Links({ crawlId }: { crawlId: string }) {
  const [data, setData] = useState<PagedResult<LinkRow> | null>(null);
  const [oppsData, setOppsData] = useState<LinkOpportunityRow[] | null>(null);
  const [anchorData, setAnchorData] = useState<AnchorProfileData | null>(null);
  const [kind, setKind] = useState<Kind>("broken");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const pageSize = 50;

  useEffect(() => {
    setPage(1);
  }, [kind, search]);

  useEffect(() => {
    if (kind === "opportunities") {
      api<{ total: number; opportunities: LinkOpportunityRow[] }>(`/api/crawl/${crawlId}/link-opportunities`)
        .then((res) => setOppsData(res.opportunities))
        .catch(() => setOppsData([]));
      return;
    }

    if (kind === "anchors") {
      api<AnchorProfileData>(`/api/crawl/${crawlId}/anchor-profile`)
        .then(setAnchorData)
        .catch(() => setAnchorData(null));
      return;
    }

    const q = new URLSearchParams({ kind, page: String(page), pageSize: String(pageSize) });
    if (search) q.set("search", search);
    api<PagedResult<LinkRow>>(`/api/crawl/${crawlId}/links?${q.toString()}`)
      .then(setData)
      .catch(() => setData(null));
  }, [crawlId, kind, search, page]);

  const tabs: { id: Kind; label: string }[] = [
    { id: "opportunities", label: "Link Opportunities (Ahrefs)" },
    { id: "anchors", label: "Anchor Profile" },
    { id: "broken", label: "Broken" },
    { id: "internal", label: "Internal" },
    { id: "external", label: "External" },
    { id: "redirects", label: "Redirects" },
  ];

  const handleCopyLink = (targetUrl: string, keyword: string, index: number) => {
    const code = `<a href="${targetUrl}">${keyword}</a>`;
    navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div>
      <PageHeader
        title="Links & Internal Equity"
        subtitle={
          kind === "opportunities"
            ? "Ahrefs Site Audit rival: Identifies unlinked keyword mentions across pages to maximize internal PageRank distribution."
            : kind === "anchors"
            ? "Ahrefs Site Explorer rival: Anchor text categorization, distribution metrics, and Google Penguin over-optimization alerts."
            : `${data?.total ?? 0} ${kind} link${data?.total === 1 ? "" : "s"} in the link graph`
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Tabs tabs={tabs} value={kind} onChange={setKind} />
            {kind !== "opportunities" && kind !== "anchors" && (
              <Input value={search} onChange={setSearch} placeholder="Filter…" className="w-40" />
            )}
          </div>
        }
      />

      {/* --- View 1: Ahrefs Internal Link Opportunities --- */}
      {kind === "opportunities" && (
        <div className="space-y-4">
          {!oppsData ? (
            <Spinner label="Scanning link graph for internal opportunities…" />
          ) : oppsData.length === 0 ? (
            <Card className="p-8 text-center space-y-2">
              <EmptyState
                message="No unlinked keyword opportunities found."
                hint="Your pages either already link to relevant targets, or more content is needed to establish topical cross-links."
              />
            </Card>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted px-1">
                <span>
                  Found <strong className="text-zinc-200">{oppsData.length}</strong> internal link opportunities across the crawled site.
                </span>
                <span className="text-[11px] font-mono text-indigo-400">
                  Sorted by estimated PageRank equity impact
                </span>
              </div>

              <div className="space-y-3">
                {oppsData.map((opp, idx) => (
                  <Card key={idx} className="p-4 space-y-3 border-border hover:border-indigo-500/40 transition-colors">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-faint uppercase text-[10px] tracking-wide font-semibold">Source Page:</span>
                          <span className="font-semibold text-zinc-200">{opp.sourceTitle}</span>
                          <span className="text-zinc-500 font-mono text-[11px] truncate max-w-[280px]">({opp.sourceUrl})</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-faint uppercase text-[10px] tracking-wide font-semibold">Target Page:</span>
                          <a
                            href={opp.targetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-indigo-400 hover:text-indigo-300"
                          >
                            {opp.targetTitle}
                          </a>
                          <span className="text-zinc-500 font-mono text-[11px] truncate max-w-[280px]">({opp.targetUrl})</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <div className="text-right">
                          <div className="text-[10px] text-faint uppercase">Equity Boost</div>
                          <Badge
                            className={
                              opp.equityBoost === "High"
                                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                : opp.equityBoost === "Medium"
                                ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                : "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30"
                            }
                          >
                            {opp.equityBoost} ({opp.opportunityScore}/100)
                          </Badge>
                        </div>

                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleCopyLink(opp.targetUrl, opp.keyword, idx)}
                        >
                          {copiedIndex === idx ? "✓ Copied HTML" : "Copy <a href>"}
                        </Button>
                      </div>
                    </div>

                    {/* Context Snippet */}
                    <div className="bg-panel2 p-3 rounded-lg border border-border text-xs leading-relaxed text-zinc-300 font-sans">
                      <span className="text-faint font-mono text-[10px] uppercase block mb-1">Sentence Context:</span>
                      <span>
                        {opp.contextSnippet.split(new RegExp(`(${opp.keyword})`, "i")).map((chunk, cIdx) =>
                          chunk.toLowerCase() === opp.keyword.toLowerCase() ? (
                            <mark
                              key={cIdx}
                              className="bg-indigo-500/25 text-indigo-200 px-1 py-0.5 rounded font-bold border border-indigo-500/40"
                            >
                              {chunk}
                            </mark>
                          ) : (
                            chunk
                          )
                        )}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- View 2: Ahrefs Anchor Text Profile & Penguin Risk --- */}
      {kind === "anchors" && (
        <div className="space-y-5">
          {!anchorData ? (
            <Spinner label="Analyzing anchor text distribution & Penguin risk…" />
          ) : (
            <>
              {/* Penguin Risk & Summary Bar */}
              <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-border">
                  <div>
                    <h2 className="text-sm font-semibold">Anchor Text Distribution Profile</h2>
                    <p className="text-xs text-muted">
                      {anchorData.totalLinks.toLocaleString()} links analyzed • {anchorData.uniqueAnchors} unique anchors •{" "}
                      <span className="text-emerald-400 font-semibold">{anchorData.dofollowRatio}% dofollow</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-faint uppercase font-semibold">Penguin Risk:</span>
                    <Badge
                      className={
                        anchorData.penguinRiskLevel === "High"
                          ? "bg-red-500/20 text-red-300 border border-red-500/40 font-bold"
                          : anchorData.penguinRiskLevel === "Medium"
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold"
                          : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold"
                      }
                    >
                      {anchorData.penguinRiskLevel} Risk
                    </Badge>
                  </div>
                </div>

                {/* Warnings */}
                {anchorData.warnings.length > 0 && (
                  <div className="p-3 bg-panel2 border border-border rounded-lg space-y-1.5 text-xs">
                    {anchorData.warnings.map((w, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-amber-300">
                        <span>⚠️</span>
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Distribution Grid */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
                  <div className="p-3 bg-panel2 border border-border rounded-lg text-center">
                    <div className="text-[10px] text-faint uppercase">Exact Match</div>
                    <div className="text-lg font-bold text-zinc-100 mt-1">{anchorData.distribution.exactMatchPct}%</div>
                    <div className="text-[10px] text-muted">Target keywords</div>
                  </div>
                  <div className="p-3 bg-panel2 border border-border rounded-lg text-center">
                    <div className="text-[10px] text-faint uppercase">Branded</div>
                    <div className="text-lg font-bold text-indigo-400 mt-1">{anchorData.distribution.brandedPct}%</div>
                    <div className="text-[10px] text-muted">Brand & domain</div>
                  </div>
                  <div className="p-3 bg-panel2 border border-border rounded-lg text-center">
                    <div className="text-[10px] text-faint uppercase">Partial Match</div>
                    <div className="text-lg font-bold text-zinc-100 mt-1">{anchorData.distribution.partialMatchPct}%</div>
                    <div className="text-[10px] text-muted">Compound phrase</div>
                  </div>
                  <div className="p-3 bg-panel2 border border-border rounded-lg text-center">
                    <div className="text-[10px] text-faint uppercase">Generic</div>
                    <div className="text-lg font-bold text-amber-400 mt-1">{anchorData.distribution.genericPct}%</div>
                    <div className="text-[10px] text-muted">&ldquo;click here&rdquo;</div>
                  </div>
                  <div className="p-3 bg-panel2 border border-border rounded-lg text-center">
                    <div className="text-[10px] text-faint uppercase">Naked URLs</div>
                    <div className="text-lg font-bold text-zinc-100 mt-1">{anchorData.distribution.nakedUrlPct}%</div>
                    <div className="text-[10px] text-muted">https://...</div>
                  </div>
                  <div className="p-3 bg-panel2 border border-border rounded-lg text-center">
                    <div className="text-[10px] text-faint uppercase">Empty / Img</div>
                    <div className="text-lg font-bold text-zinc-100 mt-1">{anchorData.distribution.emptyImagePct}%</div>
                    <div className="text-[10px] text-muted">No alt text</div>
                  </div>
                </div>
              </Card>

              {/* Top Anchors Table */}
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] text-faint uppercase tracking-wide border-b border-border text-left">
                        <th className="p-3 font-medium">Anchor Text</th>
                        <th className="p-3 font-medium">Category</th>
                        <th className="p-3 font-medium text-right">Links Count</th>
                        <th className="p-3 font-medium text-right">% of Profile</th>
                        <th className="p-3 font-medium text-right">Dofollow</th>
                        <th className="p-3 font-medium text-right">Nofollow</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {anchorData.topAnchors.map((item, idx) => (
                        <tr key={idx} className="hover:bg-panel2/50 transition-colors">
                          <td className="p-3 font-medium text-zinc-200">
                            {item.anchorText || <span className="text-muted italic">(empty / image)</span>}
                          </td>
                          <td className="p-3">
                            <Badge
                              className={
                                item.category === "exact_match"
                                  ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                                  : item.category === "branded"
                                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                  : item.category === "generic"
                                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                  : "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30"
                              }
                            >
                              {item.category.replace("_", " ")}
                            </Badge>
                          </td>
                          <td className="p-3 text-right font-mono text-zinc-200">{item.count}</td>
                          <td className="p-3 text-right font-mono text-zinc-300">{item.percentage}%</td>
                          <td className="p-3 text-right font-mono text-emerald-400">{item.dofollowCount}</td>
                          <td className="p-3 text-right font-mono text-zinc-500">{item.nofollowCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* --- Standard Paged Link Table (Broken, Internal, External, Redirects) --- */}
      {kind !== "opportunities" && kind !== "anchors" && (
        <>
          {!data ? (
            <Spinner label="Loading links…" />
          ) : data.rows.length === 0 ? (
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

          {data && <Pager page={page} total={data.total} pageSize={pageSize} onChange={setPage} />}
        </>
      )}
    </div>
  );
}
