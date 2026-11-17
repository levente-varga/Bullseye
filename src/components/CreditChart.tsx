"use client";

import { useEffect, useRef, useState } from "react";
import type { BalancePoint } from "@/lib/credits";

/**
 * Remaining credit over time, with a dashed projection to $0.
 * Renders after mount at the container's real width (crisp text on any screen,
 * and dates in the viewer's own timezone).
 */
export function CreditChart(props: { points: BalancePoint[]; zeroAt: number | null; now: number }) {
  const { points, zeroAt, now } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220;
  const M = { top: 14, right: 16, bottom: 26, left: 56 };
  const start = points[0]?.t ?? now;
  const DAY = 86_400_000;
  const span = Math.max(now - start, DAY);
  // Show the projection up to $0 unless that's far away; then cap the horizon.
  const horizon = Math.max(3 * span, 14 * DAY);
  const end = zeroAt && zeroAt - now <= horizon ? zeroAt : now + (zeroAt ? horizon : Math.max(span * 0.15, DAY / 2));
  const current = points[points.length - 1]?.balance ?? 0;
  const projectedAt = (t: number) => (zeroAt ? Math.max(0, current - ((t - now) / (zeroAt - now)) * current) : current);
  const maxY = Math.max(0.01, ...points.map((p) => p.balance)) * 1.12;

  const iw = Math.max(1, width - M.left - M.right);
  const ih = H - M.top - M.bottom;
  const x = (t: number) => M.left + ((t - start) / (end - start)) * iw;
  const y = (v: number) => M.top + ih - (v / maxY) * ih;

  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.balance).toFixed(1)}`).join("");
  const area = `${path}L${x(now).toFixed(1)},${y(0)}L${x(start).toFixed(1)},${y(0)}Z`;
  const projEndT = end;
  const projEndV = zeroAt ? projectedAt(projEndT) : current;

  const ticks = [0, maxY / 2.24, maxY / 1.12].map((v) => Number(v.toFixed(2)));
  const fmtUsd = (v: number) => `$${v.toFixed(2)}`;
  const fmtDate = (t: number, withYear = false) =>
    new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });

  // Hover readout: nearest recorded point on the left of "now", the projection on the right.
  let readout: { t: number; v: number; label: string } | null = null;
  if (hoverX !== null) {
    const t = start + ((hoverX - M.left) / iw) * (end - start);
    if (t > now && zeroAt) {
      readout = { t, v: projectedAt(t), label: "projected" };
    } else {
      const nearest = points.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), points[0]);
      readout = {
        t: nearest.t,
        v: nearest.balance,
        label: nearest.kind === "topup" ? "top-up" : nearest.kind === "now" ? "now" : "after run",
      };
    }
  }

  return (
    <div ref={wrap} className="relative w-full select-none" style={{ height: H }}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={`Remaining API credit, now ${fmtUsd(current)}${zeroAt ? `, projected to run out around ${fmtDate(zeroAt, true)}` : ""}`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - r.left;
            setHoverX(px >= M.left && px <= M.left + iw ? px : null);
          }}
          onPointerLeave={() => setHoverX(null)}
        >
          {/* grid + y labels */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={M.left + iw} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={M.left - 8} y={y(v) + 3.5} textAnchor="end" className="mono" fontSize={11} fill="var(--faint)">
                {fmtUsd(v)}
              </text>
            </g>
          ))}
          {/* today marker */}
          <line x1={x(now)} x2={x(now)} y1={M.top} y2={M.top + ih} stroke="var(--border-strong)" strokeWidth={1} />

          {/* history */}
          <path d={area} fill="var(--accent)" opacity={0.1} />
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* projection */}
          {zeroAt && (
            <path
              d={`M${x(now).toFixed(1)},${y(current).toFixed(1)}L${x(projEndT).toFixed(1)},${y(projEndV).toFixed(1)}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeDasharray="5 5"
              strokeLinecap="round"
              opacity={0.75}
            />
          )}
          {zeroAt && end === zeroAt && (
            <circle cx={x(zeroAt)} cy={y(0)} r={4} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} />
          )}
          {/* $0 is beyond the chart's horizon: say when, at the end of the dashed line */}
          {zeroAt && end !== zeroAt && (
            <text
              x={M.left + iw}
              y={Math.max(M.top + 10, y(projEndV) - 10)}
              textAnchor="end"
              className="mono"
              fontSize={11}
              fill="var(--muted)"
            >
              $0 ≈ {fmtDate(zeroAt, true)} →
            </text>
          )}

          {/* entries (top-ups / corrections) and the current value */}
          {points
            .filter((p) => p.kind !== "run")
            .map((p) => (
              <circle key={`${p.kind}-${p.t}`} cx={x(p.t)} cy={y(p.balance)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
            ))}

          {/* x labels */}
          <text x={M.left} y={H - 8} className="mono" fontSize={11} fill="var(--faint)">
            {fmtDate(start)}
          </text>
          {x(now) - M.left > 60 && x(end) - x(now) > 60 && (
            <text x={x(now)} y={H - 8} textAnchor="middle" className="mono" fontSize={11} fill="var(--muted)">
              today
            </text>
          )}
          <text x={M.left + iw} y={H - 8} textAnchor="end" className="mono" fontSize={11} fill="var(--faint)">
            {fmtDate(end, true)}
          </text>

          {/* crosshair */}
          {readout && (
            <g pointerEvents="none">
              <line x1={x(readout.t)} x2={x(readout.t)} y1={M.top} y2={M.top + ih} stroke="var(--muted)" strokeWidth={1} />
              <circle cx={x(readout.t)} cy={y(readout.v)} r={4} fill="var(--fg)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {readout && (
        <div
          className="panel pointer-events-none absolute top-1 px-2.5 py-1.5 text-[12px] shadow-none"
          style={{ left: Math.min(Math.max(x(readout.t) + 10, 0), Math.max(0, width - 170)), width: 160 }}
        >
          <div className="mono text-[13px]">{fmtUsd(readout.v)}</div>
          <div className="faint">
            {fmtDate(readout.t, true)} · {readout.label}
          </div>
        </div>
      )}
    </div>
  );
}
