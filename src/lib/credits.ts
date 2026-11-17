/**
 * Remaining Anthropic credit over time. There's no API for the balance, so it
 * is reconstructed: start from the balances you enter by hand (top-ups or
 * corrections) and subtract each run's recorded API cost since.
 */

export interface CreditEntry {
  id: string;
  entered_at: string;
  balance_usd: number;
  note: string | null;
}

export interface CostedRun {
  at: string; // when the run finished
  cost_usd: number;
}

export interface BalancePoint {
  t: number; // epoch ms
  balance: number;
  kind: "entry" | "run" | "now";
  label?: string;
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

export function buildSeries(entries: CreditEntry[], runs: CostedRun[], now: number): CreditSeries | null {
  const sortedEntries = [...entries].sort((a, b) => +new Date(a.entered_at) - +new Date(b.entered_at));
  if (!sortedEntries.length) return null;
  const start = +new Date(sortedEntries[0].entered_at);

  type Event = { t: number; entry?: CreditEntry; cost?: number };
  const events: Event[] = [
    ...sortedEntries.map((e) => ({ t: +new Date(e.entered_at), entry: e })),
    ...runs.filter((r) => +new Date(r.at) >= start).map((r) => ({ t: +new Date(r.at), cost: r.cost_usd })),
  ].sort((a, b) => a.t - b.t);

  const points: BalancePoint[] = [];
  let balance = 0;
  for (const ev of events) {
    if (ev.entry) {
      // A manual entry resets the balance to the true value (a jump in the line).
      if (points.length) points.push({ t: ev.t, balance, kind: "run" });
      balance = Number(ev.entry.balance_usd);
      points.push({ t: ev.t, balance, kind: "entry", label: ev.entry.note ?? undefined });
    } else {
      balance = Math.max(0, balance - (ev.cost ?? 0));
      points.push({ t: ev.t, balance, kind: "run" });
    }
  }
  points.push({ t: now, balance, kind: "now" });

  // Trend: spend in the last 30 days (or since the first entry, if that's more recent).
  const windowStart = Math.max(start, now - TREND_WINDOW_DAYS * DAY);
  const spent = runs
    .filter((r) => +new Date(r.at) >= windowStart && +new Date(r.at) <= now)
    .reduce((a, r) => a + r.cost_usd, 0);
  const windowDays = Math.max(1, (now - windowStart) / DAY); // at least a day, so one run doesn't explode the rate
  const perDay = spent > 0 ? spent / windowDays : null;
  const zeroAt = perDay && balance > 0 ? now + (balance / perDay) * DAY : null;

  return { points, current: balance, perDay, zeroAt, windowDays };
}
