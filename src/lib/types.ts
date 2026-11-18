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
  | "pinpoint"
  | "jobylon"
  | "jobtech"
  | "swedengamejobs"
  | "himalayas"
  | "workingnomads"
  | "remoteok"
  | "weworkremotely"
  | "arbeitnow"
  | "workwithindies";

/** How each source type is configured on the Sources page. */
/**
 * aggregator: lists other companies' jobs (runs after direct sources, never overrides them).
 * suggests: its links are mined for direct sources to suggest.
 * partial: only shows recent ads, so ads missing from it aren't closed.
 * fixedSlug: the source has nothing to configure; this is stored as its slug.
 * defaultName: the name used when the form leaves it empty.
 * blurb: one line on what it covers, for the Sources page.
 */
export const ATS_INFO: Record<
  Ats,
  {
    label: string;
    slugLabel: string;
    slugExample: string;
    aggregator?: boolean;
    suggests?: boolean;
    partial?: boolean;
    fixedSlug?: string;
    defaultName?: string;
    blurb?: string;
  }
> = {
  greenhouse: { label: "Greenhouse", slugLabel: "Board slug or URL", slugExample: "job-boards.greenhouse.io/mojangab" },
  lever: { label: "Lever", slugLabel: "Board slug or URL", slugExample: "jobs.lever.co/avalanchestudios" },
  ashby: { label: "Ashby", slugLabel: "Board slug or URL", slugExample: "jobs.ashbyhq.com/voodoo" },
  teamtailor: { label: "Teamtailor", slugLabel: "Career site domain", slugExample: "career.paradoxplaza.com" },
  smartrecruiters: { label: "SmartRecruiters", slugLabel: "Company identifier or URL", slugExample: "jobs.smartrecruiters.com/Ubisoft2" },
  personio: { label: "Personio", slugLabel: "Career site URL", slugExample: "personio.jobs.personio.de" },
  recruitee: { label: "Recruitee", slugLabel: "Career site URL", slugExample: "bunq.recruitee.com" },
  workable: { label: "Workable", slugLabel: "Account or URL", slugExample: "apply.workable.com/huggingface" },
  workday: { label: "Workday", slugLabel: "Careers site URL", slugExample: "philips.wd3.myworkdayjobs.com/jobs-and-careers" },
  pinpoint: { label: "Pinpoint", slugLabel: "Career site URL", slugExample: "workwithus.pinpointhq.com" },
  jobylon: { label: "Jobylon", slugLabel: "Company id or a posting URL", slugExample: "emp.jobylon.com/companies/2986" },
  jobtech: {
    label: "JobTech / Platsbanken (aggregator)",
    slugLabel: "Search parameters (optional)",
    slugExample: "occupation-field=apaJ_2ja_LuF",
    aggregator: true,
    partial: true,
    defaultName: "Platsbanken (JobTech)",
    blurb: "Sweden's public job board, every employer",
  },
  swedengamejobs: {
    label: "Sweden Game Jobs (aggregator)",
    slugLabel: "—",
    slugExample: "swedengamejobs.com",
    aggregator: true,
    suggests: true,
    fixedSlug: "swedengamejobs.com",
    defaultName: "Sweden Game Jobs",
    blurb: "Swedish game studios",
  },
  himalayas: {
    label: "Himalayas (aggregator)",
    slugLabel: "Search parameters (optional)",
    slugExample: "q=developer&country=SE",
    aggregator: true,
    partial: true,
    defaultName: "Himalayas",
    blurb: "Remote jobs worldwide; filtered by a search",
  },
  workingnomads: {
    label: "Working Nomads (aggregator)",
    slugLabel: "—",
    slugExample: "workingnomads.com",
    aggregator: true,
    partial: true,
    fixedSlug: "workingnomads.com",
    defaultName: "Working Nomads",
    blurb: "Remote jobs, many open to Europe",
  },
  remoteok: {
    label: "Remote OK (aggregator)",
    slugLabel: "—",
    slugExample: "remoteok.com",
    aggregator: true,
    partial: true,
    fixedSlug: "remoteok.com",
    defaultName: "Remote OK",
    blurb: "Remote jobs, mostly US",
  },
  weworkremotely: {
    label: "We Work Remotely (aggregator)",
    slugLabel: "Category (optional)",
    slugExample: "remote-full-stack-programming-jobs",
    aggregator: true,
    partial: true,
    defaultName: "We Work Remotely",
    blurb: "Remote jobs, mostly US",
  },
  arbeitnow: {
    label: "Arbeitnow (aggregator)",
    slugLabel: "—",
    slugExample: "arbeitnow.com",
    aggregator: true,
    partial: true,
    fixedSlug: "arbeitnow.com",
    defaultName: "Arbeitnow",
    blurb: "Europe, mostly Germany",
  },
  workwithindies: {
    label: "Work With Indies (aggregator)",
    slugLabel: "—",
    slugExample: "workwithindies.com",
    aggregator: true,
    fixedSlug: "workwithindies.com",
    defaultName: "Work With Indies",
    blurb: "Indie game studios worldwide",
  },
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

/** One person's search criteria (the shared schedule and model are in Settings). */
export interface Criteria {
  user_id: string;
  roles: string[];
  locations: string[];
  remote_ok: boolean;
  include_keywords: string[];
  exclude_keywords: string[];
  preferences: string;
  score_threshold: number;
  followup_days: number;
  digest_email: string;
}

/** App-wide settings, admin-only: the shared schedule, the scoring model, a global spend cap. */
export interface Settings {
  /** Watchlist check interval; 0 = off. */
  watch_interval_minutes: number;
  /** Local time ("HH:MM", in `timezone`) of the daily full search + digests. */
  daily_time: string;
  daily_enabled: boolean;
  /** IANA timezone, e.g. "Europe/Budapest". */
  timezone: string;
  scoring_model: ScoringModel;
  /** AI spend across everyone per rolling 24 hours (USD): a backstop over the per-person caps. */
  max_total_daily_cost_usd: number;
}

/** AI spend caps (USD) a new member starts with, and what an emptied cap field falls back to. */
export const DEFAULT_CAPS = { run: 0.01, daily: 0.05 };

/** Someone who may use the app. Their AI spend caps (USD; 0 = no scoring) are set by the admin. */
export interface Member {
  user_id: string;
  email: string;
  is_admin: boolean;
  max_run_cost_usd: number;
  max_daily_cost_usd: number;
  created_at: string;
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
  /** Listings returned by the last successful check (an aggregator dropping to 0 is flagged). */
  last_job_count: number | null;
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
  kind: "watchlist" | "full" | "score" | "digest";
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
