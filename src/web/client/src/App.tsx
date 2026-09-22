import React, { useEffect, useState, useCallback, useRef } from "react";
import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { api, CrawlSummary } from "./lib/api.js";
import { Button, Input, Select, ProgressBar } from "./components/ui.js";
import Overview from "./views/Overview.js";
import Issues from "./views/Issues.js";
import Pages from "./views/Pages.js";
import Links from "./views/Links.js";
import Sitemaps from "./views/Sitemaps.js";
import Recommendations from "./views/Recommendations.js";
import Reports from "./views/Reports.js";
import Settings from "./views/Settings.js";
import Inspect from "./views/Inspect.js";
import Publishing from "./views/Publishing.js";
import Reputation from "./views/Reputation.js";
import Competitors from "./views/Competitors.js";

/* Minimal inline icon set — crisp at small sizes */
const ICONS: Record<string, React.ReactNode> = {
  overview: <path d="M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-5H3v5ZM13 8h8V3h-8v5Z" />,
  issues: <path d="M12 3 2 21h20L12 3Zm1 6v6h-2V9h2Zm-1 9.5a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z" />,
  pages: <path d="M4 4h16v4H4V4Zm0 6h16v4H4v-4Zm0 6h16v4H4v-4Z" />,
  links: <path d="M7 7h6v6h4V7h-4V5h6v4h-2v6h-6v-2H7v6H5v-8h2V7Zm12 12v-6h2v6h-2ZM5 5h8v2H5V5Z" />,
  sitemaps: <path d="M4 6h16M4 12h16M4 18h10" />,
  ai: <path d="m12 2 2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2Z" />,
  megaphone: <path d="M3 11v3l2 1 12 5V6L5 10H3Zm2 2v-1h.7l9.3 3.8V9.2L5.7 13H5Zm-2 6h6v-2H3v2Z" />,
  shield: <path d="M12 2 4 5v6c0 5 3.4 9.6 8 11 4.6-1.4 8-6 8-11V5l-8-3Zm0 2.2 6 2.2V11c0 4.2-2.7 8-6 9.2-3.3-1.2-6-5-6-9.2V6.4l6-2.2Z" />,
  scale: <path d="M12 3v3H6v2h1l-3 6a3 3 0 0 0 6 0L7 8h5v11h2V8h5l-3 6a3 3 0 0 0 6 0l-3-6h1V6h-6V3h-2ZM5.5 14.5 7 11l1.5 3.5a1.5 1.5 0 0 1-3 0Zm11 0L18 11l1.5 3.5a1.5 1.5 0 0 1-3 0Z" />,
  reports: <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Zm2 2v13.4l1-.7 2 1.4 2-1.4 2 1.4.9.7V4H8Z" />,
  inspect: <path d="M10 2a8 8 0 1 0 4.9 14.3L21 22.4 22.4 21l-6.1-6.1A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z" />,
  settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 4-1.8-.6a7 7 0 0 0-.5-1.3l.9-1.6-1.4-1.4-1.6.9a7 7 0 0 0-1.3-.5L14.5 5h-2l-.6 1.8a7 7 0 0 0-1.3.5l-1.6-.9L7.6 7.8l.9 1.6a7 7 0 0 0-.5 1.3L6 11.5v2l1.8.6a7 7 0 0 0 .5 1.3l-.9 1.6 1.4 1.4 1.6-.9a7 7 0 0 0 1.3.5l.6 1.8h2l.6-1.8a7 7 0 0 0 1.3-.5l1.6.9 1.4-1.4-.9-1.6a7 7 0 0 0 .5-1.3L21 13.5v-2Z" />,
};

