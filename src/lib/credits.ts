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
  /** Average spend per day over the trend window, or null without enough data. */
  perDay: number | null;
  /** When the balance would reach zero at that rate, or null. */
  zeroAt: number | null;
  /** Days covered by the trend window. */
  windowDays: number;
}

const DAY = 86_400_000;
const TREND_WINDOW_DAYS = 30;

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

  // Trend: spend in the last 30 days (or since the first top-up, if that's more recent).
  const windowStart = Math.max(start, now - TREND_WINDOW_DAYS * DAY);
  const spent = runs
    .filter((r) => +new Date(r.at) >= windowStart && +new Date(r.at) <= now)
    .reduce((a, r) => a + r.cost_usd, 0);
  const windowDays = Math.max(1, (now - windowStart) / DAY); // at least a day, so one run doesn't explode the rate
  const perDay = spent > 0 ? spent / windowDays : null;
  const zeroAt = perDay && balance > 0 ? now + (balance / perDay) * DAY : null;

  return { points, current: balance, perDay, zeroAt, windowDays };
}
