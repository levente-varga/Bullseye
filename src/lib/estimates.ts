import type { SupabaseClient } from "@supabase/supabase-js";
import { costUsd, type TokenUsage } from "./pricing";
import type { Effort } from "./types";

/**
 * Cost estimates for the buttons that spend AI credit. They average the tokens of recent
 * tasks of that kind and price them at the model the setting points to now. The closest
 * history wins:
 *   1. your own last few at the same model and thinking level: an estimate ("~$0.002");
 *   2. otherwise the nearest thing, marked as a guess ("~$0.002*"): your own at the same
 *      level on another model, then your own at another level with its output scaled to
 *      this one, then the same from the account's tasks (what RLS lets you read), then a
 *      typical size measured on real tasks.
 * Thinking is billed as output, so a level mostly moves the output tokens; the scale below
 * is a rough guide, replaced by real numbers once a few tasks have run at the new level.
 */

const LAST_N = 5;
/** How many recent rows to look through for a match (per person, and for the account). */
const LOOKBACK = 40;

export type AiKind = "career_import" | "cv_draft" | "letter_questions" | "cover_letter" | "rescore";

export interface Estimate {
  usd: number;
  /** Not from this person's own tasks at this model and thinking level. */
  guessed: boolean;
}

/** Rough output size by thinking level, relative to low. */
const OUTPUT_SCALE: Record<Effort, number> = { low: 1, medium: 1.5, high: 2.5, xhigh: 3.5, max: 5 };
const scaleOutput = (u: TokenUsage, from: Effort, to: Effort): TokenUsage => ({ ...u, output: (u.output * OUTPUT_SCALE[to]) / OUTPUT_SCALE[from] });

/** Typical token use per task (Nov 2026, Haiku 5.5) and the level it was measured at. */
const TYPICAL: Record<AiKind, { usage: TokenUsage; effort: Effort }> = {
  career_import: { usage: { input: 5000, output: 3500, cacheWrite: 0, cacheRead: 0 }, effort: "medium" },
  cv_draft: { usage: { input: 4600, output: 3200, cacheWrite: 0, cacheRead: 0 }, effort: "medium" },
  letter_questions: { usage: { input: 3000, output: 150, cacheWrite: 0, cacheRead: 0 }, effort: "medium" },
  cover_letter: { usage: { input: 3600, output: 1000, cacheWrite: 0, cacheRead: 0 }, effort: "medium" },
  rescore: { usage: { input: 3800, output: 310, cacheWrite: 0, cacheRead: 0 }, effort: "low" },
};

type UsageRow = {
  model: string;
  effort: Effort | null;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_write: number;
  tokens_cache_read: number;
};

const usageOf = (r: UsageRow): TokenUsage => {
  const cacheWrite = Number(r.tokens_cache_write) || 0;
  const cacheRead = Number(r.tokens_cache_read) || 0;
  return { input: Math.max(0, (Number(r.tokens_in) || 0) - cacheWrite - cacheRead), output: Number(r.tokens_out) || 0, cacheWrite, cacheRead };
};

const mean = (list: TokenUsage[]): TokenUsage => {
  const n = list.length;
  const avg = (f: (u: TokenUsage) => number) => list.reduce((a, u) => a + f(u), 0) / n;
  return { input: avg((u) => u.input), output: avg((u) => u.output), cacheWrite: avg((u) => u.cacheWrite), cacheRead: avg((u) => u.cacheRead) };
};

/** The best estimate from some history, or null when it has nothing usable. */
function fromHistory(rows: UsageRow[], model: string, effort: Effort, defaultEffort: Effort, own: boolean): Estimate | null {
  const level = (r: UsageRow) => r.effort ?? defaultEffort;
  const exact = rows.filter((r) => r.model === model && level(r) === effort).slice(0, LAST_N);
  if (exact.length) return { usd: costUsd(model, mean(exact.map(usageOf))), guessed: !own };
  const sameLevel = rows.filter((r) => level(r) === effort).slice(0, LAST_N);
  if (sameLevel.length) return { usd: costUsd(model, mean(sameLevel.map(usageOf))), guessed: true };
  const any = rows.slice(0, LAST_N);
  if (any.length) return { usd: costUsd(model, mean(any.map((r) => scaleOutput(usageOf(r), level(r), effort)))), guessed: true };
  return null;
}

