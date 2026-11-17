/** Time helpers. Pages here are server-rendered per request, so reading the clock is intended. */
export const nowMs = () => Date.now();
export const daysAgoIso = (days: number) => new Date(nowMs() - days * 86_400_000).toISOString();
