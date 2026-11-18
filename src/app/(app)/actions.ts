"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { extractPdfText, MAX_CV_BYTES } from "@/lib/cv";
import { HIMALAYAS_DEFAULT_QUERY, JOBTECH_DEFAULT_QUERY, WWR_DEFAULT_CATEGORY, workdayFromUrl } from "@/lib/ats";
import { detectAts } from "@/lib/dedupe";
import { detectSource } from "@/lib/detect-source";
import { hardFilter } from "@/lib/filters";
import { createClient, currentUser } from "@/lib/supabase/server";
import {
  ATS_INFO,
  DEFAULT_SCORING_MODEL,
  SCORING_MODELS,
  WATCH_INTERVALS,
  type Ats,
  type Criteria,
  type FetchedJob,
  type JobDetails,
  type JobStatus,
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
  const { data } = await supabase.from("my_jobs").select("url, score_summary, score_pros, score_cons").eq("id", id).single();
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
          max_total_daily_cost_usd: money(str(form, "max_total_daily_cost_usd"), 3),
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
          max_run_cost_usd: money(str(form, "max_run_cost_usd"), 0.25),
          max_daily_cost_usd: money(str(form, "max_daily_cost_usd"), 1),
        })
        .eq("user_id", me.id)
    ).error,
  );
  revalidatePath("/criteria");
}

/** Schedule fields from the Criteria form, validated so a bad value can't stop the worker. */
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

const RESET_SCORE = { score: null, score_summary: null, score_pros: null, score_cons: null, scored_at: null };

/**
 * Applies the saved criteria to jobs you haven't acted on (waiting, scored, filtered):
 * - fails the filters now → Filtered (with the new reason)
 * - was filtered, passes now → waiting to be scored (described first if it never was)
 * - with `rescore`: scored jobs that still pass → waiting to be scored again
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
        locationPending: !j.description && workdayFromUrl(j.url) !== null,
      });
      if (reason) {
        // Still filtered with a different reason: the reason is updated, but it isn't a move.
        if (j.status !== "filtered" || j.filter_reason !== reason) toFiltered.set(reason, [...(toFiltered.get(reason) ?? []), j.id]);
        if (j.status === "filtered") kept++;
        else moved++;
      } else if (j.status === "filtered" || (rescore && j.status === "scored")) {
        toWaiting.push(j.id);
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

  revalidatePath("/", "layout");
  const summary = new URLSearchParams({ filtered: String(moved), waiting: String(toWaiting.length), kept: String(kept) });
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

/** A dollar amount from a form field: non-negative, two decimals; the fallback when empty or invalid. */
function money(raw: string, fallback: number): number {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback;
}

// --- Sources ----------------------------------------------------------------

