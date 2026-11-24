import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { formatCareerDate, type Career } from "./career-schema";
import type { Coverage, CvDraft, LetterDraft, LetterQA } from "./draft-types";
import { costUsd, type TokenUsage } from "./pricing";
import { DRAFT_LANGUAGES, type Profile, type ScoringModel } from "./types";

/**
 * CV and cover letter drafts. The career goes to the model with a stable id on every
 * item (e0 = a role, e0.h1 = one of its highlights, p0 = a project, d0 = a degree). The
 * model chooses, orders and rewords by id; code then copies titles, companies and dates
 * from the career and fact-checks every reworded line (checkCv): a line must point at a
 * real item, and any number in it must appear in that item. Nothing else gets through.
 */

export interface DraftJob {
  title: string;
  company: string;
  location: string;
  description: string;
  /** The scorer's checklist and summary, if any: a head start on fit and gaps. */
  scoreNotes: string;
}

type Result<T> = { draft: T; usage: TokenUsage; costUsd: number; model: string };

const LIMITS = {
  one_page: { roles: 3, highlights: 4, projects: 2, skills: 14, summaryWords: 50 },
  two_pages: { roles: 6, highlights: 6, projects: 4, skills: 24, summaryWords: 70 },
} as const;

const languageName = (id: string) => DRAFT_LANGUAGES.find((l) => l.id === id)?.label ?? "English";

// --- The career with ids ------------------------------------------------------------

/** Every citable item's id → its text (for the fact check) and a short label (for coverage). */
interface Indexed {
  text: string;
  items: Map<string, { text: string; label: string }>;
  skills: Map<string, string>; // lower-case → as written
}

export function indexCareer(c: Career): Indexed {
  const items = new Map<string, { text: string; label: string }>();
  const skills = new Map<string, string>();
  const addSkill = (s: string) => s.trim() && !skills.has(s.trim().toLowerCase()) && skills.set(s.trim().toLowerCase(), s.trim());
  const dates = (a: string, b: string) => [formatCareerDate(a), formatCareerDate(b)].filter(Boolean).join(" – ");
  const out: string[] = [];

  c.experiences.forEach((e, i) => {
    const id = `e${i}`;
    const label = `${e.title} at ${e.company}`;
    const whole = [e.title, e.company, e.location, e.summary, ...e.highlights, ...e.skills].join("\n");
    items.set(id, { text: whole, label });
    out.push(`[${id}] ${label} · ${dates(e.start, e.end)}${e.location ? ` · ${e.location}` : ""}`);
    if (e.summary) {
      items.set(`${id}.s`, { text: whole, label });
      out.push(`  [${id}.s] ${e.summary}`);
    }
    e.highlights.forEach((h, j) => {
      items.set(`${id}.h${j}`, { text: whole, label });
      out.push(`  [${id}.h${j}] ${h}`);
    });
    if (e.skills.length) out.push(`  skills: ${e.skills.join(", ")}`);
    e.skills.forEach(addSkill);
  });
  c.projects.forEach((p, i) => {
    const id = `p${i}`;
    items.set(id, { text: [p.name, p.description, ...p.skills].join("\n"), label: p.name });
    out.push(`[${id}] ${p.name}: ${p.description}${p.skills.length ? ` (skills: ${p.skills.join(", ")})` : ""}`);
    p.skills.forEach(addSkill);
  });
  c.education.forEach((d, i) => {
    const id = `d${i}`;
    items.set(id, { text: [d.degree, d.school, d.details].join("\n"), label: `${d.degree}, ${d.school}` });
    out.push(`[${id}] ${d.degree}, ${d.school} · ${dates(d.start, d.end)}${d.details ? ` · ${d.details}` : ""}`);
  });
  c.skills.forEach((g) => g.items.forEach(addSkill));
  if (c.skills.length) out.push(`Skills: ${c.skills.map((g) => `${g.group}: ${g.items.join(", ")}`).join("; ")}`);
  if (c.languages.length) out.push(`Languages: ${c.languages.map((l) => (l.level ? `${l.language} (${l.level})` : l.language)).join(", ")}`);
  if (c.certifications.length) out.push(`Certifications: ${c.certifications.map((x) => x.name).join(", ")}`);
  if (c.awards.length) out.push(`Awards: ${c.awards.map((a) => `${a.title}${a.details ? ` (${a.details})` : ""}`).join(", ")}`);
  if (c.summary) out.unshift(`Own summary: ${c.summary}`);
  if (c.other) out.push(`Other: ${c.other}`);
  return { text: out.join("\n"), items, skills };
}

