import { CHECKS } from "@/lib/score-checks";
import type { JobDetails } from "@/lib/types";

/**
 * The scorer's checklist, one short line per part of the fit: label, a segmented bar, the rating
 * out of its scale (0-5; jobs scored before the switch are 0-10) and a few words on why.
 * A dealbreaker (a fifth of the scale or less) shows in the bad colour.
 */
export function ScoreChecks({ checks }: { checks: NonNullable<JobDetails["score_checks"]> }) {
  const byKey = new Map(checks.map((c) => [c.key, c]));
  const rows = CHECKS.flatMap((c) => {
    const found = byKey.get(c.key);
    return found ? [{ ...found, label: c.label, max: found.max ?? 10 }] : [];
  });
  if (!rows.length) return null;
  return (
    <ul className="grid gap-1 text-[12px]" aria-label="Score checklist">
      {rows.map((c) => {
        const share = c.rating / c.max;
        const bad = share <= 0.2;
        const fill = bad ? "bg-[var(--bad)]" : "bg-[var(--accent)]";
        return (
          <li key={c.key} className="grid grid-cols-[64px_56px_36px_minmax(0,1fr)] items-center gap-2">
            <span className="mono faint uppercase tracking-wide text-[10.5px]">{c.label}</span>
            {/* One segment per point of the 0-5 scale, filled up to the rating. Old 0-10
                ratings keep a plain bar: ten segments in this width read as dots. */}
            {c.max <= 5 ? (
              <span className="flex h-1 gap-[2px]" aria-hidden="true">
                {Array.from({ length: c.max }, (_, i) => (
                  <span key={i} className={`flex-1 ${i < c.rating ? fill : "bg-[var(--border)]"}`} />
                ))}
              </span>
            ) : (
              <span className="h-1 bg-[var(--border)]" aria-hidden="true">
                <span className={`block h-full ${fill}`} style={{ width: `${share * 100}%` }} />
              </span>
            )}
            <span className={`mono text-right ${bad ? "text-[var(--bad)]" : ""}`}>
              {c.rating}
              <span className="faint">/{c.max}</span>
            </span>
            <span className="muted truncate" title={c.note}>
              {c.note}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
