/**
 * Claude API list prices in USD per million tokens (checked 2026-11).
 * Update these if Anthropic's pricing changes. Cache writes (5-minute TTL)
 * cost 1.25x input; cache reads are listed per model.
 */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** Cost of one response in USD. Unknown models (e.g. a refusal fallback) are priced like Opus 5.5, to err high. */
export function costUsd(model: string, u: TokenUsage): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1e6;
}

/** "$0.0123" below a cent, "$1.23" otherwise. */
export function formatUsd(v: number): string {
  if (v === 0) return "$0";
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}