/** Numbers in a line ("40%", "3", "1.5M"), for the fact check. */
const numbers = (s: string) => s.match(/\d+(?:[.,]\d+)?/g) ?? [];
/** Whether every number in `line` also appears in `source`. Years like 2023 count too. */
const numbersBacked = (line: string, source: string) => {
  const have = new Set(numbers(source).map((n) => n.replace(",", ".")));
  return numbers(line).every((n) => have.has(n.replace(",", ".")));
};

// --- CV -----------------------------------------------------------------------------

const CvOutput = z.object({
  headline: z.string().describe("A short professional title for this application, true to the career (e.g. \"Gameplay Programmer\")."),
  summary: z.string().describe("2-3 sentences aimed at this job, only facts from the career."),
  experiences: z
    .array(
      z.object({
        id: z.string().describe('A role id, e.g. "e0".'),
        highlights: z
          .array(z.object({ source: z.string().describe('The id this line is based on: "e0.h2" or "e0.s".'), text: z.string() }))
          .describe("The role's lines for this job, most relevant first."),
      }),
    )
    .describe("Roles to include, newest first."),
  projects: z.array(z.object({ id: z.string(), text: z.string().describe("The project in one or two lines, angled at the job.") })),
  education: z.array(z.string()).describe('Degree ids to include, e.g. ["d0"].'),
  skills: z.array(z.string()).describe("Skills from the career, most relevant to the job first. Exactly as written in the career."),
  coverage: z
    .array(z.object({ requirement: z.string().describe("A main requirement of the job, in a few words."), evidence: z.array(z.string()).describe("Ids that back it; empty if nothing does.") }))
    .describe("The job's 5-9 main requirements and the career items that back each."),
});

export function cvSystemPrompt(indexed: Indexed, profile: Pick<Profile, "headline" | "location">, length: keyof typeof LIMITS, language: string): string {
  const L = LIMITS[length];
  return `You tailor a CV to one job listing, from the candidate's career below. You choose, order and reword; you never add.

Rules:
- Use only facts in the career. No new skills, tools, numbers, titles, employers, dates or responsibilities. Rewording is fine (the listing's terms for the same thing, tighter phrasing, leading with what matters to this job); claims are not.
- Every highlight line names the career item it is based on (source id). Keep numbers exactly as the source has them.
- Pick what fits this job: at most ${L.roles} roles, at most ${L.highlights} lines per role (fewer for older or less relevant roles), at most ${L.projects} projects, at most ${L.skills} skills. Drop what doesn't help.
- Summary: at most ${L.summaryWords} words, concrete, no clichés ("passionate", "results-driven", "team player", "dynamic").
- Coverage: list the listing's main requirements and which ids back each; leave evidence empty for a real gap. Be honest: a gap stays a gap.
- Write the headline, summary, highlights and project lines in ${languageName(language)}. Keep skill names as written in the career.

<candidate>
Headline: ${profile.headline || "(not set)"}
Based in: ${profile.location || "(not set)"}
${indexed.text}
</candidate>`;
}

const jobBlock = (job: DraftJob) => `<listing>
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || "unknown"}

${job.description || "(no description)"}
</listing>${job.scoreNotes ? `\n\n<fit_notes>\n${job.scoreNotes}\n</fit_notes>` : ""}`;

