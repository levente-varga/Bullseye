"use client";

import { useEffect, useRef, useState } from "react";

export type DayCount = { day: string; passed: number; filtered: number };
type View = "passed" | "all";

/**
 * New listings per day, one column per day. "Passed filters" (default) shows what made it
 * past your filters; "All new" stacks those on top of the filtered-out ones, which can be
 * 30x more (whole aggregator boards), so they'd flatten the first view. Hover a column for
 * both counts. Renders after mount at the container's real width.
 */
export function NewJobsChart({ days }: { days: DayCount[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<View>("passed");
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 200;
  const M = { top: 12, right: 8, bottom: 24, left: 44 };
  const iw = Math.max(1, width - M.left - M.right);
  const ih = H - M.top - M.bottom;
  const total = (d: DayCount) => (view === "all" ? d.passed + d.filtered : d.passed);
  const maxY = niceMax(Math.max(1, ...days.map(total)));
  const y = (v: number) => M.top + ih - (v / maxY) * ih;
  const band = iw / Math.max(1, days.length);
  const barW = Math.max(2, Math.min(40, band * 0.7));
  const barX = (i: number) => M.left + i * band + (band - barW) / 2;
  // A date under every column when they fit, else every few.
  const labelEvery = Math.max(1, Math.ceil(44 / band));
  const fmt = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const h = hover !== null ? days[hover] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex border border-[var(--border-strong)] text-[12px]" role="group" aria-label="Which listings">
          {(
            [
              ["passed", "Passed filters"],
              ["all", "All new"],
            ] as const
          ).map(([v, label], i) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`cursor-pointer px-2.5 py-1 ${i > 0 ? "border-l border-[var(--border-strong)]" : ""} ${view === v ? "bg-[var(--surface-2)]" : "muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "all" && (
          <div className="flex items-center gap-3 text-[12px]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5" style={{ background: "var(--accent)" }} /> Passed filters
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5" style={{ background: "var(--border-strong)" }} /> Filtered out
            </span>
          </div>
        )}
      </div>

      <div ref={wrap} className="relative w-full select-none" style={{ height: H }}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`New listings per day, ${days.length} days: ${days.map((d) => `${fmt(d.day)} ${d.passed} passed, ${d.filtered} filtered out`).join("; ")}`}
            onPointerLeave={() => setHover(null)}
          >
            {/* grid + y labels */}
            {[0, maxY / 2, maxY].map((v) => (
              <g key={v}>
                <line x1={M.left} x2={M.left + iw} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
                <text x={M.left - 8} y={y(v) + 3.5} textAnchor="end" className="mono" fontSize={11} fill="var(--faint)">
                  {compact(v)}
                </text>
              </g>
            ))}

            {days.map((d, i) => {
              const passedTop = y(view === "all" ? d.passed + d.filtered : d.passed);
              const filteredTop = y(d.filtered);
              const dim = hover !== null && hover !== i;
              return (
                <g key={d.day} opacity={dim ? 0.45 : 1}>
                  {view === "all" && d.filtered > 0 && (
                    <rect x={barX(i)} y={filteredTop} width={barW} height={y(0) - filteredTop} fill="var(--border-strong)" />
                  )}
                  {d.passed > 0 && (
                    // In the stack, a 2px surface gap separates it from the filtered part below.
                    <rect
                      x={barX(i)}
                      y={passedTop}
                      width={barW}
                      height={Math.max(1, (view === "all" ? filteredTop - 2 : y(0)) - passedTop)}
                      fill="var(--accent)"
                    />
                  )}
                  {i % labelEvery === 0 && (
                    <text x={barX(i) + barW / 2} y={H - 8} textAnchor="middle" className="mono" fontSize={11} fill="var(--faint)">
                      {fmt(d.day)}
                    </text>
                  )}
                  {/* hit area: the whole band, taller than the bar */}
                  <rect x={M.left + i * band} y={M.top} width={band} height={ih} fill="transparent" onPointerEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
        )}
        {h && hover !== null && (
          <div
            className="panel pointer-events-none absolute top-0 px-2.5 py-1.5 text-[12px]"
            style={{ left: Math.min(Math.max(barX(hover) + barW + 8, 0), Math.max(0, width - 178)), width: 170 }}
          >
            <div className="faint">{fmt(h.day)}</div>
            <div className="mt-0.5 flex justify-between">
              <span>Passed filters</span>
              <span className="mono">{h.passed.toLocaleString()}</span>
            </div>
            <div className="muted flex justify-between">
              <span>Filtered out</span>
              <span className="mono">{h.filtered.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A round axis maximum: 816 → 1,000, 28,871 → 30,000. */
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** 1500 → "1.5k", 30000 → "30k". */
function compact(v: number): string {
  return v >= 1000 ? `${Number((v / 1000).toFixed(1))}k` : String(Math.round(v));
}