const NAV = [
  { to: "/", label: "Overview", icon: "overview" },
  { to: "/issues", label: "Issues", icon: "issues" },
  { to: "/pages", label: "Pages", icon: "pages" },
  { to: "/links", label: "Links", icon: "links" },
  { to: "/sitemaps", label: "Sitemaps", icon: "sitemaps" },
  { to: "/recommendations", label: "AI Fixes", icon: "ai" },
  { to: "/publishing", label: "Publishing", icon: "megaphone" },
  { to: "/reputation", label: "Reputation", icon: "shield" },
  { to: "/competitors", label: "Competitors", icon: "scale" },
  { to: "/inspect", label: "Inspect", icon: "inspect" },
  { to: "/reports", label: "Reports", icon: "reports" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

interface CrawlOpts {
  maxDepth: number;
  limit: number;
  concurrency: number;
  strategy: string;
  render: boolean;
}

const DEFAULT_OPTS: CrawlOpts = {
  maxDepth: 10,
  limit: 1000,
  concurrency: 8,
  strategy: "discover",
  render: false,
};

export default function App() {
  const [crawl, setCrawl] = useState<CrawlSummary | null>(null);
  const [crawlId, setCrawlId] = useState<string | null>(null);
  const [crawls, setCrawls] = useState<CrawlSummary[]>([]);
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [pct, setPct] = useState(0);
  const [showOpts, setShowOpts] = useState(false);
  const [opts, setOpts] = useState<CrawlOpts>(DEFAULT_OPTS);
  const navigate = useNavigate();
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const refreshCrawls = useCallback(async () => {
    try {
      const list = await api<CrawlSummary[]>("/api/crawls?limit=25");
      setCrawls(list);
      const latest = list[0];
      if (latest && !crawlId) {
        setCrawlId(latest.id);
        setCrawl(latest);
      } else if (crawlId) {
        const found = list.find((c) => c.id === crawlId);
        if (found) setCrawl(found);
      }
    } catch {
      /* store may be empty on first run */
    }
  }, [crawlId]);

  useEffect(() => {
    refreshCrawls();
  }, [refreshCrawls]);

  const startCrawl = async () => {
    if (!url.trim()) return;
    setRunning(true);
    setPct(0);
    setProgress("Starting crawl…");
    try {
      const res = await api<{ crawlId: string }>("/api/crawl", {
        method: "POST",
        body: JSON.stringify({
          url: url.trim(),
          options: {
            maxDepth: optsRef.current.maxDepth,
            limit: optsRef.current.limit,
            concurrency: optsRef.current.concurrency,
            strategy: optsRef.current.strategy,
            render: optsRef.current.render,
          },
        }),
      });
      setCrawlId(res.crawlId);
      navigate("/");
      watchProgress(res.crawlId);
    } catch (e: any) {
      setRunning(false);
      setProgress(`Error: ${e.message}`);
    }
  };

  const stopCrawl = async () => {
    if (!crawlId) return;
    try {
      await api(`/api/crawl/${crawlId}/stop`, { method: "POST" });
      setProgress("Stopping…");
    } catch {
      /* already finished */
    }
  };

  const watchProgress = (id: string) => {
    const es = new EventSource(`/api/crawl/${id}/stream`);
    es.addEventListener("progress", (ev: any) => {
      try {
        const p = JSON.parse(ev.data);
        setProgress(
          `Crawled ${p.crawled} · discovered ${p.discovered} · depth ${p.depth} · ${p.pagesPerSecond} pages/s${p.currentUrl ? " · " + truncate(p.currentUrl, 55) : ""}`
        );
        const budget = optsRef.current.limit || 1000;
        setPct(Math.min(99, Math.round((p.crawled / budget) * 100)));
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("done", () => {
      es.close();
      setRunning(false);
      setProgress("");
      setPct(100);
      setCrawlId(id);
      refreshCrawls();
      setTimeout(() => setPct(0), 1500);
    });
    es.addEventListener("error", () => {
      es.close();
      setRunning(false);
      setProgress("");
      setPct(0);
    });
  };

  const selectCrawl = (id: string) => {
    setCrawlId(id);
    const found = crawls.find((c) => c.id === id);
    if (found) setCrawl(found);
  };

  return (
    <div className="flex h-screen relative">
      {/* ---- Sidebar ---- */}
      <aside className="w-[218px] shrink-0 border-r border-border bg-panel/60 backdrop-blur flex flex-col z-10">
        <div className="px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-indigo-900/40">
              S
            </div>
            <div>
              <div className="font-semibold text-[15px] tracking-tight leading-none">SEOForge</div>
              <div className="text-[10px] text-faint mt-1 tracking-wide uppercase">Local SEO crawler</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-1 space-y-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all duration-150 ${
                  isActive
                    ? "bg-indigo-500/12 text-white font-medium"
                    : "text-zinc-400 hover:text-white hover:bg-panel3/70"
                }`
              }
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-[15px] h-[15px] shrink-0 opacity-90"
              >
                {ICONS[item.icon]}
              </svg>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {crawl && (
          <div className="px-3.5 py-3 border-t border-border">
            <div className="text-[10px] text-faint uppercase tracking-wide mb-1">Current crawl</div>
            <div className="text-xs text-zinc-300 truncate" title={crawl.targetUrl}>
              {crawl.targetUrl}
            </div>
            <div className="text-[11px] text-faint mt-0.5">
              {crawl.totalUrlsCrawled} pages · AEO {crawl.averageAeoScore}
            </div>
          </div>
        )}
      </aside>

      {/* ---- Main ---- */}
      <div className="flex-1 flex flex-col overflow-hidden z-10">
        <header className="border-b border-border bg-panel/40 backdrop-blur px-5 py-3">
          <div className="flex items-center gap-2.5">
            <Input
              value={url}
              onChange={setUrl}
              onKeyDown={(e) => e.key === "Enter" && !running && startCrawl()}
              placeholder="https://example.com"
              className="flex-1 max-w-md"
            />

            {/* Crawl options popover */}
            <div className="relative">
              <button
                onClick={() => setShowOpts((v) => !v)}
                title="Crawl options"
                className={`p-2 rounded-lg border transition-colors ${showOpts ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300" : "bg-panel2 border-border text-muted hover:text-text"}`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  {ICONS.settings}
                </svg>
              </button>
              {showOpts && (
                <div className="absolute right-0 top-11 z-50 w-64 bg-panel border border-border rounded-xl shadow-2xl shadow-black/60 p-3.5 animate-fade-in">
                  <div className="text-xs font-semibold text-zinc-300 mb-3 uppercase tracking-wide">
                    Crawl options
                  </div>
                  <div className="space-y-3">
                    <OptRow label="Crawl budget">
                      <Select
                        value={String(opts.limit)}
                        onChange={(v) => setOpts({ ...opts, limit: Number(v) })}
                      >
                        {[100, 250, 500, 1000, 2500, 5000].map((n) => (
                          <option key={n} value={n}>
                            {n} pages
                          </option>
                        ))}
                      </Select>
                    </OptRow>
                    <OptRow label="Max depth">
                      <Select
                        value={String(opts.maxDepth)}
                        onChange={(v) => setOpts({ ...opts, maxDepth: Number(v) })}
                      >
                        {[2, 3, 5, 10, 15].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </Select>
                    </OptRow>
                    <OptRow label="Concurrency">
                      <Select
                        value={String(opts.concurrency)}
                        onChange={(v) => setOpts({ ...opts, concurrency: Number(v) })}
                      >
                        {[2, 4, 8, 16].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </Select>
                    </OptRow>
                    <OptRow label="Strategy">
                      <Select
                        value={opts.strategy}
                        onChange={(v) => setOpts({ ...opts, strategy: v })}
                      >
                        <option value="discover">discover (BFS)</option>
                        <option value="sitemap">sitemap</option>
                        <option value="config">config</option>
                      </Select>
                    </OptRow>
                    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={opts.render}
                        onChange={(e) => setOpts({ ...opts, render: e.target.checked })}
                        className="accent-indigo-500"
                      />
                      JS rendering <span className="text-faint">(Playwright)</span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {running ? (
              <Button variant="danger" onClick={stopCrawl} title="Stop the running crawl">
                Stop
              </Button>
            ) : (
              <Button variant="primary" onClick={startCrawl} disabled={!url.trim()}>
                Crawl
              </Button>
            )}

            {crawls.length > 0 && (
              <Select value={crawlId || ""} onChange={selectCrawl} className="max-w-[210px]">
                {crawls.map((c) => (
                  <option key={c.id} value={c.id}>
                    {new Date(c.startedAt).toLocaleDateString()} ·{" "}
                    {truncate(c.targetUrl.replace(/^https?:\/\//, ""), 22)} ({c.totalUrlsCrawled})
                  </option>
                ))}
              </Select>
            )}
          </div>

          {/* Live progress strip */}
          {(running || pct > 0 || progress) && (
            <div className="mt-2.5 animate-fade-in">
              <div className="flex items-center gap-2.5 mb-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse-soft" />
                <span className={`text-[11px] ${progress.startsWith("Error") ? "text-err" : "text-muted"}`}>
                  {progress}
                </span>
              </div>
              <ProgressBar percent={pct} />
            </div>
          )}
        </header>

        <main className="flex-1 overflow-auto p-6">
          {crawlId ? (
            <div className="animate-fade-in max-w-[1200px] mx-auto">
              <Routes>
                <Route path="/" element={<Overview crawlId={crawlId} crawl={crawl} />} />
                <Route path="/issues" element={<Issues crawlId={crawlId} />} />
                <Route path="/pages" element={<Pages crawlId={crawlId} />} />
                <Route path="/links" element={<Links crawlId={crawlId} />} />
                <Route path="/sitemaps" element={<Sitemaps crawlId={crawlId} />} />
                <Route path="/recommendations" element={<Recommendations crawlId={crawlId} />} />
                <Route path="/publishing" element={<Publishing />} />
                <Route path="/reputation" element={<Reputation />} />
                <Route path="/competitors" element={<Competitors crawlId={crawlId} />} />
                <Route path="/inspect" element={<Inspect />} />
                <Route path="/reports" element={<Reports crawlId={crawlId} />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-2xl font-bold shadow-2xl shadow-indigo-900/50 mb-5">
                S
              </div>
              <div className="text-lg font-semibold tracking-tight mb-1.5">
                Welcome to SEOForge 2.0
              </div>
              <div className="text-muted text-sm max-w-sm">
                Enter a URL above and press <span className="text-text font-medium">Crawl</span> to
                run a full-site audit — or use{" "}
                <span className="text-text font-medium">Inspect</span> for a single page.
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function OptRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
