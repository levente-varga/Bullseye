export type Ats = "greenhouse" | "lever" | "ashby" | "teamtailor" | "smartrecruiters" | "swedengamejobs";

/** How each source type is configured on the Sources page. */
export const ATS_INFO: Record<Ats, { label: string; slugLabel: string; slugExample: string; aggregator?: boolean }> = {
  greenhouse: { label: "Greenhouse", slugLabel: "Board slug or URL", slugExample: "job-boards.greenhouse.io/mojangab" },
  lever: { label: "Lever", slugLabel: "Board slug or URL", slugExample: "jobs.lever.co/avalanchestudios" },
  ashby: { label: "Ashby", slugLabel: "Board slug or URL", slugExample: "jobs.ashbyhq.com/voodoo" },
  teamtailor: { label: "Teamtailor", slugLabel: "Career site domain", slugExample: "career.paradoxplaza.com" },
  smartrecruiters: { label: "SmartRecruiters", slugLabel: "Company identifier or URL", slugExample: "jobs.smartrecruiters.com/Ubisoft2" },
  swedengamejobs: { label: "Sweden Game Jobs (aggregator)", slugLabel: "—", slugExample: "swedengamejobs.com", aggregator: true },
};

export type JobStatus =
  | "new"
  | "filtered"
  | "scored"
  | "skipped"
  | "approved"
  | "applied"
  | "interview"
  | "offer"
  | "rejected"
  | "closed";

export const PIPELINE_STATUSES: JobStatus[] = [
  "approved",
  "applied",
  "interview",
  "offer",
  "rejected",
];

export const SCORING_MODELS = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Fast and cheapest. Default." },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Better judgment, about 20x the cost of Haiku." },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Most capable, about 40x the cost of Haiku." },
] as const;
export type ScoringModel = (typeof SCORING_MODELS)[number]["id"];
export const DEFAULT_SCORING_MODEL: ScoringModel = "claude-haiku-5-5";

export const SKIP_REASONS = [
  "Too senior",
  "Too junior",
  "Wrong stack",
  "On-site only",
  "Wrong location",
  "Low salary",
  "Not interested in company",
  "Not interested in domain",
] as const;

export interface Profile {
  full_name: string;
  email: string;
  phone: string;
  location: string;
  links: string[];
  headline: string;
  cv_text: string;
}

export interface Criteria {
  roles: string[];
  locations: string[];
  remote_ok: boolean;
  include_keywords: string[];
  exclude_keywords: string[];
  preferences: string;
  scoring_model: ScoringModel;
  score_threshold: number;
  followup_days: number;
  digest_email: string;
}

export interface Source {
  id: string;
  ats: Ats;
  slug: string;
  company_name: string;
  watchlist: boolean;
  enabled: boolean;
  last_checked_at: string | null;
  last_error: string | null;
  /** Optional ISO country code filter (SmartRecruiters). */
  country: string | null;
}

export interface SourceSuggestion {
  id: string;
  /** An Ats value, or "custom" for career sites Bullseye has no adapter for. */
  ats: Ats | "custom";
  slug: string;
  company_name: string;
  job_count: number;
  status: "new" | "added" | "dismissed";
}

export interface Job {
  id: string;
  source_id: string;
  external_id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  description: string;
  compensation: string | null;
  posted_at: string | null;
  first_seen_at: string;
  status: JobStatus;
  status_changed_at: string;
  filter_reason: string | null;
  score: number | null;
  score_summary: string | null;
  score_pros: string[] | null;
  score_cons: string[] | null;
  applied_at: string | null;
  followed_up_at: string | null;
  notified_at: string | null;
  dedupe_key: string | null;
  /** True when no real description could be found; the score is based on title and location only. */
  thin: boolean;
}

export interface Run {
  id: string;
  kind: "watchlist" | "full" | "digest";
  started_at: string;
  finished_at: string | null;
  stats: Record<string, number>;
  error: string | null;
}

/** A listing as returned by an ATS adapter, before it hits the database. */
export interface FetchedJob {
  external_id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  description: string;
  compensation: string | null;
  posted_at: string | null;
}
