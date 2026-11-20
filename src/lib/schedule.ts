/**
 * The run schedule, set on the Criteria page. GitHub Actions wakes the worker
 * every 15 minutes ("tick"); these functions decide what is due at that moment.
 */
import type { Settings } from "./types";

const MIN = 60_000;
/** Ticks drift by a few minutes; treat an interval as elapsed slightly early. */
const TOLERANCE = 5 * MIN;

type Schedule = Pick<Settings, "watch_interval_minutes" | "daily_time" | "daily_enabled" | "timezone">;

/** Calendar date ("YYYY-MM-DD") of `t` in `tz`. */
export function localDate(t: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

/** Offset of `tz` from UTC at instant `t`, in ms (e.g. +1h for Europe/Budapest in winter). */
function tzOffset(t: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(t)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** The instant when it's `hhmm` on `date` in `tz` (handles DST by re-checking the offset). */
export function zonedTime(date: string, hhmm: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - tzOffset(guess, tz);
  return guess - tzOffset(first, tz);
}

/** "YYYY-MM-DD" shifted by whole calendar days (no clock math, so DST can't skip or repeat a day). */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The most recent daily slot at or before `now`, and the next one after it. */
export function dailySlots(s: Schedule, now: number): { last: number; next: number } {
  const date = localDate(now, s.timezone);
  const today = zonedTime(date, s.daily_time, s.timezone);
  if (today <= now) return { last: today, next: zonedTime(addDays(date, 1), s.daily_time, s.timezone) };
  return { last: zonedTime(addDays(date, -1), s.daily_time, s.timezone), next: today };
}

/**
 * What to run now. The daily run is due once its slot has passed and no full run
 * has started since; it covers every source, so a watchlist check is skipped then.
 * The watchlist is due when its interval has elapsed since the last watchlist or full run.
 */
export function dueNow(
  s: Schedule,
  last: { watchlist: number | null; full: number | null },
  now: number,
): { daily: boolean; watchlist: boolean } {
  const daily = s.daily_enabled && (last.full === null || last.full < dailySlots(s, now).last);
  const lastCheck = Math.max(last.watchlist ?? 0, last.full ?? 0);
  const watchlist =
    !daily && s.watch_interval_minutes > 0 && now - lastCheck >= s.watch_interval_minutes * MIN - TOLERANCE;
  return { daily, watchlist };
}

/** For the UI: roughly when each run happens next (the tick adds up to ~15 minutes). */
export function nextRuns(s: Schedule, last: { watchlist: number | null; full: number | null }, now: number) {
  const due = dueNow(s, last, now);
  const daily = !s.daily_enabled ? null : due.daily ? now : dailySlots(s, now).next;
  const lastCheck = Math.max(last.watchlist ?? 0, last.full ?? 0);
  const watchlist = s.watch_interval_minutes === 0 ? null : Math.max(now, lastCheck + s.watch_interval_minutes * MIN);
  return { daily, watchlist };
}

/** IANA timezone names for the picker (falls back to a short list on old runtimes). */
export function timezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? ["UTC", "Europe/London", "Europe/Budapest", "Europe/Stockholm", "America/New_York"];
}

/** "today 07:00", "tomorrow 07:00", a date, or "off", in the schedule's timezone. */
export function formatNextRun(t: number | null, tz: string, now: number): string {
  if (t === null) return "off";
  if (t <= now + 60_000) return "at the next check (within ~15 min)";
  const day = (x: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(t);
  const label = day(t) === day(now) ? "today" : day(t) === day(now + 86_400_000) ? "tomorrow" : day(t);
  return `${label} ${time}`;
}