export async function estimateTask(supabase: SupabaseClient, userId: string, kind: AiKind, model: string, effort: Effort): Promise<Estimate> {
  const cols = "model, effort, tokens_in, tokens_out, tokens_cache_write, tokens_cache_read";
  const recent = (mine: boolean) => {
    const q = supabase.from("ai_usage").select(cols).eq("kind", kind).order("created_at", { ascending: false }).limit(LOOKBACK);
    return mine ? q.eq("user_id", userId) : q.neq("user_id", userId);
  };
  const typical = TYPICAL[kind];
  const [{ data: own }, { data: others }] = await Promise.all([recent(true), recent(false)]);
  return (
    fromHistory((own ?? []) as UsageRow[], model, effort, typical.effort, true) ??
    fromHistory((others ?? []) as UsageRow[], model, effort, typical.effort, false) ?? {
      usd: costUsd(model, scaleOutput(typical.usage, typical.effort, effort)),
      guessed: true,
    }
  );
}

/**
 * Scoring one job in a run, from the person's recent runs that scored something. Runs
 * record their scoring model and level (older ones ran at low, on Haiku). Runs at this
 * model and level give an estimate; otherwise runs at other settings are re-priced and
 * scaled (a guess), and without any, a single re-score's estimate (also a guess: a run
 * reads the cached prompt, a single re-score writes it).
 */
export async function estimateScoringPerJob(supabase: SupabaseClient, userId: string, model: string, effort: Effort): Promise<Estimate> {
  const { data } = await supabase
    .from("runs")
    .select("started_at, run_users!inner(user_id, stats)")
    .eq("run_users.user_id", userId)
    .gt("run_users.stats->scored", 0)
    .order("started_at", { ascending: false })
    .limit(LOOKBACK);
  type Stats = {
    scored?: number;
    cost_usd?: number;
    tokens_in?: number;
    tokens_out?: number;
    tokens_cache_write?: number;
    tokens_cache_read?: number;
    scoring_model?: string;
    scoring_effort?: Effort;
  };
  const runs = (data ?? []).flatMap((r) => (r.run_users as { stats: Stats }[]).map((u) => u.stats)).filter((s) => Number(s.scored) > 0);
  const modelOf = (s: Stats) => s.scoring_model ?? "claude-haiku-5-5";
  const levelOf = (s: Stats) => s.scoring_effort ?? "low";
  /** Per-job cost of some runs, priced at the current model and scaled to the current level. */
  const perJob = (list: Stats[], scale: boolean): number | null => {
    let cost = 0;
    let jobs = 0;
    for (const s of list) {
      if (s.tokens_cache_read !== undefined) {
        const write = Number(s.tokens_cache_write) || 0;
        const read = Number(s.tokens_cache_read) || 0;
        const usage = { input: Math.max(0, (Number(s.tokens_in) || 0) - write - read), output: Number(s.tokens_out) || 0, cacheWrite: write, cacheRead: read };
        cost += costUsd(model, scale ? scaleOutput(usage, levelOf(s), effort) : usage);
      } else if (!scale && modelOf(s) === model) {
        cost += Number(s.cost_usd) || 0; // no token split recorded: its cost is only good as is
      } else {
        continue;
      }
      jobs += Number(s.scored) || 0;
    }
    return jobs ? cost / jobs : null;
  };
  const exact = perJob(runs.filter((s) => modelOf(s) === model && levelOf(s) === effort).slice(0, LAST_N), false);
  if (exact !== null) return { usd: exact, guessed: false };
  const scaled = perJob(runs.slice(0, LAST_N), true);
  if (scaled !== null) return { usd: scaled, guessed: true };
  return { ...(await estimateTask(supabase, userId, "rescore", model, effort)), guessed: true };
}

/** "~$0.02", "~$0.0008", "~$1.40"; a guess gets a "*" ("~$0.0021*"). */
export function formatEstimate(e: Estimate): string {
  const v = e.usd;
  // Cents from 10 cents up ("$0.70", "$1.40"); below that two significant figures ("$0.0021").
  const text = v >= 0.1 ? v.toFixed(2) : v > 0 ? v.toPrecision(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : "0";
  return `~$${text}${e.guessed ? "*" : ""}`;
}
