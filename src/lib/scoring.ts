import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { SCORING_MODELS, type Criteria, type FetchedJob, type Profile, type ScoringModel } from "./types";

/**
 * LLM scoring: how well does a listing fit the candidate?
 * The model is picked on the Criteria page (default Claude Haiku 5.5).
 */

export const ScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  summary: z.string().describe("One or two sentences on why this score."),
  pros: z.array(z.string()).describe("Up to 4 short reasons this is a good fit."),
  cons: z.array(z.string()).describe("Up to 4 short concerns or mismatches."),
});
export type Score = z.infer<typeof ScoreSchema>;

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
  const examples = feedback.length
    ? feedback
        .map(
          (f) =>
            `- ${f.decision.toUpperCase()}: "${f.title}" at ${f.company}` +
            (f.reasons.length ? ` — reasons: ${f.reasons.join(", ")}` : "") +
            (f.note ? ` — note: ${f.note}` : ""),
        )
        .join("\n")
    : "(no decisions yet)";

  return `You score job listings for one candidate. Give a 0-100 fit score.

Scale: 85+ = apply right away; 60-84 = worth a look; 40-59 = weak fit; below 40 = clear mismatch.
Weigh role and seniority match, skills overlap with the CV, location/remote fit, and the candidate's stated preferences. Treat the candidate's past decisions as the strongest signal of their taste: if they repeatedly skipped jobs for a reason, penalize listings with that trait.
A remote role restricted to a country or region the candidate is not in is a location mismatch, not a remote fit.
Be concrete in pros and cons (name the skill, the location, the seniority gap). Do not invent facts that are not in the listing.

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
CV:
${profile.cv_text || "(no CV provided)"}
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
): Promise<Score> {
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

${job.description || "(No description available: judge on title, company and location only, and keep the score moderate unless the title is a clear match or mismatch.)"}
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
  return response.parsed_output;
}
