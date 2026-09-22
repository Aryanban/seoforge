import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Card, Button, Spinner } from "../components/ui.js";
import { PageHeader } from "../components/ui.js";

const CLI_HINTS = [
  "seoforge crawl https://example.com --depth 5 --limit 500",
  "seoforge crawl https://example.com --render   # SPA / Core Web Vitals",
  "seoforge inspect https://example.com/page",
  "seoforge export html --crawl <id>",
  "seoforge mcp   # agent interface over stdio",
];

export default function Settings() {
  const [config, setConfig] = useState<any>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [valid, setValid] = useState(true);

  useEffect(() => {
    api<any>("/api/config")
      .then((c) => {
        setConfig(c);
        setDraft(JSON.stringify(c, null, 2));
      })
      .catch(() => setMessage("No seoforge.config.json found in the working directory."));
  }, []);

  const validate = (text: string) => {
    try {
      JSON.parse(text);
      setValid(true);
      return true;
    } catch {
      setValid(false);
      return false;
    }
  };

  const save = async () => {
    if (!validate(draft)) {
      setMessage("Invalid JSON — fix the syntax errors before saving.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await api("/api/config", { method: "PUT", body: draft });
      setMessage("Saved ✓");
      setConfig(JSON.parse(draft));
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!config) return <Spinner label="Loading config…" />;

  const domainCount = config.domains?.length ?? 0;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="Configuration lives in seoforge.config.json. Edit below to change domains, thresholds, and crawl defaults."
      />

      {domainCount > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          {config.domains.map((d: any) => (
            <Card key={d.url} className="p-3.5">
              <div className="text-sm font-medium truncate">{d.name}</div>
              <div className="text-xs text-muted truncate mt-0.5">{d.url}</div>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {d.expectedEntities?.slice(0, 2).map((e: string) => (
                  <span
                    key={e}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/12 text-indigo-300 border border-indigo-500/20"
                  >
                    {e}
                  </span>
                ))}
                {d.expectedEntities?.length > 2 && (
                  <span className="text-[10px] text-faint">
                    +{d.expectedEntities.length - 2}
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">seoforge.config.json</span>
            {!valid && (
              <span className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/25 px-1.5 py-0.5 rounded">
                invalid JSON
              </span>
            )}
          </div>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            validate(e.target.value);
          }}
          spellCheck={false}
          className={`w-full h-96 bg-panel2 border rounded-lg p-3 font-mono text-xs leading-relaxed transition-colors focus:outline-none ${
            valid
              ? "border-border focus:border-indigo-500/70"
              : "border-red-500/40 focus:border-red-500/60"
          }`}
        />
        {message && (
          <div
            className={`text-xs mt-2.5 ${message.startsWith("Error") || message.startsWith("Invalid") ? "text-err" : "text-emerald-400"}`}
          >
            {message}
          </div>
        )}
      </Card>

      <Card className="p-4 mt-4">
        <div className="text-sm font-semibold mb-2">CLI equivalents</div>
        <div className="space-y-1.5 font-mono text-[11px] text-muted">
          {CLI_HINTS.map((h) => (
            <div key={h} className="flex items-center gap-2">
              <span className="text-indigo-400">$</span>
              {h}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
