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
const HALF_LIFE_DAYS = 3;

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
  // so last week's runs dominate and a month-old spike fades out. Dividing by the
  // integral of the same weight over the observed span (since the first top-up) makes
  // it a true per-day rate: with steady spend it equals the plain average, and days
  // with no runs pull it down, as they should.
  const tau = (HALF_LIFE_DAYS * DAY) / Math.LN2;
  const span = Math.max(DAY, now - start); // at least a day, so one run doesn't explode the rate
  let weighted = 0;
  for (const r of runs) {
    const t = +new Date(r.at);
    if (t >= start && t <= now) weighted += r.cost_usd * Math.exp(-(now - t) / tau);
  }
  const weightDays = (tau * (1 - Math.exp(-span / tau))) / DAY;
  const perDay = weighted > 0 ? weighted / weightDays : null;
  const zeroAt = perDay && balance > 0 ? now + (balance / perDay) * DAY : null;

  return { points, current: balance, perDay, zeroAt, halfLifeDays: HALF_LIFE_DAYS };
}
