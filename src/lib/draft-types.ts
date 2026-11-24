/**
 * CV and cover letter drafts as stored (drafts.content) and edited. Client-safe: no SDK.
 * Titles, companies and dates are copied from the career in code, so the model can't
 * change them; it only chooses, orders and rewords.
 */

export interface CvRole {
  title: string;
  company: string;
  location: string;
  start: string;
  end: string;
  highlights: string[];
}

export interface CvProject {
  name: string;
  description: string;
  url: string;
}

export interface CvEducation {
  degree: string;
  school: string;
  location: string;
  start: string;
  end: string;
  details: string;
}

/** A requirement of the job and whether the career backs it (evidence: career item labels; empty = a gap). */
export interface Coverage {
  requirement: string;
  evidence: string[];
}

export interface CvDraft {
  headline: string;
  summary: string;
  experiences: CvRole[];
  projects: CvProject[];
  education: CvEducation[];
  skills: string[];
  languages: { language: string; level: string }[];
  coverage: Coverage[];
  /** Lines the fact check dropped or flagged, shown with the draft. */
  removed: string[];
}

export interface LetterDraft {
  greeting: string;
  paragraphs: string[];
  closing: string;
  /** Lines the fact check flagged (numbers not found in the career, the answers or the listing). */
  flagged: string[];
}

export interface LetterQA {
  question: string;
  answer: string;
}

export interface DraftRow {
  id: string;
  job_id: string;
  kind: "cv" | "cover_letter";
  language: string;
  content: CvDraft | LetterDraft | null;
  answers: LetterQA[] | null;
  model: string | null;
  cost_usd: number;
  updated_at: string;
}

/** Section headings and fixed words, per draft language (never written by the model). */
export const DRAFT_LABELS: Record<string, Record<"summary" | "experience" | "projects" | "education" | "skills" | "languages" | "present", string>> = {
  en: { summary: "Summary", experience: "Experience", projects: "Projects", education: "Education", skills: "Skills", languages: "Languages", present: "Present" },
  sv: { summary: "Sammanfattning", experience: "Erfarenhet", projects: "Projekt", education: "Utbildning", skills: "Kompetenser", languages: "Språk", present: "Nu" },
  de: { summary: "Profil", experience: "Berufserfahrung", projects: "Projekte", education: "Ausbildung", skills: "Kenntnisse", languages: "Sprachen", present: "Heute" },
  hu: { summary: "Összefoglaló", experience: "Szakmai tapasztalat", projects: "Projektek", education: "Tanulmányok", skills: "Készségek", languages: "Nyelvek", present: "Jelenleg" },
};
