import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { careerText, withDefaults } from "./career-schema";
import { CHECKS, type CheckKey } from "./score-checks";
import type { TokenUsage } from "./pricing";
import { SCORING_MODELS, SKIP_UNAVAILABLE, type Criteria, type FetchedJob, type Profile, type ScoringModel } from "./types";

/**
 * LLM scoring: how well does a listing fit the candidate?
 * The model is picked on the Criteria page (default Claude Haiku 5.5).
 */

/**
 * Checklist scoring. One holistic 0-100 number clustered on a few favourite values and
 * rarely went above the low 70s, so the model rates each part of the fit 0-10 against
 * fixed anchors and the score is computed here: a weighted sum, capped by dealbreakers.
 */
/** A rating at or below this on role or location makes the job a clear mismatch, whatever else fits. */
const DEALBREAKER = 2;

const Check = z.object({
  rating: z.number().int().min(0).max(10),
  note: z.string().describe("At most 6 words, concrete: name the skill, place or gap."),
});

export const ScoreSchema = z.object({
  role: Check,
  skills: Check,
  seniority: Check,
  location: Check,
  taste: Check.nullable().describe("null when there are no stated preferences and no past decisions that bear on this listing."),
  summary: z.string().describe("One or two sentences on the overall fit."),
  pros: z.array(z.string()).describe("Short reasons this is a good fit: only the ones that matter, however many that is (can be none). Never pad."),
  cons: z.array(z.string()).describe("Short concerns or mismatches: only the real ones, however many that is (can be none). Never pad."),
});
export type ScoreOutput = z.infer<typeof ScoreSchema>;

export interface ScoreCheck {
  key: CheckKey;
  rating: number;
  note: string;
}

export interface Score {
  score: number;
  checks: ScoreCheck[];
  summary: string;
  pros: string[];
  cons: string[];
}

/**
 * 0-100 from the ratings: the weighted mean (a missing taste rating drops out and the
 * other weights fill in), then capped: a dealbreaker on role or location caps it at 30,
 * one on skills or level at 50.
 */
export function combine(checks: ScoreCheck[]): number {
  const byKey = new Map(checks.map((c) => [c.key, c.rating]));
  let sum = 0;
  let weights = 0;
  for (const c of CHECKS) {
    const r = byKey.get(c.key);
    if (r === undefined) continue;
    sum += c.weight * r;
    weights += c.weight;
  }
  let score = weights ? Math.round((sum / weights) * 10) : 0;
  const low = (k: CheckKey) => (byKey.get(k) ?? 10) <= DEALBREAKER;
  if (low("role") || low("location")) score = Math.min(score, 30);
  else if (low("skills") || low("seniority")) score = Math.min(score, 50);
  return score;
}

export function toScore(out: ScoreOutput): Score {
  const checks: ScoreCheck[] = [];
  for (const c of CHECKS) {
    const v = out[c.key];
    if (v) checks.push({ key: c.key, rating: v.rating, note: v.note.trim() });
  }
  return { score: combine(checks), checks, summary: out.summary, pros: out.pros, cons: out.cons };
}

export interface FeedbackExample {
  title: string;
  company: string;
  decision: "approve" | "skip";
  reasons: string[];
  note: string | null;
}

