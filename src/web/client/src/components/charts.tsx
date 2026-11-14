import React, { useState } from "react";

/* Colors come from theme tokens so charts follow light/dark mode. */
export const TONE = {
  ok: "var(--color-ok)",
  warn: "var(--color-warn)",
  err: "var(--color-err)",
  note: "var(--color-note)",
  accent: "var(--color-accent)",
  faint: "var(--color-faint)",
} as const;

const fmt = (n: number) => n.toLocaleString();

/* ------------------------------------------------------------------ */
/* ScoreDial — 0–100 ring                                               */
/* ------------------------------------------------------------------ */
export function ScoreDial({ score, size = 104, label = "/ 100" }: { score: number; size?: number; label?: string }) {
  const stroke = 8;
  const r = size / 2 - stroke;
  const circ = 2 * Math.PI * r;
  const color = score >= 90 ? TONE.ok : score >= 70 ? TONE.warn : TONE.err;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Score ${score} of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (Math.max(0, Math.min(100, score)) / 100) * circ}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold tabular-nums" style={{ color }}>
          {score}
        </span>
        <span className="text-[9px] text-faint uppercase tracking-wide">{label}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BarList — labelled horizontal bars, each row optionally a link       */
/* ------------------------------------------------------------------ */
export interface BarItem {
  label: string;
  value: number;
  color?: string;
  onClick?: () => void;
  hint?: string;
}

export function BarList({ items, total }: { items: BarItem[]; total?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const sum = total ?? items.reduce((a, i) => a + i.value, 0);
  return (
    <div className="space-y-1">
      {items.map((item) => {
        const pct = sum ? (item.value / sum) * 100 : 0;
        const Row = item.onClick && item.value > 0 ? "button" : "div";
        return (
          <Row
            key={item.label}
            onClick={item.value > 0 ? item.onClick : undefined}
            title={item.hint ?? `${item.label}: ${fmt(item.value)} (${pct.toFixed(1)}%)`}
            className={`group w-full grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 text-left text-xs py-1 px-1.5 -mx-1.5 rounded-md ${
              Row === "button" ? "hover:bg-panel2 cursor-pointer" : ""
            }`}
          >
            <span className="text-muted truncate">{item.label}</span>
            <span className="h-2 rounded-full bg-panel3 overflow-hidden">
              <span
                className="block h-full rounded-full transition-all duration-500 group-hover:brightness-125"
                style={{ width: `${(item.value / max) * 100}%`, background: item.color ?? TONE.accent }}
              />
            </span>
            <span className="tabular-nums text-text w-24 text-right">
              {fmt(item.value)} <span className="text-faint">· {pct < 0.1 && pct > 0 ? "<0.1" : pct.toFixed(pct < 10 ? 1 : 0)}%</span>
            </span>
          </Row>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StackedBarList — Error / Warning / Notice per category               */
/* ------------------------------------------------------------------ */
export interface StackedItem {
  label: string;
  parts: { value: number; color: string; name: string }[];
  onClick?: () => void;
}

export function StackedBarList({ items }: { items: StackedItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.parts.reduce((a, p) => a + p.value, 0)));
  return (
    <div className="space-y-1">
      {items.map((item) => {
        const sum = item.parts.reduce((a, p) => a + p.value, 0);
        return (
          <button
            key={item.label}
            onClick={item.onClick}
            title={item.parts.map((p) => `${p.name}: ${fmt(p.value)}`).join(" · ")}
            className="group w-full grid grid-cols-[minmax(90px,120px)_1fr_auto] items-center gap-3 text-left text-xs py-1 px-1.5 -mx-1.5 rounded-md hover:bg-panel2 cursor-pointer"
          >
            <span className="text-muted truncate">{item.label}</span>
            <span className="h-2 rounded-full bg-panel3 overflow-hidden flex" style={{ width: `${Math.max(2, (sum / max) * 100)}%` }}>
              {item.parts.map((p) =>
                p.value > 0 ? (
                  <span
                    key={p.name}
                    className="block h-full group-hover:brightness-125 transition-all"
                    style={{ width: `${(p.value / sum) * 100}%`, background: p.color }}
                  />
                ) : null
              )}
            </span>
            <span className="tabular-nums text-text w-16 text-right">{fmt(sum)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ColumnChart — vertical bars with x labels and hover readout          */
/* ------------------------------------------------------------------ */
export function ColumnChart({
  data,
  color = TONE.accent,
  onSelect,
  height = 120,
}: {
  data: { label: string; value: number }[];
  color?: string;
  onSelect?: (index: number) => void;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }} onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <button
            key={d.label}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => d.value > 0 && onSelect?.(i)}
            aria-label={`${d.label}: ${fmt(d.value)}`}
            className="flex-1 h-full flex flex-col justify-end items-center cursor-pointer"
          >
            <span className={`text-[10px] tabular-nums mb-1 ${hover === i ? "text-text" : "text-faint"}`}>{fmt(d.value)}</span>
            <span
              className="w-full rounded-t-md transition-all duration-300"
              style={{
                height: `${Math.max(d.value > 0 ? 3 : 0, (d.value / max) * (height - 18))}px`,
                background: color,
                opacity: hover === null || hover === i ? 1 : 0.45,
              }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5 border-t border-border pt-1.5">
        {data.map((d) => (
          <span key={d.label} className="flex-1 text-center text-[10px] text-faint truncate">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LineChart — crawl-over-crawl trend with hover crosshair              */
/* ------------------------------------------------------------------ */
export interface Series {
  name: string;
  color: string;
  values: number[];
  /** Fixed max for the y scale (e.g. 100 for scores); otherwise auto. */
  max?: number;
}

export function LineChart({ labels, series, height = 160 }: { labels: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 560;
  const pad = { l: 8, r: 8, t: 10, b: 22 };
  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? (width - pad.l - pad.r) / 2 : (i / (n - 1)) * (width - pad.l - pad.r));
  const y = (v: number, max: number) => pad.t + (1 - v / Math.max(1, max)) * (height - pad.t - pad.b);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * width;
          const i = n <= 1 ? 0 : Math.round(((px - pad.l) / (width - pad.l - pad.r)) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={pad.l}
            x2={width - pad.r}
            y1={pad.t + f * (height - pad.t - pad.b)}
            y2={pad.t + f * (height - pad.t - pad.b)}
            stroke="var(--color-border)"
            strokeDasharray={f === 1 ? undefined : "3 4"}
          />
        ))}
        {series.map((s) => {
          const max = s.max ?? Math.max(1, ...s.values);
          return (
            <g key={s.name}>
              <polyline
                points={s.values.map((v, i) => `${x(i)},${y(v, max)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v, max)} r={hover === i ? 4 : 2.5} fill={s.color} />
              ))}
            </g>
          );
        })}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--color-border2)" />
        )}
        {labels.map((l, i) =>
          n <= 6 || i === 0 || i === n - 1 || i === hover ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--color-faint)">
              {l}
            </text>
          ) : null
        )}
      </svg>
      {hover !== null && (
        <div
          className="absolute top-0 pointer-events-none bg-panel border border-border2 rounded-lg px-2.5 py-1.5 text-[11px] shadow-xl"
          style={{ left: `${(x(hover) / width) * 100}%`, transform: `translateX(${hover > n / 2 ? "-105%" : "5%"})` }}
        >
          <div className="text-faint mb-0.5">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
              <span className="text-muted">{s.name}</span>
              <span className="tabular-nums text-text ml-auto pl-3">{fmt(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-4 text-[11px] text-muted mt-1">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: s.color }} /> {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
