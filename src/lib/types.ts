export type Ats =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "teamtailor"
  | "smartrecruiters"
  | "personio"
  | "recruitee"
  | "workable"
  | "workday"
  | "swedengamejobs";

/** How each source type is configured on the Sources page. */
export const ATS_INFO: Record<Ats, { label: string; slugLabel: string; slugExample: string; aggregator?: boolean }> = {
  greenhouse: { label: "Greenhouse", slugLabel: "Board slug or URL", slugExample: "job-boards.greenhouse.io/mojangab" },
  lever: { label: "Lever", slugLabel: "Board slug or URL", slugExample: "jobs.lever.co/avalanchestudios" },
  ashby: { label: "Ashby", slugLabel: "Board slug or URL", slugExample: "jobs.ashbyhq.com/voodoo" },
  teamtailor: { label: "Teamtailor", slugLabel: "Career site domain", slugExample: "career.paradoxplaza.com" },
  smartrecruiters: { label: "SmartRecruiters", slugLabel: "Company identifier or URL", slugExample: "jobs.smartrecruiters.com/Ubisoft2" },
  personio: { label: "Personio", slugLabel: "Career site URL", slugExample: "personio.jobs.personio.de" },
  recruitee: { label: "Recruitee", slugLabel: "Career site URL", slugExample: "bunq.recruitee.com" },
  workable: { label: "Workable", slugLabel: "Account or URL", slugExample: "apply.workable.com/huggingface" },
  workday: { label: "Workday", slugLabel: "Careers site URL", slugExample: "philips.wd3.myworkdayjobs.com/jobs-and-careers" },
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
  linkedin_url: string;
  github_url: string;
  website_url: string;
  /** Any other links (one per entry). */
  links: string[];
  headline: string;
  /** The text the scorer reads; filled from the uploaded PDF, editable. */
  cv_text: string;
  cv_file_path: string | null;
  cv_file_name: string | null;
  cv_uploaded_at: string | null;
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
  /** Watchlist check interval; 0 = off. */
  watch_interval_minutes: number;
  /** Local time ("HH:MM", in `timezone`) of the daily full search + digest. */
  daily_time: string;
  daily_enabled: boolean;
  /** IANA timezone, e.g. "Europe/Budapest". */
  timezone: string;
}

export const WATCH_INTERVALS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "Off" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 120, label: "Every 2 hours" },
  { minutes: 240, label: "Every 4 hours" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 720, label: "Every 12 hours" },
];

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

/**
 * The job columns list views show. Lists stay light: no descriptions (up to 12k
 * characters each), and the scorer's reasoning is loaded only when a row is opened
 * (getJobDetails), because every row is sent twice (HTML + React data).
 */
export const JOB_LIST_COLUMNS =
  "id, source_id, title, company, location, remote, url, compensation, first_seen_at, status, status_changed_at, " +
  "score, thin, applied_at, followed_up_at";

export interface JobDetails {
  url: string;
  score_summary: string | null;
  score_pros: string[] | null;
  score_cons: string[] | null;
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