export async function generateCv(
  client: Anthropic,
  model: ScoringModel,
  career: Career,
  profile: Profile,
  job: DraftJob,
): Promise<Result<CvDraft>> {
  const indexed = indexCareer(career);
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 6000,
    system: [{ type: "text", text: cvSystemPrompt(indexed, profile, profile.cv_length, profile.draft_language), cache_control: { type: "ephemeral" } }],
    output_config: { format: betaZodOutputFormat(CvOutput) },
    messages: [{ role: "user", content: jobBlock(job) }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to write this CV.");
  if (!response.parsed_output) throw new Error(`No usable result (stop_reason=${response.stop_reason}).`);
  const usage = toUsage(response.usage);
  return {
    draft: checkCv(response.parsed_output, career, indexed, profile.cv_length),
    usage,
    costUsd: costUsd(response.model, usage),
    model: response.model,
  };
}

/**
 * Turns the model's choices into the stored CV: ids resolved against the career (titles,
 * companies and dates copied verbatim), limits applied, and every reworded line checked.
 * Unknown ids, unbacked numbers and skills not in the career are dropped and listed.
 */
export function checkCv(out: z.infer<typeof CvOutput>, career: Career, indexed: Indexed, length: keyof typeof LIMITS): CvDraft {
  const L = LIMITS[length];
  const removed: string[] = [];
  const seenRoles = new Set<number>();

  const experiences = out.experiences.flatMap((x) => {
    const i = Number(x.id.match(/^e(\d+)$/)?.[1] ?? NaN);
    const role = career.experiences[i];
    if (!role || seenRoles.has(i)) return [];
    seenRoles.add(i);
    const highlights = x.highlights.flatMap((h) => {
      const src = indexed.items.get(h.source);
      const text = h.text.trim();
      if (!text) return [];
      if (!src || !h.source.startsWith(`e${i}.`)) {
        removed.push(`${text} (not tied to this role)`);
        return [];
      }
      if (!numbersBacked(text, src.text)) {
        removed.push(`${text} (a number not in your career)`);
        return [];
      }
      return [text];
    });
    return [{ title: role.title, company: role.company, location: role.location, start: role.start, end: role.end, highlights: highlights.slice(0, L.highlights), i }];
  });
  // Newest first, as on any CV, whatever order the model gave.
  experiences.sort((a, b) => a.i - b.i);

  const projects = out.projects.flatMap((x) => {
    const i = Number(x.id.match(/^p(\d+)$/)?.[1] ?? NaN);
    const p = career.projects[i];
    if (!p) return [];
    const text = x.text.trim();
    if (!numbersBacked(text, indexed.items.get(`p${i}`)!.text)) {
      removed.push(`${p.name}: ${text} (a number not in your career; the original is used)`);
      return [{ name: p.name, description: p.description, url: p.url }];
    }
    return [{ name: p.name, description: text || p.description, url: p.url }];
  });

  const education = [...new Set(out.education)].flatMap((id) => {
    const d = career.education[Number(id.match(/^d(\d+)$/)?.[1] ?? NaN)];
    return d ? [{ degree: d.degree, school: d.school, location: d.location, start: d.start, end: d.end, details: d.details }] : [];
  });

  const skills: string[] = [];
  for (const s of out.skills) {
    const known = indexed.skills.get(s.trim().toLowerCase());
    if (!known) removed.push(`Skill "${s}" (not in your career)`);
    else if (!skills.includes(known)) skills.push(known);
  }

  // The summary can't point at one item: its numbers must appear somewhere in the career.
  // Only the sentences with an unbacked number go.
  const sentences = out.summary.trim().match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const summary = sentences
    .filter((s) => {
      if (numbersBacked(s, indexed.text)) return true;
      removed.push(`Summary: ${s.trim()} (a number not in your career)`);
      return false;
    })
    .join("")
    .trim();

  const coverage: Coverage[] = out.coverage.map((c) => ({
    requirement: c.requirement,
    evidence: [...new Set(c.evidence.map((id) => indexed.items.get(id)?.label).filter((l): l is string => Boolean(l)))],
  }));

  return {
    headline: out.headline.trim(),
    summary,
    experiences: experiences.slice(0, L.roles).map((r) => ({ title: r.title, company: r.company, location: r.location, start: r.start, end: r.end, highlights: r.highlights })),
    projects: projects.slice(0, L.projects),
    education: education.length ? education : career.education.map((d) => ({ degree: d.degree, school: d.school, location: d.location, start: d.start, end: d.end, details: d.details })),
    skills: skills.slice(0, L.skills),
    languages: career.languages,
    coverage,
    removed,
  };
}

// --- Cover letter -------------------------------------------------------------------

const QuestionsOutput = z.object({
  questions: z
    .array(z.string())
    .describe("1-2 short questions only the candidate can answer, specific to this company and role, e.g. what draws them to it."),
});

/** 1-2 questions to ask before writing a letter (a cheap model is fine). */
export async function letterQuestions(client: Anthropic, model: ScoringModel, career: Career, job: DraftJob): Promise<Result<string[]>> {
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 800,
    system: `You help a candidate write a cover letter. Their career is known (below), so never ask about skills or experience in it. Ask 1-2 short questions about what only they know and what makes a letter personal: why this company or product, what about this role appeals, a related interest or project not in the career, availability or relocation if the listing makes it matter. One line each, in English.

<career>
${indexCareer(career).text}
</career>`,
    output_config: { format: betaZodOutputFormat(QuestionsOutput) },
    messages: [{ role: "user", content: jobBlock(job) }],
  });
  if (!response.parsed_output) throw new Error(`No usable result (stop_reason=${response.stop_reason}).`);
  const usage = toUsage(response.usage);
  return { draft: response.parsed_output.questions.slice(0, 2), usage, costUsd: costUsd(response.model, usage), model: response.model };
}

