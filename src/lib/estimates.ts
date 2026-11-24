import type { SupabaseClient } from "@supabase/supabase-js";
import { costUsd, type TokenUsage } from "./pricing";

/**
 * Cost estimates for the buttons that spend AI credit. They average the tokens of the
 * person's last few tasks of that kind (their career's length drives the size) and price
 * them at the model the setting points to now, so switching models moves the estimate at
 * once. Without history of their own: the account's last few (what RLS lets them read),
 * then a typical size. `guessed` marks those, shown as "≈" instead of "~".
 */

const LAST_N = 5;

export type AiKind = "career_import" | "cv_draft" | "letter_questions" | "cover_letter" | "rescore";

export interface Estimate {
  usd: number;
  /** Not from this person's own history. */
  guessed: boolean;
}

/** Typical token use per task, measured on real tasks (Nov 2026), for when there's no history. */
const TYPICAL: Record<AiKind, TokenUsage> = {
  career_import: { input: 5000, output: 3500, cacheWrite: 0, cacheRead: 0 },
  cv_draft: { input: 4600, output: 3200, cacheWrite: 0, cacheRead: 0 },
  letter_questions: { input: 3000, output: 150, cacheWrite: 0, cacheRead: 0 },
  cover_letter: { input: 3600, output: 1000, cacheWrite: 0, cacheRead: 0 },
  rescore: { input: 3800, output: 310, cacheWrite: 0, cacheRead: 0 },
};

type UsageRow = { tokens_in: number; tokens_out: number; tokens_cache_write: number; tokens_cache_read: number };

/** The average usage of some tasks; tokens_in is the total input, the cache columns its parts. */
function average(rows: UsageRow[]): TokenUsage {
  const n = rows.length;
  const sum = (f: (r: UsageRow) => number) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0) / n;
  const cacheWrite = sum((r) => r.tokens_cache_write);
  const cacheRead = sum((r) => r.tokens_cache_read);
  return { input: Math.max(0, sum((r) => r.tokens_in) - cacheWrite - cacheRead), output: sum((r) => r.tokens_out), cacheWrite, cacheRead };
}

export async function estimateTask(supabase: SupabaseClient, userId: string, kind: AiKind, model: string): Promise<Estimate> {
  const cols = "tokens_in, tokens_out, tokens_cache_write, tokens_cache_read";
  const recent = (mine: boolean) => {
    const q = supabase.from("ai_usage").select(cols).eq("kind", kind).order("created_at", { ascending: false }).limit(LAST_N);
    return mine ? q.eq("user_id", userId) : q;
  };
  const { data: own } = await recent(true);
  if (own?.length) return { usd: costUsd(model, average(own as UsageRow[])), guessed: false };
  const { data: any } = await recent(false);
  if (any?.length) return { usd: costUsd(model, average(any as UsageRow[])), guessed: true };
  return { usd: costUsd(model, TYPICAL[kind]), guessed: true };
}

/**
 * Scoring one job in a run, from the person's last few runs that scored something. Runs
 * since the cache split was recorded are priced at the current model; older ones count
 * by what they cost. Without runs: a single re-score's estimate (a little high: a run
 * reads the cached prompt, a single re-score writes it).
 */
export async function estimateScoringPerJob(supabase: SupabaseClient, userId: string, model: string): Promise<Estimate> {
  const { data } = await supabase
    .from("runs")
    .select("started_at, run_users!inner(user_id, stats)")
    .eq("run_users.user_id", userId)
    .gt("run_users.stats->scored", 0)
    .order("started_at", { ascending: false })
    .limit(LAST_N);
  type Stats = { scored?: number; cost_usd?: number; tokens_in?: number; tokens_out?: number; tokens_cache_write?: number; tokens_cache_read?: number };
  const stats = (data ?? []).flatMap((r) => (r.run_users as { stats: Stats }[]).map((u) => u.stats));
  let cost = 0;
  let jobs = 0;
  for (const s of stats) {
    const scored = Number(s.scored) || 0;
    if (!scored) continue;
    jobs += scored;
    if (s.tokens_cache_read !== undefined) {
      const write = Number(s.tokens_cache_write) || 0;
      const read = Number(s.tokens_cache_read) || 0;
      cost += costUsd(model, { input: Math.max(0, (Number(s.tokens_in) || 0) - write - read), output: Number(s.tokens_out) || 0, cacheWrite: write, cacheRead: read });
    } else {
      cost += Number(s.cost_usd) || 0;
    }
  }
  if (jobs) return { usd: cost / jobs, guessed: false };
  return { ...(await estimateTask(supabase, userId, "rescore", model)), guessed: true };
}

/** "~$0.02", "~$0.0008", "~$1.40"; "≈" when it isn't from the person's own history. */
export function formatEstimate(e: Estimate): string {
  const v = e.usd;
  const text = v >= 1 ? v.toFixed(2) : v > 0 ? String(Number(v.toPrecision(2))) : "0";
  return `${e.guessed ? "≈" : "~"}$${text}`;
}
