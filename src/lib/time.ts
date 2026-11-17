/** Time helpers. Pages here are server-rendered per request, so reading the clock is intended. */
export const nowMs = () => Date.now();
export const daysAgoIso = (days: number) => new Date(nowMs() - days * 86_400_000).toISOString();

/** Compact relative time: "now", "5m", "3h", "2d", "4w", "3mo". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (nowMs() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 86_400 * 14) return `${Math.floor(s / 86_400)}d`;
  if (s < 86_400 * 60) return `${Math.floor(s / (86_400 * 7))}w`;
  return `${Math.floor(s / (86_400 * 30))}mo`;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
