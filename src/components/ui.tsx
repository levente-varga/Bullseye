/** Bullseye's small component set: square, bordered, dense. Styles live in globals.css. */
import type { ReactNode } from "react";

export function PageHeader(props: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="page-title">{props.title}</h1>
        {props.meta && <div className="muted mt-2 text-[13px]">{props.meta}</div>}
      </div>
      {props.actions && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
    </header>
  );
}

export function SectionHeader(props: { title: string; count?: number | string; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 className="section-title">
        {props.title}
        {props.count !== undefined && <span className="mono faint ml-2 align-middle text-[13px]">{props.count}</span>}
      </h2>
      {props.actions && <div className="flex flex-wrap items-center gap-2 text-[12px]">{props.actions}</div>}
    </div>
  );
}

/** A bordered panel; `title` adds a small uppercase header row. */
export function Panel(props: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  // `!= null`, not truthiness: a count of 0 is a real value (and `{0 && …}` would render a bare "0").
  const hasAside = props.aside != null && props.aside !== false && props.aside !== "";
  return (
    <section className={`panel ${props.className ?? ""}`}>
      {(props.title || hasAside) && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
          <span className="eyebrow">{props.title}</span>
          {hasAside && <span className="mono faint text-[11px]">{props.aside}</span>}
        </div>
      )}
      {props.children}
    </section>
  );
}

export type Tone = "ok" | "warn" | "bad" | "accent" | "muted";

export function Pill({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Dot({ tone = "muted", title }: { tone?: Tone; title?: string }) {
  const color = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", accent: "var(--accent)", muted: "var(--faint)" }[tone];
  return <span className="dot" style={{ background: color }} title={title} aria-label={title} role={title ? "img" : undefined} />;
}

/** Thin bar on a hatched track. `value` is 0–100. */
export function Bar({ value, tone = "accent", className }: { value: number; tone?: Tone; className?: string }) {
  const color = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", accent: "var(--accent)", muted: "var(--faint)" }[tone];
  return (
    <div className={`bar ${className ?? ""}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

/** Score tiers used across the app. */
export function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return "muted";
  if (score >= 85) return "ok";
  if (score >= 60) return "accent";
  if (score >= 40) return "warn";
  return "muted";
}

/** Score as a mono number over a thin bar. */
export function ScoreMeter({ score, width = "w-9" }: { score: number | null; width?: string }) {
  return (
    <div className={`${width} shrink-0`}>
      <div className="mono mb-1 text-[11px]" style={{ color: score != null && score >= 60 ? "var(--fg)" : "var(--muted)" }}>
        {score ?? "–"}
      </div>
      <Bar value={score ?? 0} tone={scoreTone(score)} />
    </div>
  );
}

/** Big number with a small muted unit, as in "$1542.27 list price". */
export function Stat(props: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; small?: boolean }) {
  return (
    <div className={props.small ? "px-3 py-2.5" : "px-4 py-3"}>
      <div className="eyebrow mb-1.5">{props.label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`mono leading-none tracking-tight ${props.small ? "text-[1.1rem]" : "text-[1.6rem]"}`}>{props.value}</span>
        {props.unit && <span className="faint text-[12px]">{props.unit}</span>}
      </div>
      {props.sub && <div className="faint mt-1.5 text-[12px]">{props.sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted px-4 py-10 text-center text-[13px]">{children}</div>;
}
