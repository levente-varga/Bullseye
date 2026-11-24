"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CareerSchema, extractCareer } from "@/lib/career";
import { withDefaults } from "@/lib/career-schema";
import { extractPdfText, MAX_CV_BYTES } from "@/lib/cv";
import type { CvDraft, DraftRow, LetterDraft, LetterQA } from "@/lib/draft-types";
import { generateCv, generateLetter, letterQuestions, type DraftJob } from "@/lib/drafts";
import { costUsd, type TokenUsage } from "@/lib/pricing";
import { buildSystemPrompt, resolveModel, scoreJob, type FeedbackExample } from "@/lib/scoring";
import { fetchBoard, locationNeedsDetail } from "@/lib/ats";
import { dedupeKey, detectAts } from "@/lib/dedupe";
import { detectSource } from "@/lib/detect-source";
import { hardFilter } from "@/lib/filters";
import { createClient, currentUser } from "@/lib/supabase/server";
import {
  ATS_INFO,
  FETCH_MODES,
  DEFAULT_SCORING_MODEL,
  DRAFT_LANGUAGES,
  SCORING_MODELS,
  WATCH_INTERVALS,
  type Ats,
  type Criteria,
  type FetchedJob,
  type JobDetails,
  type JobStatus,
  type Profile,
  PIPELINE_STATUSES,
} from "@/lib/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
/** Splits a textarea on newlines or commas into a clean list. */
const list = (f: FormData, k: string) =>
  str(f, k)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

