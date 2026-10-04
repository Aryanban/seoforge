import React, { useState } from "react";
import { api, InspectResult, severityBg } from "../lib/api.js";
import { Card, Button, Input, Select, Badge, EmptyState, StatusDot } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";

type InspectTab = "overview" | "serp" | "content" | "schema";

export default function Inspect() {
  const [url, setUrl] = useState("");
  const [targetKeyword, setTargetKeyword] = useState("");
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
          targetKeyword: targetKeyword.trim() || undefined,
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
    <div className="max-w-[1050px]">
      <PageHeader
        title="Inspect URL"
        subtitle="Enterprise on-page inspection — live SERP preview, Flesch readability, n-gram keyword density, Schema.org generator, and AEO."
      />

      <Card className="p-4 mb-5 space-y-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Input
            value={url}
            onChange={setUrl}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="https://example.com/some-page"
            className="flex-1 min-w-[280px]"
          />
          <Input
            value={targetKeyword}
            onChange={setTargetKeyword}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Target keyword (e.g. cloud storage)"
            className="w-[220px]"
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
            Render JS
          </label>
          <Button variant="primary" onClick={run} disabled={loading || !url.trim()}>
            {loading ? "Inspecting…" : "Inspect Page"}
          </Button>
        </div>
        {error && <div className="text-err text-xs">⚠ {error}</div>}
      </Card>

      {!data && !loading && !error && (
        <EmptyState
          message="No URL inspected yet."
          hint="Paste a full URL and optional target keyword above, then press Inspect Page."
        />
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted">
          <div className="animate-spin h-5 w-5 border-2 border-border border-t-indigo-400 rounded-full mr-3" />
          Inspecting {url}…
        </div>
      )}

      {data && !loading && <InspectResultView result={data} />}
    </div>
  );
}

