import { z } from "zod";

/**
 * A structured career: what the Profile page shows and edits, and what CV and cover
 * letter drafts are built from. Extracted from the CV text (and optionally a website)
 * by the model, then reviewed by the person. Dates are "YYYY-MM" (or "YYYY"), or
 * "present" for an ongoing role.
 */
const DateText = z.string().describe('"YYYY-MM" when the month is known, else "YYYY"; "present" for an ongoing role; "" if unknown.');

export const ExperienceSchema = z.object({
  title: z.string().describe("Job title as written."),
  company: z.string(),
  location: z.string().describe('"City, Country"; add "(remote)" if stated. "" if unknown.'),
  start: DateText,
  end: DateText,
  kind: z.string().describe('Employment type if stated: "full-time", "part-time", "contract", "internship", "freelance"; else "".'),
  summary: z.string().describe("One or two sentences on the role, in the source's own terms. \"\" if the source has none."),
  highlights: z.array(z.string()).describe("Concrete achievements or responsibilities, one per item, as stated (keep numbers). Can be empty."),
  skills: z.array(z.string()).describe("Technologies, languages and tools named for this role."),
});

export const EducationSchema = z.object({
  degree: z.string().describe('e.g. "Game Design and Technology MSc".'),
  school: z.string(),
  location: z.string(),
  start: DateText,
  end: DateText,
  details: z.string().describe('Grades, thesis, focus areas, as stated (e.g. "GPA 4.51/5"). "" if none.'),
});

export const CareerSchema = z.object({
  summary: z.string().describe("A short professional summary if the sources have one; \"\" otherwise. Never invent one."),
  experiences: z.array(ExperienceSchema).describe("Newest first."),
  education: z.array(EducationSchema).describe("Newest first."),
  skills: z
    .array(z.object({ group: z.string().describe('e.g. "Languages", "Frameworks & engines", "Tools", "Platforms"'), items: z.array(z.string()) }))
    .describe("Every skill named anywhere in the sources, grouped, each once."),
  languages: z.array(z.object({ language: z.string(), level: z.string().describe('As stated, e.g. "native", "C1", "fluent"; "" if not stated.') })),
  awards: z.array(z.object({ title: z.string(), issuer: z.string(), date: DateText, details: z.string() })),
});
export type Career = z.infer<typeof CareerSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Education = z.infer<typeof EducationSchema>;

export const EMPTY_CAREER: Career = { summary: "", experiences: [], education: [], skills: [], languages: [], awards: [] };

/** "2023-06" → "Jun 2023", "present" → "Present", "2022" stays. */
export function formatCareerDate(d: string): string {
  if (!d) return "";
  if (d === "present") return "Present";
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (!m) return d;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}