async function db() {
  return createClient();
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

// --- Inbox / pipeline -------------------------------------------------------

export type AddJobResult = { tone: "ok" | "bad"; message: string; at: number } | null;

/**
 * Adds a job by hand (Pipeline → Add a job, useActionState): for postings no source can
 * read. Nothing is fetched; it goes straight into the Pipeline. A posting Bullseye
 * already knows (same link) is reused rather than duplicated.
 */
export async function addManualJob(_prev: AddJobResult, form: FormData): Promise<AddJobResult> {
  const at = Date.now();
  const raw = str(form, "url");
  let link: string;
  try {
    link = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString();
  } catch {
    return { tone: "bad", message: "That link doesn't look like a URL.", at };
  }
  const title = str(form, "title");
  const company = str(form, "company");
  if (!title || !company) return { tone: "bad", message: "Add a title and a company.", at };
  const supabase = await db();
  const { error } = await supabase.rpc("add_manual_job", {
    p_url: link,
    p_title: title,
    p_company: company,
    p_location: str(form, "location"),
    p_remote: form.get("remote") === "on",
    p_description: str(form, "description"),
    p_dedupe: dedupeKey(link),
  });
  if (error) return { tone: "bad", message: `Couldn't add it: ${error.message}`, at };
  revalidatePath("/", "layout");
  return { tone: "ok", message: `Added ${title} at ${company} to your Pipeline.`, at };
}

export async function approveJob(form: FormData) {
  const supabase = await db();
  const id = str(form, "id");
  check((await supabase.from("matches").update({ status: "approved" }).eq("job_id", id)).error);
  check((await supabase.from("feedback").insert({ job_id: id, decision: "approve", note: str(form, "note") || null })).error);
  revalidatePath("/");
}

/** The scorer's reasoning for one job, loaded when its Inbox row is opened. */
export async function getJobDetails(id: string): Promise<JobDetails | null> {
  const supabase = await db();
  const { data } = await supabase.from("my_jobs").select("url, score_checks, score_summary, score_pros, score_cons").eq("id", id).single();
  return (data as JobDetails | null) ?? null;
}

export async function skipJob(form: FormData) {
  const supabase = await db();
  const id = str(form, "id");
  const reasons = form.getAll("reasons").map(String);
  const other = str(form, "other");
  if (other) reasons.push(other);
  check((await supabase.from("matches").update({ status: "skipped" }).eq("job_id", id)).error);
  check((await supabase.from("feedback").insert({ job_id: id, decision: "skip", reasons, note: str(form, "note") || null })).error);
  revalidatePath("/");
}

export async function setStatus(form: FormData) {
  const supabase = await db();
  const status = str(form, "status") as JobStatus;
  check((await supabase.from("matches").update({ status }).eq("job_id", str(form, "id"))).error);
  revalidatePath("/pipeline");
}

/**
 * Undo: puts a job back in the Inbox, untouched. Works from the Pipeline ("Back to Inbox")
 * and the Inbox's Skipped view ("Restore"). Its approve/skip decision is deleted too,
 * so a misclick doesn't teach the scorer anything.
 */
export async function restoreToInbox(form: FormData) {
  const supabase = await db();
  const id = str(form, "id");
  check((await supabase.from("feedback").delete().eq("job_id", id)).error);
  check((await supabase.from("matches").update({ status: "scored" }).eq("job_id", id)).error);
  revalidatePath("/");
  revalidatePath("/pipeline");
}

export async function markFollowedUp(form: FormData) {
  const supabase = await db();
  check(
    (await supabase.from("matches").update({ followed_up_at: new Date().toISOString() }).eq("job_id", str(form, "id"))).error,
  );
  revalidatePath("/pipeline");
}

// --- Criteria ---------------------------------------------------------------

export async function saveCriteria(form: FormData) {
  const supabase = await db();
  const me = await currentUser(supabase);
  check(
    (
      await supabase
        .from("criteria")
        .update({
          roles: list(form, "roles"),
          locations: list(form, "locations"),
          remote_ok: form.get("remote_ok") === "on",
          include_keywords: list(form, "include_keywords"),
          exclude_keywords: list(form, "exclude_keywords"),
          preferences: str(form, "preferences"),
          score_threshold: Math.min(100, Math.max(0, Number(str(form, "score_threshold")) || 60)),
          followup_days: Math.max(1, Number(str(form, "followup_days")) || 10),
          digest_email: str(form, "digest_email"),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", me.id)
    ).error,
  );
  revalidatePath("/criteria");
}

/** Admin only (RLS enforces it too): the shared schedule, the scoring model, and spend caps. */
export async function saveSettings(form: FormData) {
  const supabase = await db();
  const me = await currentUser(supabase);
  if (!me.isAdmin) return;
  check(
    (
      await supabase
        .from("settings")
        .update({
          scoring_model: SCORING_MODELS.some((m) => m.id === str(form, "scoring_model"))
            ? str(form, "scoring_model")
            : DEFAULT_SCORING_MODEL,
          writing_model: SCORING_MODELS.some((m) => m.id === str(form, "writing_model"))
            ? str(form, "writing_model")
            : DEFAULT_SCORING_MODEL,
          max_total_daily_cost_usd: money(str(form, "max_total_daily_cost_usd")),
          ...scheduleFields(form),
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1)
    ).error,
  );
  // The admin's own caps sit on their member row, like everyone's.
  check(
    (
      await supabase
        .from("members")
        .update({
          max_run_cost_usd: money(str(form, "max_run_cost_usd")),
          max_daily_cost_usd: money(str(form, "max_daily_cost_usd")),
        })
        .eq("user_id", me.id)
    ).error,
  );
  revalidatePath("/settings");
  revalidatePath("/criteria"); // its schedule line
}

/** Schedule fields from the Settings form, validated so a bad value can't stop the worker. */
function scheduleFields(form: FormData) {
  const interval = Number(str(form, "watch_interval_minutes"));
  const time = str(form, "daily_time");
  const tz = str(form, "timezone");
  let validTz = false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    validTz = tz.length > 0;
  } catch {}
  return {
    ...(WATCH_INTERVALS.some((w) => w.minutes === interval) ? { watch_interval_minutes: interval } : {}),
    ...(/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? { daily_time: time } : {}),
    ...(validTz ? { timezone: tz } : {}),
    daily_enabled: form.get("daily_enabled") === "on",
  };
}

/** Columns the hard filters read, plus what deciding the outcome needs. */
type EvalRow = { id: string; url: string; title: string; location: string; remote: boolean; description: string; thin: boolean; status: JobStatus; filter_reason: string | null };

const RESET_SCORE = { score: null, score_checks: null, score_summary: null, score_pros: null, score_cons: null, scored_at: null };

/**
 * Applies the saved criteria to jobs you haven't acted on (waiting, scored, filtered):
 * - fails the filters now → Filtered (with the new reason)
 * - was filtered, passes now → waiting to be scored (described first if it never was)
 * - with `rescore`: scored jobs that still pass → scored again at the next run, first; they
 *   keep their old score (and their place in the Inbox) until then
 * Free by itself; scoring happens at the next runs. Decisions and the Pipeline are untouched.
 */
export async function reevaluate(form: FormData) {
  const supabase = await db();
  const rescore = form.get("rescore") === "on";
  const { data: c, error } = await supabase.from("criteria").select("*").single();
  check(error);
  const criteria = c as Criteria;

  const toFiltered = new Map<string, string[]>(); // reason → ids
  const toWaiting: string[] = [];
  const toRescore: string[] = [];
  let kept = 0;
  let moved = 0; // newly filtered
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const { data, error: e } = await supabase
      .from("my_jobs")
      .select("id, url, title, location, remote, description, thin, status, filter_reason")
      .in("status", ["new", "scored", "filtered"])
      .order("id")
      .range(from, from + PAGE - 1);
    check(e);
    const rows = (data ?? []) as EvalRow[];
    for (const j of rows) {
      const noText = !j.description || j.thin;
      const reason = hardFilter(j as unknown as FetchedJob, criteria, {
        skipKeywordCheck: noText,
        locationPending: !j.description && locationNeedsDetail(j.url),
      });
      if (reason) {
        // Still filtered with a different reason: the reason is updated, but it isn't a move.
        if (j.status !== "filtered" || j.filter_reason !== reason) toFiltered.set(reason, [...(toFiltered.get(reason) ?? []), j.id]);
        if (j.status === "filtered") kept++;
        else moved++;
      } else if (j.status === "filtered") {
        toWaiting.push(j.id);
      } else if (rescore && j.status === "scored") {
        toRescore.push(j.id);
      } else {
        kept++;
      }
    }
    if (rows.length < PAGE) break;
  }

  // Updates in chunks: ids travel in the request URL.
  const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 150) }, (_, i) => ids.slice(i * 150, i * 150 + 150));
  for (const [reason, ids] of toFiltered) {
    for (const part of chunks(ids)) {
      check((await supabase.from("matches").update({ status: "filtered", filter_reason: reason, ...RESET_SCORE }).in("job_id", part)).error);
    }
  }
  for (const part of chunks(toWaiting)) {
    check((await supabase.from("matches").update({ status: "new", filter_reason: null, ...RESET_SCORE }).in("job_id", part)).error);
  }
  // Re-scores keep their status and score (they stay in the Inbox); a cleared scored_at
  // tells the worker to score them again, first, and the new score replaces the old.
  for (const part of chunks(toRescore)) {
    check((await supabase.from("matches").update({ scored_at: null }).in("job_id", part)).error);
  }

  revalidatePath("/", "layout");
  const summary = new URLSearchParams({
    filtered: String(moved),
    waiting: String(toWaiting.length),
    rescore: String(toRescore.length),
    kept: String(kept),
  });
  redirect(`/criteria?${summary}#reevaluate`);
}