/** Turns what the user typed (a URL or a bare value) into the slug each source type expects. */
function normalizeSlug(ats: Ats, input: string): string {
  const raw = input.trim();
  const fixed = ATS_INFO[ats].fixedSlug;
  if (fixed) return fixed;
  // JobTech and Himalayas: search parameters (bare, or from a URL); empty means the default search.
  if (ats === "jobtech") return raw.replace(/^.*\?/, "").trim() || JOBTECH_DEFAULT_QUERY;
  if (ats === "himalayas") return raw.replace(/^.*\?/, "").trim() || HIMALAYAS_DEFAULT_QUERY;
  // We Work Remotely: a category (bare, or from a category URL or feed), or "all".
  if (ats === "weworkremotely") {
    const m = raw.match(/categories\/([a-z0-9-]+)/i);
    return (m ? m[1] : raw.replace(/\.rss$/, "")).toLowerCase() || WWR_DEFAULT_CATEGORY;
  }
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

export async function addSource(form: FormData) {
  const supabase = await db();
  const chosen = str(form, "ats");
  const back = (q: Record<string, string>) => redirect(`/sources?${new URLSearchParams(q)}#add`);

  let ats: Ats;
  let slug: string;
  let name = str(form, "company_name");
  let jobCount: number | null = null;

  if (chosen === "auto") {
    const found = await detectSource(str(form, "slug"));
    if ("error" in found) back({ error: found.error });
    else {
      ({ ats, slug } = found);
      name ||= found.companyGuess;
      jobCount = found.jobCount;
    }
  } else {
    if (!(chosen in ATS_INFO)) back({ error: "Pick a source type." });
    ats = chosen as Ats;
    slug = normalizeSlug(ats, str(form, "slug"));
    if (!slug) back({ error: "Enter the board, domain or URL." });
    name ||= ATS_INFO[ats].defaultName ?? slug;
  }

  const { data: sub, error } = await supabase.rpc("subscribe_source", {
    p_ats: ats!,
    p_slug: slug!,
    p_company_name: name,
    p_country: str(form, "country").toLowerCase() || null,
    p_watchlist: form.get("watchlist") === "on",
  });
  check(error);
  if ((sub as { already?: boolean } | null)?.already) back({ error: `${name} is already one of your sources.` });
  revalidatePath("/sources");
  back({
    added: `${name} · ${ATS_INFO[ats!].label}${jobCount !== null ? ` · ${jobCount} open ${jobCount === 1 ? "job" : "jobs"}` : ""}`,
  });
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
  check(
    (await supabase.from("subscriptions").update({ [field]: str(form, "value") === "true" }).eq("source_id", str(form, "id"))).error,
  );
  revalidatePath("/sources");
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

/** "github.com/me" → "https://github.com/me"; empty stays empty. */
const url = (v: string) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v);

export async function saveCvText(form: FormData) {
  const supabase = await db();
  const me = await currentUser(supabase);
  check(
    (await supabase.from("profile").update({ cv_text: str(form, "cv_text"), updated_at: new Date().toISOString() }).eq("user_id", me.id))
      .error,
  );
  revalidatePath("/profile");
}

/** Stores the PDF in the private "cv" bucket and fills cv_text from it. */
export async function uploadCv(form: FormData) {
  const supabase = await db();
  const back = (q: Record<string, string>) => redirect(`/profile?${new URLSearchParams(q)}#cv`);
  const file = form.get("cv");
  if (!(file instanceof File) || file.size === 0) back({ cv_error: "Choose a PDF file first." });
  const pdf = file as File;
  if (pdf.type !== "application/pdf" && !pdf.name.toLowerCase().endsWith(".pdf")) back({ cv_error: "Only PDF files are supported." });
  if (pdf.size > MAX_CV_BYTES) back({ cv_error: "That file is over 5 MB." });

  const bytes = await pdf.arrayBuffer();
  let text = "";
  try {
    text = await extractPdfText(bytes);
  } catch {
    back({ cv_error: "Couldn't read that PDF. Is it password-protected or damaged?" });
  }

  const me = await currentUser(supabase);
  const { data: before } = await supabase.from("profile").select("cv_file_path").single();
  const path = `${me.id}/cv-${Date.now()}.pdf`;
  const up = await supabase.storage.from("cv").upload(path, bytes, { contentType: "application/pdf" });
  if (up.error) back({ cv_error: `Upload failed: ${up.error.message}` });

  check(
    (
      await supabase
        .from("profile")
        .update({
          cv_file_path: path,
          cv_file_name: pdf.name,
          cv_uploaded_at: new Date().toISOString(),
          // Keep the old text if the PDF has no text layer (a scan), so nothing is lost.
          ...(text ? { cv_text: text } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", me.id)
    ).error,
  );
  if (before?.cv_file_path) await supabase.storage.from("cv").remove([before.cv_file_path]);
  revalidatePath("/profile");
  back(text ? { cv: "uploaded" } : { cv: "no_text" });
}

export async function deleteCv() {
  const supabase = await db();
  const me = await currentUser(supabase);
  const { data } = await supabase.from("profile").select("cv_file_path").single();
  if (data?.cv_file_path) await supabase.storage.from("cv").remove([data.cv_file_path]);
  check(
    (await supabase.from("profile").update({ cv_file_path: null, cv_file_name: null, cv_uploaded_at: null }).eq("user_id", me.id)).error,
  );
  revalidatePath("/profile");
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
          max_run_cost_usd: money(str(form, "max_run_cost_usd"), 0.25),
          max_daily_cost_usd: money(str(form, "max_daily_cost_usd"), 1),
        })
        .eq("user_id", str(form, "user_id"))
    ).error,
  );
  revalidatePath("/admin");
}

/** Deletes the member's account and everything personal; needs the confirm box ticked. */
export async function removeMember(form: FormData) {
  const supabase = await db();
  if (form.get("confirm") !== "on") redirect("/admin?error=Tick the box to confirm removing a member.");
  check((await supabase.rpc("remove_member", { p_user: str(form, "user_id") })).error);
  revalidatePath("/admin");
}