export function buildSystemPrompt(
  profile: Profile,
  criteria: Criteria,
  feedback: FeedbackExample[],
): string {
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "(any)");
  // The career (Profile) is the candidate's description; the worker doesn't score without one.
  const career = withDefaults(profile.career);
  // A posting that was gone says nothing about taste: that reason is dropped, and so is a
  // skip that had no other reason or note. Other skips (even without reasons) still count.
  const telling = feedback.flatMap((f) => {
    if (!f.reasons.includes(SKIP_UNAVAILABLE)) return [f];
    const reasons = f.reasons.filter((r) => r !== SKIP_UNAVAILABLE);
    return reasons.length || f.note ? [{ ...f, reasons }] : [];
  });
  const examples = telling.length
    ? telling
        .map(
          (f) =>
            `- ${f.decision.toUpperCase()}: "${f.title}" at ${f.company}` +
            (f.reasons.length ? ` — reasons: ${f.reasons.join(", ")}` : "") +
            (f.note ? ` — note: ${f.note}` : ""),
        )
        .join("\n")
    : "(no decisions yet)";

  const checks = CHECKS.map((c) => `- ${c.key}: ${c.about}`).join("\n");
  return `You rate job listings for one candidate, one part of the fit at a time. Rate each part 0-10:
${checks}

Use the whole scale and judge each part on its own, not by the overall impression:
10 = exactly what the candidate wants or has; 8 = strong, a small gap; 6 = acceptable, clear gaps; 4 = weak; 2 = mismatch; 0 = the opposite of what fits.
Seniority: compare the years and level the listing asks for with the candidate's actual experience (from dates and titles); over- and under-qualified both count against it.
Location: a remote role restricted to a country or region the candidate is not in is a mismatch, not a remote fit. An unknown location is a 5.
Taste: treat the candidate's past decisions as the strongest signal; if they repeatedly skipped jobs for a reason, rate listings with that trait low. Give null when nothing in the preferences or decisions bears on this listing.
Be concrete in notes, pros and cons (name the skill, the location, the seniority gap). Do not invent facts that are not in the listing.
List only the pros and cons that actually bear on the decision. Their number should follow the listing: a clear match may have one con or none, a thin listing may have one pro. Do not aim for a fixed or balanced count, and do not restate one point in different words to fill the list.

<criteria>
Target roles: ${list(criteria.roles)}
Target locations: ${list(criteria.locations)}
Remote acceptable: ${criteria.remote_ok ? "yes" : "no"}
Must-have keywords: ${list(criteria.include_keywords)}
Preferences: ${criteria.preferences || "(none stated)"}
</criteria>

<candidate>
Headline: ${profile.headline || "(not set)"}
Based in: ${profile.location || "(not set)"}
Career:
${career ? careerText(career) : "(no career provided)"}
</candidate>

<past_decisions>
${examples}
</past_decisions>`;
}

/** Resolves the model to use: dashboard setting, then the SCORING_MODEL env var, then Haiku. */
export function resolveModel(setting: string | null | undefined): ScoringModel {
  const known = (m?: string | null): m is ScoringModel => SCORING_MODELS.some((x) => x.id === m);
  if (known(setting)) return setting;
  if (known(process.env.SCORING_MODEL)) return process.env.SCORING_MODEL;
  return "claude-haiku-5-5";
}

export async function scoreJob(
  client: Anthropic,
  model: ScoringModel,
  system: string,
  job: FetchedJob,
): Promise<{ score: Score; model: string; usage: TokenUsage }> {
  // The ratings come from the model; the 0-100 score is computed from them (combine).
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 2000,
    // Haiku has no server-side refusal fallback; Sonnet and Opus do.
    ...(model !== "claude-haiku-5-5"
      ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
      : {}),
    // Stable per run: cached after the first job, so later jobs are cheaper.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: betaZodOutputFormat(ScoreSchema) },
    messages: [
      {
        role: "user",
        content: `<listing>
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || "unknown"}${job.remote ? " (remote possible)" : ""}
Compensation: ${job.compensation ?? "not stated"}

${job.description || "(No description available: judge on title, company and location only; rate skills and seniority 5 unless the title makes them clear.)"}
</listing>`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Scoring refused: ${response.stop_details?.category ?? "unknown"}`);
  }
  if (!response.parsed_output) {
    throw new Error(`Scoring returned no parseable output (stop_reason=${response.stop_reason})`);
  }
  const u = response.usage;
  return {
    score: toScore(response.parsed_output),
    model: response.model, // can differ from the request if a refusal fallback answered
    usage: {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    },
  };
}