export async function addExcludeKeyword(form: FormData) {
  const supabase = await db();
  const kw = str(form, "keyword");
  if (!kw) return;
  const me = await currentUser(supabase);
  const { data, error } = await supabase.from("criteria").select("exclude_keywords").single();
  check(error);
  const next = [...new Set([...(data!.exclude_keywords as string[]), kw])];
  check((await supabase.from("criteria").update({ exclude_keywords: next }).eq("user_id", me.id)).error);
  revalidatePath("/criteria");
}

/** A dollar amount from a form field: non-negative, in cents; undefined when empty or invalid (the value stays as it was). */
function money(raw: string): number | undefined {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

// --- Sources ----------------------------------------------------------------

/** Turns what the user typed (a URL or a bare value) into the slug each source type expects. */
function normalizeSlug(ats: Ats, input: string): string {
  const raw = input.trim();
  const fixed = ATS_INFO[ats].fixedSlug;
  if (fixed) return fixed;
  // Jobylon: the company id, bare or from a company/embed URL (a posting URL needs Auto-detect).
  if (ats === "jobylon") return raw.match(/companies\/(\d+)/)?.[1] ?? (/^\d+$/.test(raw) ? raw : "");
  const host = raw.replace(/^https?:\/\//, "").split(/[/?#]/)[0].toLowerCase();
  if (ats === "teamtailor") return host; // e.g. career.paradoxplaza.com
  // Career site hosts; a bare company name gets the default domain.
  if (ats === "personio") return host.includes(".") ? host : `${host}.jobs.personio.de`;
  if (ats === "recruitee") return host.includes(".") ? host : `${host}.recruitee.com`;
  if (ats === "pinpoint") return host.includes(".") ? host : `${host}.pinpointhq.com`;
  if (ats === "workday") {
    // "<tenant>.wd<N>.myworkdayjobs.com/<site>", from a careers site or posting URL.
    const d = detectAts(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return d.ats === "workday" ? d.slug : "";
  }
  // Board slug: the first path segment of a board URL (with or without https://), or the bare value.
  const parts = raw.replace(/^https?:\/\//, "").split(/[?#]/)[0].split("/").filter(Boolean);
  const value = (parts.length > 1 && parts[0].includes(".") ? parts[1] : parts[0]) ?? "";
  // SmartRecruiters company identifiers keep their case (e.g. Ubisoft2).
  return ats === "smartrecruiters" ? value : value.toLowerCase();
}

/** Follows a source from the form: auto-detected from a link, or a type picked from the catalog. */
async function follow(form: FormData): Promise<{ ok: string; aggregator: boolean } | { error: string }> {
  const supabase = await db();
  const chosen = str(form, "ats");
  let ats: Ats;
  let slug: string;
  let name = str(form, "company_name");
  let jobCount: number | null = null;

  if (chosen === "auto") {
    const found = await detectSource(str(form, "slug"));
    if ("error" in found) return { error: found.error };
    ({ ats, slug } = found);
    name ||= found.companyGuess;
    jobCount = found.jobCount;
  } else {
    if (!(chosen in ATS_INFO)) return { error: "Pick a source type." };
    ats = chosen as Ats;
    slug = normalizeSlug(ats, str(form, "slug"));
    if (!slug) return { error: "Enter the board, domain or URL." };
    // A Jobylon id says nothing about the company: take the name from its listings.
    if (!name && ats === "jobylon") {
      name = (await fetchBoard({ ats, slug, company_name: "", country: null }).catch(() => []))[0]?.company ?? "";
    }
    name ||= ATS_INFO[ats].defaultName ?? slug;
  }

  const { data: sub, error } = await supabase.rpc("subscribe_source", { p_ats: ats, p_slug: slug, p_company_name: name });
  check(error);
  if ((sub as { already?: boolean } | null)?.already) return { error: `${name} is already one of your sources.` };
  revalidatePath("/", "layout");
  return {
    ok: `${name} · ${ATS_INFO[ats].label}${jobCount !== null ? ` · ${jobCount} open ${jobCount === 1 ? "job" : "jobs"}` : ""}`,
    aggregator: Boolean(ATS_INFO[ats].aggregator),
  };
}

/** Follow from the aggregator catalog: back to that section with a note. */
export async function addSource(form: FormData) {
  const result = await follow(form);
  if ("error" in result) redirect(`/sources?${new URLSearchParams({ error: result.error })}#aggregators`);
  redirect(`/sources?${new URLSearchParams({ followed: str(form, "company_name") || result.ok.split(" · ")[0] })}#aggregators`);
}

export type AddBoardResult = { tone: "ok" | "bad"; message: string; at: number } | null;

/**
 * The Add board form (useActionState): returns its result to the form instead of
 * redirecting, so the page doesn't navigate or jump and the result shows under the form.
 */
export async function addBoard(_prev: AddBoardResult, form: FormData): Promise<AddBoardResult> {
  const result = await follow(form);
  return "error" in result
    ? { tone: "bad", message: result.error, at: Date.now() }
    : { tone: "ok", message: `Added ${result.ok}`, at: Date.now() };
}

export async function acceptSuggestion(form: FormData) {
  const supabase = await db();
  const id = str(form, "id");
  const { data: s, error } = await supabase.from("source_suggestions").select("*").eq("id", id).single();
  check(error);
  if (!s || !(s.ats in ATS_INFO)) return;
  // Already followed: subscribe_source does nothing, and the suggestion is still marked handled.
  check(
    (await supabase.rpc("subscribe_source", { p_ats: s.ats, p_slug: s.slug, p_company_name: s.company_name })).error,
  );
  check((await supabase.from("source_suggestions").update({ status: "added" }).eq("id", id)).error);
  revalidatePath("/sources");
}

export async function dismissSuggestion(form: FormData) {
  const supabase = await db();
  check((await supabase.from("source_suggestions").update({ status: "dismissed" }).eq("id", str(form, "id"))).error);
  revalidatePath("/sources");
}

export async function updateSource(form: FormData) {
  const supabase = await db();
  const field = str(form, "field");
  if (field !== "watchlist" && field !== "enabled") return;
  // Paged and search sources are too expensive to fetch at the watchlist interval.
  if (field === "watchlist" && str(form, "value") === "true") {
    const { data } = await supabase.from("my_sources").select("ats").eq("id", str(form, "id")).single();
    const ats = data?.ats as Ats | undefined;
    if (!ats || !FETCH_MODES[ATS_INFO[ats].fetch].watchable) return;
  }
  check(
    (await supabase.from("subscriptions").update({ [field]: str(form, "value") === "true" }).eq("source_id", str(form, "id"))).error,
  );
  revalidatePath("/sources");
}

/**
 * Renames a source: your own label always; the shared name and its postings' company too
 * when you're its only follower or the admin (see rename_source in the migrations).
 */
export async function renameSource(form: FormData) {
  const supabase = await db();
  const name = str(form, "name");
  if (!name) return;
  check((await supabase.rpc("rename_source", { p_source: str(form, "id"), p_name: name })).error);
  revalidatePath("/", "layout");
}

export async function deleteSource(form: FormData) {
  const supabase = await db();
  // Unfollow: drops the listings you haven't acted on; the Pipeline and skipped ones stay.
  check((await supabase.rpc("unsubscribe_source", { p_source: str(form, "id") })).error);
  revalidatePath("/", "layout");
  revalidatePath("/sources");
}

// --- Profile + answer bank --------------------------------------------------

export async function saveProfile(form: FormData) {
  const supabase = await db();
  const me = await currentUser(supabase);
  check(
    (
      await supabase
        .from("profile")
        .update({
          full_name: str(form, "full_name"),
          email: str(form, "email"),
          phone: str(form, "phone"),
          location: str(form, "location"),
          headline: str(form, "headline"),
          linkedin_url: url(str(form, "linkedin_url")),
          github_url: url(str(form, "github_url")),
          website_url: url(str(form, "website_url")),
          links: list(form, "links").map(url),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", me.id)
    ).error,
  );
  revalidatePath("/profile");
}

/** Draft settings (Profile → Drafts): language, CV photo and length, cover letter questions. */
export async function saveDraftSettings(form: FormData) {
  const supabase = await db();
  const me = await currentUser(supabase);
  const language = str(form, "draft_language");
  const length = str(form, "cv_length");
  check(
    (
      await supabase
        .from("profile")
        .update({
          draft_language: DRAFT_LANGUAGES.some((l) => l.id === language) ? language : "en",
          cv_photo: form.get("cv_photo") === "on",
          cv_length: length === "two_pages" ? "two_pages" : "one_page",
          letter_questions: form.get("letter_questions") === "on",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", me.id)
    ).error,
  );
  revalidatePath("/profile");
}

export type PhotoResult = { tone: "ok" | "bad"; message: string; at: number } | null;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Uploads the profile photo (Profile → Photo, useActionState) to <user id>/photo.<ext>, replacing any earlier one. */
export async function uploadPhoto(_prev: PhotoResult, form: FormData): Promise<PhotoResult> {
  const at = Date.now();
  const bad = (message: string) => ({ tone: "bad" as const, message, at });
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return bad("Choose an image first.");
  const ext = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : null;
  if (!ext) return bad("Only JPEG and PNG images are supported.");
  if (file.size > MAX_PHOTO_BYTES) return bad("That image is over 2 MB.");
  const supabase = await db();
  const me = await currentUser(supabase);
  const { data: p } = await supabase.from("profile").select("photo_path").eq("user_id", me.id).single();
  const path = `${me.id}/photo.${ext}`;
  const up = await supabase.storage.from("photos").upload(path, file, { upsert: true, contentType: file.type });
  if (up.error) return bad(`Upload failed: ${up.error.message}`);
  // A PNG replacing a JPEG (or the other way round) leaves the old file behind: remove it.
  if (p?.photo_path && p.photo_path !== path) await supabase.storage.from("photos").remove([p.photo_path]);
  check((await supabase.from("profile").update({ photo_path: path, updated_at: new Date().toISOString() }).eq("user_id", me.id)).error);
  revalidatePath("/profile");
  return { tone: "ok", message: "Photo saved.", at };
}

export async function removePhoto() {
  const supabase = await db();
  const me = await currentUser(supabase);
  const { data: p } = await supabase.from("profile").select("photo_path").eq("user_id", me.id).single();
  if (p?.photo_path) check((await supabase.storage.from("photos").remove([p.photo_path])).error);
  check((await supabase.from("profile").update({ photo_path: null, updated_at: new Date().toISOString() }).eq("user_id", me.id)).error);
  revalidatePath("/profile");
}

/** "github.com/me" → "https://github.com/me"; empty stays empty. */
const url = (v: string) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v);

/**
 * Records an AI task outside runs (Report → Other AI tasks; counted in the credit chart and
 * the 24-hour spend caps). A failure to record never fails the task itself.
 */
async function recordAiUsage(
  supabase: Awaited<ReturnType<typeof db>>,
  u: { kind: string; model: string; usage: TokenUsage; costUsd: number; detail?: string },
) {
  const { error } = await supabase.from("ai_usage").insert({
    kind: u.kind,
    model: u.model,
    tokens_in: u.usage.input + u.usage.cacheWrite + u.usage.cacheRead,
    tokens_cache_write: u.usage.cacheWrite,
    tokens_cache_read: u.usage.cacheRead,
    tokens_out: u.usage.output,
    cost_usd: Math.round(u.costUsd * 1e6) / 1e6,
    detail: u.detail ?? "",
  });
  if (error) console.error("ai_usage insert failed:", error.message);
}

export type CareerResult = { tone: "ok" | "bad"; message: string; at: number } | null;

/**
 * Fills the career from a CV PDF (Profile page, useActionState): its text is read in
 * memory and given to the writing model; the PDF itself isn't kept. Replaces the career
 * that was there (the page asks first); the person reviews it afterwards.
 */
export async function careerFromPdf(_prev: CareerResult, form: FormData): Promise<CareerResult> {
  const at = Date.now();
  const bad = (message: string) => ({ tone: "bad" as const, message, at });
  if (!process.env.ANTHROPIC_API_KEY) return bad("The app has no Anthropic API key (ANTHROPIC_API_KEY) yet.");
  const file = form.get("cv");
  if (!(file instanceof File) || file.size === 0) return bad("Choose a PDF file first.");
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return bad("Only PDF files are supported.");
  if (file.size > MAX_CV_BYTES) return bad("That file is over 5 MB.");
  let text = "";
  try {
    text = (await extractPdfText(await file.arrayBuffer())).trim();
  } catch {
    return bad("Couldn't read that PDF. Is it password-protected or damaged?");
  }
  if (!text) return bad("That PDF has no text layer (probably a scan), so there's nothing to read. Fill the career in by hand instead.");

  const supabase = await db();
  const me = await currentUser(supabase);
  // Members spend from the balance the admin gave them; the admin draws on the account.
  if (!me.isAdmin) {
    const { data: bal } = await supabase.from("member_balances").select("balance_usd").eq("user_id", me.id).maybeSingle();
    if (Number(bal?.balance_usd ?? 0) <= 0) return bad("Your AI balance is used up. Ask the admin for more credit.");
  }
  const { data: st } = await supabase.from("settings").select("writing_model").single();
  // The admin's writing model (Settings); Haiku until one is set.
  const model = SCORING_MODELS.find((m) => m.id === st?.writing_model)?.id ?? DEFAULT_SCORING_MODEL;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { career, costUsd, usage } = await extractCareer(new Anthropic(), model, text);
    // Logged first, so the spend is on record even if saving the career fails.
    await recordAiUsage(supabase, { kind: "career_import", model, usage, costUsd, detail: file.name });
    check(
      (await supabase.from("profile").update({ career, career_updated_at: new Date().toISOString() }).eq("user_id", me.id)).error,
    );
    revalidatePath("/", "layout"); // the Inbox says when scoring waits for a career; the Report lists the cost
    return {
      tone: "ok",
      message: `Filled from ${file.name}: ${career.experiences.length} roles, ${career.education.length} degrees, ${career.projects.length} projects. Check it below.`,
      at,
    };
  } catch (e) {
    return bad(`Reading the CV failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Restores a career from an exported JSON file (Profile page, useActionState): the file's
 * text arrives as `json`, is checked against the schema and replaces the career.
 * Accepts the export ({ career: … }) or a bare career object.
 */
export async function careerFromJson(_prev: CareerResult, form: FormData): Promise<CareerResult> {
  const at = Date.now();
  let data: unknown;
  try {
    data = JSON.parse(str(form, "json"));
  } catch {
    return { tone: "bad", message: "That file isn't valid JSON.", at };
  }
  const career = data && typeof data === "object" && "career" in data ? (data as { career: unknown }).career : data;
  const parsed = CareerSchema.safeParse(withDefaults(career as Parameters<typeof withDefaults>[0]));
  if (!parsed.success) return { tone: "bad", message: "That JSON isn't a Bullseye career export, so nothing was changed.", at };
  const supabase = await db();
  const me = await currentUser(supabase);
  check(
    (await supabase.from("profile").update({ career: parsed.data, career_updated_at: new Date().toISOString() }).eq("user_id", me.id)).error,
  );
  revalidatePath("/", "layout");
  return {
    tone: "ok",
    message: `Imported: ${parsed.data.experiences.length} roles, ${parsed.data.education.length} degrees, ${parsed.data.projects.length} projects.`,
    at,
  };
}

/** Saves the edited career (the editor posts it as JSON), validated against the schema. */
export async function saveCareer(form: FormData) {
  const supabase = await db();
  const me = await currentUser(supabase);
  const parsed = CareerSchema.safeParse(withDefaults(JSON.parse(str(form, "career") || "null")));
  if (!parsed.success) throw new Error("The career data didn't validate; nothing was saved.");
  check(
    (await supabase.from("profile").update({ career: parsed.data, career_updated_at: new Date().toISOString() }).eq("user_id", me.id)).error,
  );
  revalidatePath("/", "layout"); // the Inbox says when scoring waits for a career
}

export async function saveAnswer(form: FormData) {
  const supabase = await db();
  const id = str(form, "id");
  const row = { question: str(form, "question"), answer: str(form, "answer"), updated_at: new Date().toISOString() };
  if (!row.question || !row.answer) return;
  check((id ? await supabase.from("answers").update(row).eq("id", id) : await supabase.from("answers").insert(row)).error);
  revalidatePath("/profile");
}

export async function deleteAnswer(form: FormData) {
  const supabase = await db();
  check((await supabase.from("answers").delete().eq("id", str(form, "id"))).error);
  revalidatePath("/profile");
}

// --- Credits ----------------------------------------------------------------

/** Records a credit top-up: an amount added on a day. It counts from that day's start, so the day's runs are included. */
export async function addCreditEntry(form: FormData) {
  const supabase = await db();
  // The admin's Anthropic balance: RLS (credit_admin) refuses others too.
  if (!(await currentUser(supabase)).isAdmin) return;
  const amount = Number(str(form, "amount").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const date = str(form, "date");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  // balance_usd holds the top-up amount (the column predates top-ups).
  check((await supabase.from("credit_entries").insert({ balance_usd: amount, entered_at: `${day}T00:00:00Z` })).error);
  revalidatePath("/report");
}

export async function deleteCreditEntry(form: FormData) {
  const supabase = await db();
  if (!(await currentUser(supabase)).isAdmin) return;
  check((await supabase.from("credit_entries").delete().eq("id", str(form, "id"))).error);
  revalidatePath("/report");
}

// --- Auth -------------------------------------------------------------------

export async function signOut() {
  const supabase = await db();
  await supabase.auth.signOut();
  redirect("/login");
}

// --- Members (admin) ----------------------------------------------------------

/** Queues an invite; the worker creates the account and emails the link within ~15 minutes. */
export async function inviteMember(form: FormData) {
  const supabase = await db();
  const me = await currentUser(supabase);
  if (!me.isAdmin) return;
  const email = str(form, "email").toLowerCase();
  const back = (q: Record<string, string>) => redirect(`/admin?${new URLSearchParams(q)}`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) back({ error: "That doesn't look like an email address." });
  // Upsert: inviting again re-sends (clears an earlier failure).
  check((await supabase.from("invites").upsert({ email, invited_at: new Date().toISOString(), sent_at: null, error: null })).error);
  revalidatePath("/admin");
  back({ invited: email });
}

export async function cancelInvite(form: FormData) {
  const supabase = await db();
  // RLS (invites_admin) refuses others too; checked here as well, like every admin action.
  if (!(await currentUser(supabase)).isAdmin) return;
  check((await supabase.from("invites").delete().eq("email", str(form, "email"))).error);
  revalidatePath("/admin");
}

export async function updateMemberCaps(form: FormData) {
  const supabase = await db();
  const me = await currentUser(supabase);
  if (!me.isAdmin) return;
  check(
    (
      await supabase
        .from("members")
        .update({
          max_run_cost_usd: money(str(form, "max_run_cost_usd")),
          max_daily_cost_usd: money(str(form, "max_daily_cost_usd")),
        })
        .eq("user_id", str(form, "user_id"))
    ).error,
  );
  revalidatePath("/admin");
}

/** Gives a member AI credit (Members page), or takes some back with a negative amount. */
export async function addCreditGrant(form: FormData) {
  const supabase = await db();
  const me = await currentUser(supabase);
  if (!me.isAdmin) return; // RLS (credit_grants_admin) refuses others too
  const amount = Number(str(form, "amount").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount === 0) return;
  check(
    (
      await supabase.from("credit_grants").insert({
        user_id: str(form, "user_id"),
        amount_usd: Math.round(amount * 10_000) / 10_000,
        note: str(form, "note"),
      })
    ).error,
  );
  revalidatePath("/admin");
  revalidatePath("/report");
}

/** Deletes the member's account and everything personal; needs the confirm box ticked. */
export async function removeMember(form: FormData) {
  const supabase = await db();
  if (form.get("confirm") !== "on") redirect("/admin?error=Tick the box to confirm removing a member.");
  check((await supabase.rpc("remove_member", { p_user: str(form, "user_id") })).error);
  revalidatePath("/admin");
}

/** The caps new members start with (admin only; RLS enforces it too). */
export async function saveMemberDefaults(form: FormData) {
  const supabase = await db();
  const me = await currentUser(supabase);
  if (!me.isAdmin) return;
  check(
    (
      await supabase
        .from("settings")
        .update({
          default_run_cost_usd: money(str(form, "default_run_cost_usd")),
          default_daily_cost_usd: money(str(form, "default_daily_cost_usd")),
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1)
    ).error,
  );
  revalidatePath("/admin");
}

// --- Re-score one job ---------------------------------------------------------------------

export type RescoreResult = { tone: "ok" | "bad"; message: string };

/**
 * Re-evaluates one Inbox job from scratch, right away (not on the next run): the hard
 * filters with today's criteria, then a fresh AI score with today's career, preferences
 * and past decisions. A job that no longer passes the filters leaves the Inbox as
 * filtered. The cost is recorded as an AI task ("rescore").
 */
export async function rescoreJob(jobId: string): Promise<RescoreResult> {
  const bad = (message: string) => ({ tone: "bad" as const, message });
  if (!process.env.ANTHROPIC_API_KEY) return bad("The app has no Anthropic API key (ANTHROPIC_API_KEY) yet.");
  const supabase = await db();
  const me = await currentUser(supabase);
  if (!me.isAdmin) {
    const { data: bal } = await supabase.from("member_balances").select("balance_usd").eq("user_id", me.id).maybeSingle();
    if (Number(bal?.balance_usd ?? 0) <= 0) return bad("Your AI balance is used up. Ask the admin for more credit.");
  }
  const [{ data: job }, { data: c }, { data: p }, { data: st }, { data: fb }] = await Promise.all([
    supabase.from("my_jobs").select("id, url, title, company, location, remote, description, compensation, posted_at, thin, status").eq("id", jobId).single(),
    supabase.from("criteria").select("*").single(),
    supabase.from("profile").select("*").single(),
    supabase.from("settings").select("scoring_model").single(),
    supabase.from("feedback").select("decision, reasons, note, jobs(title, company)").order("created_at", { ascending: false }).limit(40),
  ]);
  if (!job || !["new", "scored"].includes(job.status)) return bad("Only jobs in the Inbox can be re-scored.");
  const profile = p as Profile | null;
  if (!c || !profile || !withDefaults(profile.career)) return bad("Fill in your career on the Profile page first: the scorer reads it.");
  const criteria = c as Criteria;

  // 1. The filters, as the worker runs them.
  const noText = !job.description || job.thin;
  const reason = hardFilter(job as unknown as FetchedJob, criteria, {
    skipKeywordCheck: noText,
    locationPending: !job.description && locationNeedsDetail(job.url),
  });
  if (reason) {
    check((await supabase.from("matches").update({ status: "filtered", filter_reason: reason, ...RESET_SCORE }).eq("job_id", jobId)).error);
    revalidatePath("/", "layout");
    return { tone: "ok", message: `No longer passes your filters (${reason}), so it left the Inbox.` };
  }

  // 2. A fresh score, with the same prompt and model as the worker.
  type FbRow = { decision: "approve" | "skip"; reasons: string[]; note: string | null; jobs: { title: string; company: string } | { title: string; company: string }[] | null };
  const feedback: FeedbackExample[] = ((fb ?? []) as FbRow[]).flatMap((r) => {
    const j = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
    return j ? [{ title: j.title, company: j.company, decision: r.decision, reasons: r.reasons, note: r.note }] : [];
  });
  const model = resolveModel(st?.scoring_model);
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { score: s, model: answeredBy, usage } = await scoreJob(new Anthropic(), model, buildSystemPrompt(profile, criteria, feedback), job as unknown as FetchedJob);
    const cost = costUsd(answeredBy, usage);
    await recordAiUsage(supabase, { kind: "rescore", model: answeredBy, usage, costUsd: cost, detail: `${job.title} @ ${job.company}` });
    check(
      (
        await supabase
          .from("matches")
          .update({
            status: "scored",
            filter_reason: null,
            score: s.score,
            score_checks: s.checks,
            score_summary: s.summary,
            score_pros: s.pros.slice(0, 6),
            score_cons: s.cons.slice(0, 6),
            scored_at: new Date().toISOString(),
          })
          .eq("job_id", jobId)
      ).error,
    );
    revalidatePath("/", "layout");
    return { tone: "ok", message: `Re-scored: ${s.score}.` };
  } catch (e) {
    return bad(`Re-scoring failed: ${e instanceof Error ? e.message : e}`);
  }
}

// --- CV and cover letter drafts ---------------------------------------------------------

export type DraftResult = { tone: "ok" | "bad"; message: string; at: number } | null;

type DraftContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof db>>;
      profile: Profile;
      career: NonNullable<ReturnType<typeof withDefaults>>;
      job: DraftJob;
      model: (typeof SCORING_MODELS)[number]["id"];
      client: import("@anthropic-ai/sdk").default;
    };

/** Everything a draft needs: the profile and career, the job, the writing model. Or why it can't run. */
async function draftContext(jobId: string): Promise<DraftContext> {
  if (!process.env.ANTHROPIC_API_KEY) return { error: "The app has no Anthropic API key (ANTHROPIC_API_KEY) yet." };
  const supabase = await db();
  const me = await currentUser(supabase);
  // Members spend from the balance the admin gave them; the admin draws on the account.
  if (!me.isAdmin) {
    const { data: bal } = await supabase.from("member_balances").select("balance_usd").eq("user_id", me.id).maybeSingle();
    if (Number(bal?.balance_usd ?? 0) <= 0) return { error: "Your AI balance is used up. Ask the admin for more credit." };
  }
  const [{ data: profile }, { data: job }, { data: st }] = await Promise.all([
    supabase.from("profile").select("*").eq("user_id", me.id).single(),
    supabase.from("my_jobs").select("id, title, company, location, description, status, score_summary, score_checks").eq("id", jobId).single(),
    supabase.from("settings").select("writing_model").single(),
  ]);
  if (!job || !PIPELINE_STATUSES.includes(job.status as JobStatus)) return { error: "Drafts are made for jobs in your Pipeline." };
  const career = withDefaults((profile as Profile | null)?.career);
  if (!profile || !career || !career.experiences.length) return { error: "Fill in your career on the Profile page first: drafts are built from it." };
  const checks = (job.score_checks ?? []) as { key: string; rating: number; max?: number; note: string }[];
  const draftJob: DraftJob = {
    title: job.title,
    company: job.company,
    location: job.location ?? "",
    description: job.description ?? "",
    scoreNotes: [job.score_summary, ...checks.map((c) => `${c.key} ${c.rating}/${c.max ?? 10}: ${c.note}`)].filter(Boolean).join("\n"),
  };
  const model = SCORING_MODELS.find((m) => m.id === st?.writing_model)?.id ?? DEFAULT_SCORING_MODEL;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return { supabase, profile: profile as Profile, career, job: draftJob, model, client: new Anthropic() };
}

/** The job's drafts (Pipeline → opened row), loaded when the row opens. */
export async function getDrafts(jobId: string): Promise<DraftRow[]> {
  const supabase = await db();
  const { data } = await supabase
    .from("drafts")
    .select("id, job_id, kind, language, content, answers, model, cost_usd, updated_at")
    .eq("job_id", jobId);
  return (data ?? []) as DraftRow[];
}

const upsertDraft = async (supabase: Awaited<ReturnType<typeof db>>, row: Record<string, unknown>) =>
  check((await supabase.from("drafts").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id,job_id,kind" })).error);

/** Writes (or rewrites) the tailored CV for a Pipeline job. */
export async function draftCv(jobId: string): Promise<DraftResult> {
  const at = Date.now();
  const ctx = await draftContext(jobId);
  if ("error" in ctx) return { tone: "bad", message: ctx.error, at };
  try {
    const r = await generateCv(ctx.client, ctx.model, ctx.career, ctx.profile, ctx.job);
    // Logged first, so the spend is on record even if saving fails.
    await recordAiUsage(ctx.supabase, { kind: "cv_draft", model: r.model, usage: r.usage, costUsd: r.costUsd, detail: `${ctx.job.title} @ ${ctx.job.company}` });
    await upsertDraft(ctx.supabase, { job_id: jobId, kind: "cv", language: ctx.profile.draft_language, content: r.draft, model: r.model, cost_usd: r.costUsd });
    revalidatePath("/report");
    return { tone: "ok", message: "CV drafted.", at };
  } catch (e) {
    return { tone: "bad", message: `Drafting the CV failed: ${e instanceof Error ? e.message : e}`, at };
  }
}

/**
 * Starts or rewrites a cover letter. With questions on (Profile → Drafts) and none asked
 * yet for this job, it only asks them (saved on the draft); the panel then shows them.
 * Otherwise it writes the letter with the given answers, or the saved ones.
 */
export async function draftLetter(jobId: string, answers?: LetterQA[]): Promise<DraftResult> {
  const at = Date.now();
  const ctx = await draftContext(jobId);
  if ("error" in ctx) return { tone: "bad", message: ctx.error, at };
  const { data: existing } = await ctx.supabase.from("drafts").select("answers").eq("job_id", jobId).eq("kind", "cover_letter").maybeSingle();
  const saved = (existing?.answers ?? null) as LetterQA[] | null;
  try {
    if (!answers && ctx.profile.letter_questions && !saved) {
      // A short call: Haiku is plenty for picking 1-2 questions.
      const q = await letterQuestions(ctx.client, DEFAULT_SCORING_MODEL, ctx.career, ctx.job);
      await recordAiUsage(ctx.supabase, { kind: "letter_questions", model: q.model, usage: q.usage, costUsd: q.costUsd, detail: `${ctx.job.title} @ ${ctx.job.company}` });
      await upsertDraft(ctx.supabase, {
        job_id: jobId,
        kind: "cover_letter",
        language: ctx.profile.draft_language,
        answers: q.draft.map((question) => ({ question, answer: "" })),
      });
      return { tone: "ok", message: "", at };
    }
    const qa = (answers ?? saved ?? []).map((a) => ({ question: String(a.question).slice(0, 300), answer: String(a.answer).slice(0, 2000) }));
    const r = await generateLetter(ctx.client, ctx.model, ctx.career, ctx.profile, ctx.job, qa);
    await recordAiUsage(ctx.supabase, { kind: "cover_letter", model: r.model, usage: r.usage, costUsd: r.costUsd, detail: `${ctx.job.title} @ ${ctx.job.company}` });
    await upsertDraft(ctx.supabase, {
      job_id: jobId,
      kind: "cover_letter",
      language: ctx.profile.draft_language,
      content: r.draft,
      answers: qa.length ? qa : saved,
      model: r.model,
      cost_usd: r.costUsd,
    });
    revalidatePath("/report");
    return { tone: "ok", message: "Cover letter written.", at };
  } catch (e) {
    return { tone: "bad", message: `Writing the cover letter failed: ${e instanceof Error ? e.message : e}`, at };
  }
}

/** Saves edits to a draft (the editor sends the whole content back). */
export async function saveDraft(id: string, content: CvDraft | LetterDraft): Promise<void> {
  const supabase = await db();
  check((await supabase.from("drafts").update({ content, updated_at: new Date().toISOString() }).eq("id", id)).error);
}
