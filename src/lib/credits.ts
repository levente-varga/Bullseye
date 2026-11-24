/**
 * Remaining Anthropic credit over time. There's no API for the balance, so it
 * is reconstructed: the top-ups you enter by hand, minus each run's recorded
 * API cost from the day of the first top-up on.
 */

export interface TopUp {
  id: string;
  /** The day of the top-up (stored as that day's midnight UTC). */
  entered_at: string;
  amount_usd: number;
}

export interface CostedRun {
  at: string; // when the run finished
  cost_usd: number;
}

export interface BalancePoint {
  t: number; // epoch ms
  balance: number;
  kind: "topup" | "run" | "now";
}

export interface CreditSeries {
  points: BalancePoint[];
  current: number;
  /** Spend per day, weighted towards recent days, or null without enough data. */
  perDay: number | null;
  /** When the balance would reach zero at that rate, or null. */
  zeroAt: number | null;
  /** Half-life of the weighting, in days: spend this old counts half as much as today's. */
  halfLifeDays: number;
}

const DAY = 86_400_000;
const HALF_LIFE_DAYS = 2;
/** A day's spend counts at most this many times the median of the last SPIKE_WINDOW_DAYS days. */
const SPIKE_CAP = 2;
/** Short, so a lasting rise counts in full once it's two of the last three days. */
const SPIKE_WINDOW_DAYS = 3;

/** Midnight UTC of the given time's day: a top-up counts for its whole day, so that day's runs are included. */
export const dayStart = (iso: string) => {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export function buildSeries(topUps: TopUp[], runs: CostedRun[], now: number): CreditSeries | null {
  if (!topUps.length) return null;
  const tops = topUps.map((t) => ({ t: dayStart(t.entered_at), amount: Number(t.amount_usd) })).sort((a, b) => a.t - b.t);
  const start = tops[0].t;

  type Event = { t: number; delta: number; kind: "topup" | "run" };
  const events: Event[] = [
    ...tops.map((t) => ({ t: t.t, delta: t.amount, kind: "topup" as const })),
    ...runs
      .map((r) => ({ t: +new Date(r.at), delta: -r.cost_usd, kind: "run" as const }))
      .filter((e) => e.t >= start && e.t <= now),
  ].sort((a, b) => a.t - b.t || (a.kind === "topup" ? -1 : 1)); // top-ups first within the same instant

  const points: BalancePoint[] = [];
  let balance = 0;
  for (const ev of events) {
    // A later top-up is a vertical jump: keep the balance just before it.
    if (ev.kind === "topup" && points.length) points.push({ t: ev.t, balance, kind: "run" });
    balance = Math.max(0, balance + ev.delta);
    points.push({ t: ev.t, balance, kind: ev.kind });
  }
  points.push({ t: now, balance, kind: "now" });

  // Trend: an exponentially weighted spend rate. Each run's cost counts e^(-age/tau),
  // so the last few days dominate. Dividing by the integral of the same weight over the
  // observed span (since the first top-up) makes it a true per-day rate: with steady
  // spend it equals the plain average, and days with no runs pull it down.
  // A one-off spike (a backlog scored after adding sources) isn't a trend: each day's
  // spend is trimmed to SPIKE_CAP times the median of the last 3 days: a single
  // high day is trimmed, two in a row are the new normal.
  const tau = (HALF_LIFE_DAYS * DAY) / Math.LN2;
  const span = Math.max(DAY, now - start); // at least a day, so one run doesn't explode the rate
  const inRange = runs.filter((r) => +new Date(r.at) >= start && +new Date(r.at) <= now);
  const dayOf = (t: number) => Math.floor((now - t) / DAY); // 0 = the last 24 hours
  const perDayTotal = new Map<number, number>();
  for (const r of inRange) {
    const d = dayOf(+new Date(r.at));
    perDayTotal.set(d, (perDayTotal.get(d) ?? 0) + r.cost_usd);
  }
  const recent = Array.from({ length: Math.min(SPIKE_WINDOW_DAYS, Math.ceil(span / DAY)) }, (_, d) => perDayTotal.get(d) ?? 0).sort((a, b) => a - b);
  const median = recent.length ? (recent[(recent.length - 1) >> 1] + recent[recent.length >> 1]) / 2 : 0;
  const cap = median > 0 ? SPIKE_CAP * median : Infinity;
  let weighted = 0;
  for (const r of inRange) {
    const t = +new Date(r.at);
    const dayTotal = perDayTotal.get(dayOf(t)) ?? 0;
    const trim = dayTotal > cap ? cap / dayTotal : 1;
    weighted += r.cost_usd * trim * Math.exp(-(now - t) / tau);
  }
  const weightDays = (tau * (1 - Math.exp(-span / tau))) / DAY;
  const perDay = weighted > 0 ? weighted / weightDays : null;
  const zeroAt = perDay && balance > 0 ? now + (balance / perDay) * DAY : null;

  return { points, current: balance, perDay, zeroAt, halfLifeDays: HALF_LIFE_DAYS };
}
