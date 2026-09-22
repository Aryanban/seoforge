import React from "react";

/* ------------------------------------------------------------------ */
/* Card — layered surface with optional hover lift                     */
/* ------------------------------------------------------------------ */
export function Card({
  children,
  className = "",
  hover = false,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={`bg-panel border border-border rounded-xl ${hover ? "transition-colors hover:border-border2" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */
export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  className = "",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const sizes = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm";
  const styles =
    variant === "primary"
      ? "bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-500 shadow-sm shadow-indigo-900/40"
      : variant === "danger"
      ? "bg-red-500/10 text-err border-red-500/30 hover:bg-red-500/20"
      : variant === "ghost"
      ? "bg-transparent text-muted border-transparent hover:text-text hover:bg-panel3"
      : "bg-panel3 text-zinc-200 border-border hover:bg-border2/60";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${sizes} ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Badge — severity / status pills                                     */
/* ------------------------------------------------------------------ */
export function Badge({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */
export function Input({
  value,
  onChange,
  placeholder,
  className = "",
  onKeyDown,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={`bg-panel2 border border-border text-text rounded-lg px-3 py-1.5 text-sm placeholder:text-faint transition-colors focus:outline-none focus:border-indigo-500/70 focus:bg-panel3 ${className}`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Select — styled native dropdown                                     */
/* ------------------------------------------------------------------ */
export function Select({
  value,
  onChange,
  children,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-panel2 border border-border text-text rounded-lg px-2.5 py-1.5 text-sm cursor-pointer transition-colors focus:outline-none focus:border-indigo-500/70 ${className}`}
    >
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs — segmented control                                            */
/* ------------------------------------------------------------------ */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 bg-panel2 border border-border rounded-lg p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
            value === tab.id
              ? "bg-indigo-600/90 text-white shadow-sm"
              : "text-muted hover:text-text"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Spinner / Skeleton / EmptyState                                     */
/* ------------------------------------------------------------------ */
export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-muted animate-fade-in">
      <div className="animate-spin h-5 w-5 border-2 border-border border-t-indigo-400 rounded-full mr-3" />
      {label}
    </div>
  );
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-9 rounded-lg border border-border"
          style={{
            background:
              "linear-gradient(90deg, var(--color-panel2) 8%, var(--color-panel3) 20%, var(--color-panel2) 33%)",
            backgroundSize: "460px 100%",
            animation: "shimmer 1.3s linear infinite",
          }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  message,
  hint,
}: {
  message: string;
  hint?: string;
}) {
  return (
    <div className="text-center py-16 animate-fade-in">
      <div className="text-4xl mb-3 opacity-30">◈</div>
      <div className="text-muted text-sm">{message}</div>
      {hint && <div className="text-faint text-xs mt-1.5">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StatusDot — HTTP status indicator                                   */
/* ------------------------------------------------------------------ */
export function StatusDot({ status }: { status: number }) {
  const color =
    status === 200
      ? "bg-emerald-400"
      : status >= 400 || status === 0
      ? "bg-red-400"
      : status >= 300
      ? "bg-amber-400"
      : "bg-zinc-400";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} mr-2`} />;
}

/* ------------------------------------------------------------------ */
/* ProgressBar — live crawl progress                                   */
/* ------------------------------------------------------------------ */
export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-1 w-full bg-panel3 rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-indigo-500 to-violet-400 rounded-full transition-all duration-300"
        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PageHeader — consistent view header                                 */
/* ------------------------------------------------------------------ */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted text-sm mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