function InspectResultView({ result }: { result: InspectResult }) {
  const [tab, setTab] = useState<InspectTab>("overview");
  const p = result.page;
  const ca = result.contentAnalysis;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Navigation tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2 text-xs">
        <button
          onClick={() => setTab("overview")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
            tab === "overview" ? "bg-indigo-600 text-white" : "text-muted hover:text-text hover:bg-panel3"
          }`}
        >
          Overview & Audit ({result.issues.length} issues)
        </button>
        <button
          onClick={() => setTab("serp")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
            tab === "serp" ? "bg-indigo-600 text-white" : "text-muted hover:text-text hover:bg-panel3"
          }`}
        >
          SERP & Social Preview
        </button>
        <button
          onClick={() => setTab("content")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
            tab === "content" ? "bg-indigo-600 text-white" : "text-muted hover:text-text hover:bg-panel3"
          }`}
        >
          Content & Keywords ({ca?.readability.wordCount ?? p.wordCount} words)
        </button>
        <button
          onClick={() => setTab("schema")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
            tab === "schema" ? "bg-indigo-600 text-white" : "text-muted hover:text-text hover:bg-panel3"
          }`}
        >
          Schema.org Generator
        </button>
      </div>

      {tab === "overview" && <OverviewTab result={result} />}
      {tab === "serp" && <SerpTab result={result} />}
      {tab === "content" && <ContentTab result={result} />}
      {tab === "schema" && <SchemaTab result={result} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 1: Overview & Audit                                            */
/* ------------------------------------------------------------------ */
function OverviewTab({ result }: { result: InspectResult }) {
  const p = result.page;
  const v = p.coreWebVitals;

  const metrics = [
    { label: "Status", value: String(p.status), node: <StatusDot status={p.status} /> },
    { label: "TTFB", value: p.ttfbMs != null ? `${p.ttfbMs}ms` : "—" },
    { label: "Total time", value: `${p.responseTimeMs}ms` },
    { label: "Words", value: String(p.wordCount) },
    { label: "Canonical", value: p.canonicalMatches ? "matches" : "mismatch", ok: p.canonicalMatches },
    { label: "Indexable", value: p.isIndexable ? "yes" : "no", ok: p.isIndexable },
  ];

  return (
    <div className="space-y-5">
      {/* AEO hero + key metrics */}
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

      {/* Core Web Vitals */}
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

      {/* Meta & Schema */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-3">Page Metadata</h2>
          <dl className="space-y-2.5 text-sm">
            <Meta label={`Title (${p.title?.length || 0} chars)`} value={p.title} />
            <Meta label={`Description (${p.description?.length || 0} chars)`} value={p.description} />
            <Meta label="H1" value={p.h1Text} />
            <Meta label="Canonical" value={p.canonical} hint={p.canonicalMatches ? "" : "mismatches requested URL"} />
            <Meta label="Final URL" value={p.finalUrl && p.finalUrl !== p.url ? p.finalUrl : undefined} />
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold mb-3">Structured Data (Existing)</h2>
          {p.schema?.hasJsonLd ? (
            <>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {p.schema.typesFound.map((t) => (
                  <Badge key={t} className="bg-indigo-500/12 text-indigo-300 border border-indigo-500/25">
                    {t}
                  </Badge>
                ))}
              </div>
              {p.schema.missingExpected?.length > 0 && (
                <div className="text-xs text-warn mb-2">
                  Missing expected entities: {p.schema.missingExpected.join(", ")}
                </div>
              )}
              {p.schema.errors?.length > 0 && (
                <ul className="text-xs text-err space-y-1 list-disc pl-4">
                  {p.schema.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="text-muted text-sm space-y-2">
              <p>No JSON-LD structured data detected on this page.</p>
              <p className="text-xs text-indigo-400">
                Tip: Click the <strong>Schema.org Generator</strong> tab above to generate Google-compliant JSON-LD markup.
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Issues */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3">
          Issues Found <span className="text-muted font-normal">({result.issues.length})</span>
        </h2>
        {result.issues.length === 0 ? (
          <div className="text-emerald-400 text-sm flex items-center gap-2">
            <span>✓</span> No on-page SEO issues detected.
          </div>
        ) : (
          <div className="space-y-1.5">
            {result.issues.map((i, idx) => (
              <div key={idx} className="flex items-center gap-3 py-2 border-b border-border last:border-0 last:pb-0">
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

/* ------------------------------------------------------------------ */
/* Tab 2: Live SERP & Social Sharing Previews                         */
/* ------------------------------------------------------------------ */
function SerpTab({ result }: { result: InspectResult }) {
  const p = result.page;
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [socialPlatform, setSocialPlatform] = useState<"twitter" | "facebook">("twitter");

  const title = p.title || "Untitled Document";
  const desc = p.description || "No meta description provided. Search engines will generate a snippet from page content.";
  let domain = "example.com";
  let pathBreadcrumb = "";
  try {
    const u = new URL(p.url);
    domain = u.hostname.replace(/^www\./, "");
    pathBreadcrumb = u.pathname.replace(/^\//, "").replace(/\//g, " › ");
  } catch {}

  const titleLength = title.length;
  const descLength = desc.length;

  const og = p.openGraph;
  const tw = p.twitterCard;

  return (
    <div className="space-y-5">
      {/* Search Engine Result Simulator */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Google Search Snippet Simulator</h2>
            <p className="text-xs text-muted">Preview how your snippet renders in Google Search results</p>
          </div>
          <div className="flex items-center gap-1 bg-panel2 p-1 rounded-lg border border-border">
            <button
              onClick={() => setDevice("desktop")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                device === "desktop" ? "bg-indigo-600 text-white" : "text-muted hover:text-text"
              }`}
            >
              Desktop
            </button>
            <button
              onClick={() => setDevice("mobile")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                device === "mobile" ? "bg-indigo-600 text-white" : "text-muted hover:text-text"
              }`}
            >
              Mobile
            </button>
          </div>
        </div>

        {/* Meters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 bg-panel2 border border-border rounded-lg space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted">Title Length</span>
              <span className={titleLength > 60 ? "text-amber-400 font-semibold" : "text-emerald-400"}>
                {titleLength} / 60 chars ({Math.round(titleLength * 8.5)}px / ~600px)
              </span>
            </div>
            <div className="w-full bg-panel3 h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full ${titleLength > 60 ? "bg-amber-400" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, (titleLength / 60) * 100)}%` }}
              />
            </div>
            {titleLength > 60 && (
              <p className="text-[11px] text-amber-400">
                ⚠️ Title exceeds ~60 chars and may be truncated with &ldquo;...&rdquo; on desktop SERPs.
              </p>
            )}
          </div>

          <div className="p-3 bg-panel2 border border-border rounded-lg space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted">Snippet / Description</span>
              <span className={descLength > 160 ? "text-amber-400 font-semibold" : descLength < 50 ? "text-amber-400" : "text-emerald-400"}>
                {descLength} / 160 chars ({Math.round(descLength * 6.2)}px / ~960px)
              </span>
            </div>
            <div className="w-full bg-panel3 h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full ${descLength > 160 ? "bg-amber-400" : descLength < 50 ? "bg-amber-400" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, (descLength / 160) * 100)}%` }}
              />
            </div>
            {descLength > 160 && (
              <p className="text-[11px] text-amber-400">
                ⚠️ Description exceeds ~160 chars and will be clipped by search engines.
              </p>
            )}
          </div>
        </div>

        {/* Live SERP Mockup */}
        <div className={`p-4 bg-white rounded-xl border border-slate-300 text-slate-900 shadow-sm ${
          device === "mobile" ? "max-w-[400px] mx-auto rounded-2xl" : "w-full"
        }`}>
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-1">
            <div className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-700">
              {domain.charAt(0).toUpperCase()}
            </div>
            <div className="text-xs text-slate-600 truncate">
              https://{domain}{pathBreadcrumb ? ` › ${pathBreadcrumb}` : ""}
            </div>
          </div>

          {/* Title */}
          <h3 className="text-base text-[#1a0dab] font-medium leading-snug hover:underline cursor-pointer line-clamp-2">
            {title}
          </h3>

          {/* Snippet */}
          <p className="text-xs text-[#4d5156] leading-relaxed mt-1 line-clamp-3">
            {desc}
          </p>
        </div>
      </Card>

      {/* Social Card Previews */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Social Sharing Card Simulator</h2>
            <p className="text-xs text-muted">Preview how shared links appear across social feeds and messaging apps</p>
          </div>
          <div className="flex items-center gap-1 bg-panel2 p-1 rounded-lg border border-border">
            <button
              onClick={() => setSocialPlatform("twitter")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                socialPlatform === "twitter" ? "bg-indigo-600 text-white" : "text-muted hover:text-text"
              }`}
            >
              X / Twitter
            </button>
            <button
              onClick={() => setSocialPlatform("facebook")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                socialPlatform === "facebook" ? "bg-indigo-600 text-white" : "text-muted hover:text-text"
              }`}
            >
              Open Graph / LinkedIn
            </button>
          </div>
        </div>

        {/* X / Twitter Preview */}
        {socialPlatform === "twitter" && (
          <div className="max-w-[500px] bg-black text-white rounded-2xl border border-zinc-800 overflow-hidden shadow-lg">
            <div className="h-56 bg-zinc-900 flex items-center justify-center relative overflow-hidden">
              {tw?.image || og?.image ? (
                <img
                  src={tw?.image || og?.image}
                  alt="Social banner"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as any).style.display = "none";
                  }}
                />
              ) : (
                <div className="text-zinc-500 text-xs flex flex-col items-center gap-1">
                  <span>🖼️ No twitter:image or og:image defined</span>
                  <span className="text-[10px] text-zinc-600">Add an image to display rich summary cards</span>
                </div>
              )}
            </div>
            <div className="p-3.5 bg-zinc-950 space-y-1">
              <div className="text-[11px] text-zinc-400 font-mono truncate">{domain}</div>
              <div className="text-sm font-bold text-zinc-100 line-clamp-1">{tw?.title || og?.title || title}</div>
              <div className="text-xs text-zinc-400 line-clamp-2">{tw?.description || og?.description || desc}</div>
            </div>
          </div>
        )}

        {/* Open Graph / LinkedIn Preview */}
        {socialPlatform === "facebook" && (
          <div className="max-w-[500px] bg-[#242526] text-white rounded-xl border border-zinc-700 overflow-hidden shadow-lg">
            <div className="h-56 bg-zinc-800 flex items-center justify-center relative overflow-hidden">
              {og?.image ? (
                <img
                  src={og.image}
                  alt="OG banner"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as any).style.display = "none";
                  }}
                />
              ) : (
                <div className="text-zinc-500 text-xs flex flex-col items-center gap-1">
                  <span>🖼️ No og:image defined</span>
                </div>
              )}
            </div>
            <div className="p-3.5 bg-[#18191a] space-y-1">
              <div className="text-[11px] text-zinc-400 uppercase tracking-wide truncate">{domain}</div>
              <div className="text-sm font-bold text-zinc-100 line-clamp-1">{og?.title || title}</div>
              <div className="text-xs text-zinc-400 line-clamp-2">{og?.description || desc}</div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 3: Content & Keyword Optimizer                                 */
/* ------------------------------------------------------------------ */
function ContentTab({ result }: { result: InspectResult }) {
  const ca = result.contentAnalysis;
  const [ngramN, setNgramN] = useState<1 | 2 | 3>(2);

  if (!ca) {
    return (
      <EmptyState
        message="No content text available for deep analysis."
        hint="Ensure the page returned 200 OK and contains readable body HTML."
      />
    );
  }

  const r = ca.readability;
  const tk = ca.targetKeywordAudit;
  const ngrams = ngramN === 1 ? ca.keywords.unigrams : ngramN === 2 ? ca.keywords.bigrams : ca.keywords.trigrams;

  return (
    <div className="space-y-5">
      {/* Readability Metrics */}
      <Card className="p-5 space-y-3">
        <h2 className="text-sm font-semibold">Content Readability & Depth</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3.5 bg-panel2 border border-border rounded-lg">
            <div className="text-[10px] text-faint uppercase tracking-wide">Flesch Reading Ease</div>
            <div className={`text-xl font-bold mt-1 ${
              r.fleschReadingEase >= 60 ? "text-emerald-400" : r.fleschReadingEase >= 45 ? "text-amber-400" : "text-red-400"
            }`}>
              {r.fleschReadingEase}
              <span className="text-xs text-muted font-normal"> / 100</span>
            </div>
            <div className="text-[11px] text-muted mt-0.5 truncate">{r.readingLevel}</div>
          </div>

          <div className="p-3.5 bg-panel2 border border-border rounded-lg">
            <div className="text-[10px] text-faint uppercase tracking-wide">Grade Level</div>
            <div className="text-xl font-bold mt-1 text-zinc-200">
              Grade {r.fleschKincaidGrade}
            </div>
            <div className="text-[11px] text-muted mt-0.5">Flesch-Kincaid formula</div>
          </div>

          <div className="p-3.5 bg-panel2 border border-border rounded-lg">
            <div className="text-[10px] text-faint uppercase tracking-wide">Total Words</div>
            <div className="text-xl font-bold mt-1 text-zinc-200">
              {r.wordCount.toLocaleString()}
            </div>
            <div className="text-[11px] text-muted mt-0.5">{r.sentenceCount} sentences</div>
          </div>

          <div className="p-3.5 bg-panel2 border border-border rounded-lg">
            <div className="text-[10px] text-faint uppercase tracking-wide">Reading Time</div>
            <div className="text-xl font-bold mt-1 text-zinc-200">
              ~{r.readingTimeMinutes} min
            </div>
            <div className="text-[11px] text-muted mt-0.5">{r.avgWordsPerSentence} words / sentence</div>
          </div>
        </div>
      </Card>

      {/* Target Keyword Checklist */}
      {tk && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <div>
              <h2 className="text-sm font-semibold">
                Target Keyword Optimization: <span className="text-indigo-400">&ldquo;{tk.keyword}&rdquo;</span>
              </h2>
              <p className="text-xs text-muted">
                Frequency: {tk.count} times ({tk.density}% density) • Status:{" "}
                <span className={tk.status === "optimal" ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
                  {tk.status === "optimal" ? "✓ Optimal Density" : tk.status === "over_optimized" ? "⚠️ Keyword Stuffing Risk" : "Notice: Under-optimized"}
                </span>
              </p>
            </div>
          </div>

          {/* Checklist Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <CheckItem label="In URL Slug" ok={tk.inUrl} />
            <CheckItem label="In <title> Tag" ok={tk.inTitle} />
            <CheckItem label="In <h1> Heading" ok={tk.inH1} />
            <CheckItem label="In Meta Description" ok={tk.inDescription} />
            <CheckItem label="In First 100 Words" ok={tk.inFirst100Words} />
            <CheckItem label="In Image Alt Text" ok={tk.inImageAlts} />
          </div>

          {tk.recommendations.length > 0 && (
            <div className="p-3 bg-panel2 border border-border rounded-lg space-y-1 text-xs">
              <div className="font-semibold text-amber-400">Optimization Actions:</div>
              <ul className="list-disc pl-4 space-y-0.5 text-zinc-300">
                {tk.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Ahrefs-Grade Search Intent & Keyword Difficulty (KD) Explorer */}
      {result.keywordIntelligence && (
        <Card className="p-5 space-y-4 border-indigo-500/30">
          <div className="flex items-center justify-between pb-2 border-b border-border flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest text-indigo-400 font-semibold">
                  Ahrefs Keywords Explorer Rival
                </span>
              </div>
              <h2 className="text-sm font-semibold">
                Search Intent & Difficulty: <span className="text-indigo-400">&ldquo;{result.keywordIntelligence.keyword}&rdquo;</span>
              </h2>
            </div>

            <Badge
              className={
                result.keywordIntelligence.intent.primaryIntent === "commercial"
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  : result.keywordIntelligence.intent.primaryIntent === "transactional"
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
              }
            >
              {result.keywordIntelligence.intent.intentLabel}
            </Badge>
          </div>

          {/* Intent & KD Metric Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 bg-panel2 border border-border rounded-lg space-y-1">
              <div className="text-[10px] text-faint uppercase tracking-wide">Keyword Difficulty (KD)</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span
                  className={`text-2xl font-bold ${
                    result.keywordIntelligence.difficulty.score <= 30
                      ? "text-emerald-400"
                      : result.keywordIntelligence.difficulty.score <= 60
                      ? "text-amber-400"
                      : "text-red-400"
                  }`}
                >
                  {result.keywordIntelligence.difficulty.score}
                </span>
                <span className="text-xs text-muted">/ 100 ({result.keywordIntelligence.difficulty.tier})</span>
              </div>
              <div className="text-[11px] text-muted">
                Need ~{result.keywordIntelligence.difficulty.estimatedRefDomainsNeeded} referring domains to rank in Top 10
              </div>
            </div>

            <div className="p-3.5 bg-panel2 border border-border rounded-lg space-y-1">
              <div className="text-[10px] text-faint uppercase tracking-wide">Intent Explanation</div>
              <div className="text-xs text-zinc-200 leading-snug mt-1">
                {result.keywordIntelligence.intent.explanation}
              </div>
              <div className="text-[10px] text-indigo-400 font-mono mt-1">
                {result.keywordIntelligence.intent.confidence}% confidence
              </div>
            </div>

            <div className="p-3.5 bg-panel2 border border-border rounded-lg space-y-1">
              <div className="text-[10px] text-faint uppercase tracking-wide">Content Intent Alignment</div>
              <div className="flex items-center gap-1.5 mt-1 font-semibold text-xs">
                {result.keywordIntelligence.alignment?.aligned ? (
                  <span className="text-emerald-400">✓ Page Content Aligned</span>
                ) : (
                  <span className="text-amber-400">⚠️ Intent Format Mismatch</span>
                )}
              </div>
              <div className="text-[11px] text-muted">
                {result.keywordIntelligence.alignment?.recommendations[0] || "Page structure matches search intent expectations."}
              </div>
            </div>
          </div>

          {/* Question Clusters & Long-Tail Variations */}
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="text-xs font-semibold text-zinc-300">
              Questions & Long-Tail Variants to Target (Ahrefs Keyword Ideas):
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {result.keywordIntelligence.variations.questions.slice(0, 3).map((q, qIdx) => (
                <div key={qIdx} className="p-2.5 bg-panel2/60 border border-border/80 rounded-lg flex items-center justify-between">
                  <span className="text-zinc-200">{q.keyword}</span>
                  <span className="text-[10px] font-mono text-zinc-400">KD {q.difficulty}</span>
                </div>
              ))}
              {result.keywordIntelligence.variations.commercial.slice(0, 3).map((c, cIdx) => (
                <div key={cIdx} className="p-2.5 bg-panel2/60 border border-border/80 rounded-lg flex items-center justify-between">
                  <span className="text-zinc-200">{c.keyword}</span>
                  <span className="text-[10px] font-mono text-zinc-400">KD {c.difficulty}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* N-Gram Keyword Table */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Keyword Frequency & Density Analysis</h2>
            <p className="text-xs text-muted">Ahrefs/Surfer SEO-style n-gram term frequencies (English stop words filtered)</p>
          </div>
          <div className="flex items-center gap-1 bg-panel2 p-1 rounded-lg border border-border">
            <button
              onClick={() => setNgramN(1)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                ngramN === 1 ? "bg-indigo-600 text-white" : "text-muted hover:text-text"
              }`}
            >
              1-Word
            </button>
            <button
              onClick={() => setNgramN(2)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                ngramN === 2 ? "bg-indigo-600 text-white" : "text-muted hover:text-text"
              }`}
            >
              2-Words
            </button>
            <button
              onClick={() => setNgramN(3)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                ngramN === 3 ? "bg-indigo-600 text-white" : "text-muted hover:text-text"
              }`}
            >
              3-Words
            </button>
          </div>
        </div>

        {ngrams.length === 0 ? (
          <div className="text-muted text-xs py-4 text-center">No recurring phrases found for this length.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-border text-faint uppercase text-[10px]">
                  <th className="py-2 px-3 font-semibold">Phrase</th>
                  <th className="py-2 px-3 font-semibold text-right">Occurrences</th>
                  <th className="py-2 px-3 font-semibold text-right">Density %</th>
                  <th className="py-2 px-3 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {ngrams.map((ng, i) => (
                  <tr key={i} className="hover:bg-panel2/50">
                    <td className="py-2 px-3 font-medium text-zinc-200">{ng.phrase}</td>
                    <td className="py-2 px-3 text-right text-muted">{ng.count}</td>
                    <td className="py-2 px-3 text-right font-mono text-zinc-300">{ng.density}%</td>
                    <td className="py-2 px-3 text-right">
                      {ng.isStuffing ? (
                        <span className="text-[10px] bg-red-500/12 text-err border border-red-500/25 px-1.5 py-0.5 rounded font-semibold">
                          ⚠️ Stuffing
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-400">Normal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Heading Structure Outline */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Heading Hierarchy Outline</h2>
            <p className="text-xs text-muted">
              {ca.headings.h1Count} H1 • {ca.headings.h2Count} H2 • {ca.headings.h3Count} H3
            </p>
          </div>
          {ca.headings.hasSkippedLevels && (
            <Badge className="bg-amber-500/12 text-warn border border-amber-500/25">
              ⚠️ Skipped Heading Levels Detected
            </Badge>
          )}
        </div>

        {ca.headings.items.length === 0 ? (
          <div className="text-muted text-xs">No heading tags (H1-H6) found in DOM.</div>
        ) : (
          <div className="space-y-1.5 font-mono text-xs">
            {ca.headings.items.map((h, i) => (
              <div
                key={i}
                className="flex items-baseline gap-2 py-1 border-b border-border/40 last:border-0"
                style={{ paddingLeft: `${(h.level - 1) * 16}px` }}
              >
                <span className={`text-[10px] px-1 rounded font-bold ${
                  h.level === 1 ? "bg-indigo-500/20 text-indigo-300" : h.level === 2 ? "bg-panel3 text-zinc-300" : "text-faint"
                }`}>
                  H{h.level}
                </span>
                <span className="text-zinc-200 font-sans">{h.text}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function CheckItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`p-2.5 rounded-lg border flex items-center justify-between ${
      ok ? "bg-emerald-500/5 border-emerald-500/20 text-zinc-200" : "bg-panel2 border-border text-muted"
    }`}>
      <span>{label}</span>
      <span className={ok ? "text-emerald-400 font-bold" : "text-zinc-500"}>
        {ok ? "✓ Found" : "✗ Missing"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 4: Schema.org JSON-LD Generator                                */
/* ------------------------------------------------------------------ */
function SchemaTab({ result }: { result: InspectResult }) {
  const schemas = result.generatedSchemas || {};
  const schemaKeys = Object.keys(schemas);
  const [selectedKey, setSelectedKey] = useState<string>(schemaKeys[0] || "Article");
  const [copied, setCopied] = useState(false);

  const activeSchema = schemas[selectedKey] || {};
  const scriptContent = `<script type="application/ld+json">\n${JSON.stringify(activeSchema, null, 2)}\n</script>`;

  const copy = () => {
    navigator.clipboard.writeText(scriptContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">1-Click Schema.org JSON-LD Generator</h2>
            <p className="text-xs text-muted">
              Auto-generated Google Rich Results markup derived from this page&apos;s metadata
            </p>
          </div>
          <Button variant="primary" onClick={copy}>
            {copied ? "✓ Copied Script!" : "Copy JSON-LD"}
          </Button>
        </div>

        {/* Schema Type Switcher */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {schemaKeys.map((key) => (
            <button
              key={key}
              onClick={() => setSelectedKey(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                selectedKey === key ? "bg-indigo-600 text-white" : "bg-panel2 text-muted hover:text-text border border-border"
              }`}
            >
              {key} Schema
            </button>
          ))}
        </div>

        {/* Code Preview */}
        <div className="relative">
          <pre className="p-4 bg-panel3 border border-border rounded-xl text-xs font-mono text-zinc-200 overflow-x-auto max-h-[420px]">
            {scriptContent}
          </pre>
        </div>

        <p className="text-xs text-muted">
          Paste this script tag directly into your website&apos;s <code className="text-indigo-400 font-mono">&lt;head&gt;</code> or template header. Validate in Google&apos;s Rich Results Test tool.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared Helpers                                                     */
/* ------------------------------------------------------------------ */
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
