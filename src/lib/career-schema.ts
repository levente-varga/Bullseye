import { z } from "zod";

/**
 * A structured career: the one description of a person that the scorer reads and CV and
 * cover letter drafts are built from. Filled in on the Profile page, by hand or from a
 * CV PDF by the model, then reviewed. Dates are "YYYY-MM" (or "YYYY"), or "present" for
 * an ongoing role.
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
  projects: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().describe("What it is and the candidate's part in it, as stated."),
        skills: z.array(z.string()),
        url: z.string().describe('A link if given; "" otherwise.'),
      }),
    )
    .describe("Personal, university or side projects (not roles at an employer)."),
  certifications: z.array(z.object({ name: z.string(), issuer: z.string(), date: DateText })),
  other: z
    .string()
    .describe("Anything else in the CV that has no field above (publications, volunteering, interests…), as short lines. \"\" if nothing."),
});
export type Career = z.infer<typeof CareerSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type Project = Career["projects"][number];

export const EMPTY_CAREER: Career = {
  summary: "",
  experiences: [],
  education: [],
  skills: [],
  languages: [],
  awards: [],
  projects: [],
  certifications: [],
  other: "",
};

/** A saved career with any fields added since it was saved filled in (projects, certifications, other). */
export function withDefaults(c: Partial<Career> | null | undefined): Career | null {
  return c ? { ...EMPTY_CAREER, ...c } : null;
}

/**
 * The career as compact text for the scorer: roles with dates, skills and highlights,
 * education, projects, then skills, languages and the rest. Empty parts are left out.
 */
export function careerText(c: Career): string {
  const dates = (a: string, b: string) => [formatCareerDate(a), formatCareerDate(b)].filter(Boolean).join(" – ");
  const line = (...parts: string[]) => parts.filter(Boolean).join(" · ");
  const out: string[] = [];
  if (c.summary) out.push(c.summary);
  if (c.experiences.length) {
    out.push(
      "Experience:\n" +
        c.experiences
          .map((e) =>
            [
              `- ${line(`${e.title} at ${e.company}`, dates(e.start, e.end), e.location, e.kind)}`,
              e.summary && `  ${e.summary}`,
              ...e.highlights.map((h) => `  • ${h}`),
              e.skills.length ? `  Skills: ${e.skills.join(", ")}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n"),
    );
  }
  if (c.education.length) {
    out.push("Education:\n" + c.education.map((e) => `- ${line(`${e.degree}, ${e.school}`, dates(e.start, e.end), e.location, e.details)}`).join("\n"));
  }
  if (c.projects.length) {
    out.push("Projects:\n" + c.projects.map((p) => `- ${line(p.name, p.description, p.skills.join(", "))}`).join("\n"));
  }
  if (c.skills.length) out.push("Skills:\n" + c.skills.map((g) => `- ${g.group}: ${g.items.join(", ")}`).join("\n"));
  if (c.languages.length) out.push("Languages: " + c.languages.map((l) => (l.level ? `${l.language} (${l.level})` : l.language)).join(", "));
  if (c.certifications.length) out.push("Certifications:\n" + c.certifications.map((x) => `- ${line(x.name, x.issuer, formatCareerDate(x.date))}`).join("\n"));
  if (c.awards.length) out.push("Awards:\n" + c.awards.map((a) => `- ${line(a.title, a.issuer, formatCareerDate(a.date), a.details)}`).join("\n"));
  if (c.other) out.push("Other:\n" + c.other);
  return out.join("\n\n");
}

/** "2023-06" → "Jun 2023", "present" → "Present", "2022" stays. */
export function formatCareerDate(d: string): string {
  if (!d) return "";
  if (d === "present") return "Present";
  const m = d.match(/^(\d{4})-(\d{2})$/);
  if (!m) return d;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}
