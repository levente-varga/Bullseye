import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { CareerSchema, type Career } from "./career-schema";
import { costUsd, type TokenUsage } from "./pricing";

/** A CV is a few thousand characters; this bounds a pasted wall of text. */
const MAX_CV_CHARS = 60_000;

export const CAREER_MODEL = "claude-haiku-5-5";

/** Extracts a structured career from the CV text. */
export async function extractCareer(client: Anthropic, cvText: string): Promise<{ career: Career; usage: TokenUsage; costUsd: number }> {
  const response = await client.beta.messages.parse({
    model: CAREER_MODEL,
    max_tokens: 8000,
    system: `You turn a candidate's CV into a structured career record.

Use only facts that appear in the CV. Never invent or embellish: no added skills, numbers, titles, dates or responsibilities. Keep the candidate's own wording for summaries and highlights; tidy only obvious formatting noise (bullets, line breaks, text jumbled by PDF extraction).
Leave a field "" (or a list empty) when the CV doesn't say.`,
    output_config: { format: betaZodOutputFormat(CareerSchema) },
    messages: [{ role: "user", content: `<cv>\n${cvText.slice(0, MAX_CV_CHARS)}\n</cv>` }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to read this CV.");
  if (!response.parsed_output) throw new Error(`No usable result (stop_reason=${response.stop_reason}).`);
  const u = response.usage;
  const usage: TokenUsage = {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
  };
  return { career: response.parsed_output, usage, costUsd: costUsd(CAREER_MODEL, usage) };
}

export { CareerSchema, EMPTY_CAREER, formatCareerDate, type Career } from "./career-schema";