const LetterOutput = z.object({
  greeting: z.string().describe('e.g. "Dear Larian hiring team,"; a name only if the listing gives one.'),
  paragraphs: z.array(z.string()).describe("3-4 paragraphs."),
  closing: z.string().describe('e.g. "Kind regards,"; the name is added separately.'),
});

export async function generateLetter(
  client: Anthropic,
  model: ScoringModel,
  career: Career,
  profile: Profile,
  job: DraftJob,
  answers: LetterQA[],
): Promise<Result<LetterDraft>> {
  const indexed = indexCareer(career);
  const qa = answers.filter((a) => a.answer.trim());
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 3000,
    system: [
      {
        type: "text",
        text: `You write a cover letter for one candidate and one job. It must sound like a capable person wrote it for this job, not like a template.

Rules:
- 250-300 words in 3-4 paragraphs. Open with the role and one concrete reason this candidate fits, not with "I am writing to apply". End with a short, plain call to action.
- Build it on the 2-3 strongest matches between the listing's main needs and the career: name the role, project or result. Use only facts from the career and the candidate's answers; never invent experience, numbers or motivation.
- If the candidate answered questions, use those answers for the personal part (why this company, what appeals). If not, keep motivation brief and grounded in the listing; no made-up enthusiasm.
- Avoid stock phrases: "I am thrilled", "I am excited to apply", "passionate", "fast-paced environment", "team player", "I believe I would be a great fit", "dynamic", "leverage", "synergy".
- Write in ${languageName(profile.draft_language)}.

<candidate>
Name: ${profile.full_name || "(not set)"}
Headline: ${profile.headline || "(not set)"}
Based in: ${profile.location || "(not set)"}
${indexed.text}
</candidate>`,
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: { format: betaZodOutputFormat(LetterOutput) },
    messages: [
      {
        role: "user",
        content: `${jobBlock(job)}${qa.length ? `\n\n<answers>\n${qa.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n")}\n</answers>` : ""}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to write this letter.");
  if (!response.parsed_output) throw new Error(`No usable result (stop_reason=${response.stop_reason}).`);
  const out = response.parsed_output;
  // Numbers must come from the career, the answers or the listing itself.
  const sources = [indexed.text, job.description, job.title, ...qa.map((a) => a.answer)].join("\n");
  const flagged = out.paragraphs.filter((p) => !numbersBacked(p, sources)).map((p) => `${p.slice(0, 120)}… (a number not in your career, answers or the listing)`);
  const usage = toUsage(response.usage);
  return {
    draft: { greeting: out.greeting.trim(), paragraphs: out.paragraphs.map((p) => p.trim()).filter(Boolean), closing: out.closing.trim(), flagged },
    usage,
    costUsd: costUsd(response.model, usage),
    model: response.model,
  };
}

function toUsage(u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): TokenUsage {
  return { input: u.input_tokens, output: u.output_tokens, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 };
}
