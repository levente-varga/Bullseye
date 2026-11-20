import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { USER_AGENT } from "./ats";
import { CareerSchema, type Career } from "./career-schema";
import { costUsd, type TokenUsage } from "./pricing";

/** Text the model may read per source: a CV is a few thousand characters, a site's bundle more. */
const MAX_SOURCE_CHARS = 60_000;

/**
 * A personal website's text for extraction: the page, plus its own scripts (portfolio
 * sites often render their experience lists from a JavaScript bundle, which then holds
 * the data). Same-origin scripts only, bounded in size.
 */
export async function websiteText(url: string): Promise<string> {
  const page = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  const get = async (u: URL) => {
    const res = await fetch(u, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${res.status} for ${u}`);
    return res.text();
  };
  const html = await get(page);
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/gi)]
    .map((m) => new URL(m[1], page))
    .filter((u) => u.origin === page.origin && !u.pathname.startsWith("/_vercel/"))
    .slice(0, 4);
  const bundles: string[] = [];
  for (const s of scripts) {
    try {
      bundles.push(await get(s));
    } catch {
      // a script that won't load just isn't read
    }
  }
  return [text, ...bundles].join("\n\n").slice(0, MAX_SOURCE_CHARS);
}

export const CAREER_MODEL = "claude-haiku-5-5";

/** Extracts a structured career from the given sources (CV text, website text). */
export async function extractCareer(
  client: Anthropic,
  sources: { label: string; text: string }[],
): Promise<{ career: Career; usage: TokenUsage; costUsd: number }> {
  const response = await client.beta.messages.parse({
    model: CAREER_MODEL,
    max_tokens: 8000,
    system: `You turn a candidate's CV and personal website into a structured career record.

Use only facts that appear in the sources. Never invent or embellish: no added skills, numbers, titles, dates or responsibilities. When the sources disagree, prefer the more specific one; when they describe the same role, merge it into one entry. Keep the candidate's own wording for summaries and highlights; tidy only obvious formatting noise (bullets, line breaks, markup).
A website source may be raw page text or a JavaScript bundle that holds the data as string literals: read the values, ignore code and HTML markup.
Leave a field "" (or a list empty) when the sources don't say.`,
    output_config: { format: betaZodOutputFormat(CareerSchema) },
    messages: [
      {
        role: "user",
        content: sources.map((s) => `<source name="${s.label}">\n${s.text.slice(0, MAX_SOURCE_CHARS)}\n</source>`).join("\n\n"),
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to read these sources.");
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
