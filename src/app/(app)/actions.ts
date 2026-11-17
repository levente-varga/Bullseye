"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ATS_INFO, DEFAULT_SCORING_MODEL, SCORING_MODELS, type Ats, type JobStatus } from "@/lib/types";

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
  check((await supabase.from("jobs").update({ status: "approved" }).eq("id", id)).error);
  check((await supabase.from("feedback").insert({ job_id: id, decision: "approve", note: str(form, "note") || null })).error);
  revalidatePath("/");
}

export async function skipJob(form: FormData) {
  const supabase = await db();
  const id = str(form, "id");
  const reasons = form.getAll("reasons").map(String);
  const other = str(form, "other");
  if (other) reasons.push(other);
  check((await supabase.from("jobs").update({ status: "skipped" }).eq("id", id)).error);
  check((await supabase.from("feedback").insert({ job_id: id, decision: "skip", reasons, note: str(form, "note") || null })).error);
  revalidatePath("/");
}

export async function setStatus(form: FormData) {
  const supabase = await db();
  const status = str(form, "status") as JobStatus;
  check((await supabase.from("jobs").update({ status }).eq("id", str(form, "id"))).error);
  revalidatePath("/pipeline");
}

export async function markFollowedUp(form: FormData) {
  const supabase = await db();
  check(
    (await supabase.from("jobs").update({ followed_up_at: new Date().toISOString() }).eq("id", str(form, "id"))).error,
  );
  revalidatePath("/pipeline");
}

// --- Criteria ---------------------------------------------------------------

export async function saveCriteria(form: FormData) {
  const supabase = await db();
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
          scoring_model: SCORING_MODELS.some((m) => m.id === str(form, "scoring_model"))
            ? str(form, "scoring_model")
            : DEFAULT_SCORING_MODEL,
          score_threshold: Math.min(100, Math.max(0, Number(str(form, "score_threshold")) || 60)),
          followup_days: Math.max(1, Number(str(form, "followup_days")) || 10),
          digest_email: str(form, "digest_email"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1)
    ).error,
  );
  revalidatePath("/criteria");
}

export async function addExcludeKeyword(form: FormData) {
  const supabase = await db();
  const kw = str(form, "keyword");
  if (!kw) return;
  const { data, error } = await supabase.from("criteria").select("exclude_keywords").eq("id", 1).single();
  check(error);
  const next = [...new Set([...(data!.exclude_keywords as string[]), kw])];
  check((await supabase.from("criteria").update({ exclude_keywords: next }).eq("id", 1)).error);
  revalidatePath("/criteria");
}

// --- Sources ----------------------------------------------------------------

/** Turns what the user typed (a URL or a bare value) into the slug each source type expects. */
function normalizeSlug(ats: Ats, input: string): string {
  const raw = input.trim();
  if (ats === "swedengamejobs") return "swedengamejobs.com";
  if (ats === "teamtailor") {
    // The career site's host, e.g. career.paradoxplaza.com
    return raw.replace(/^https?:\/\//, "").split(/[/?#]/)[0].toLowerCase();
  }
  // Board slug: the first path segment of a board URL, or the bare value.
  const value = raw.replace(/^https?:\/\/[^/]+\//, "").split(/[/?#]/)[0];
  // SmartRecruiters company identifiers keep their case (e.g. Ubisoft2).
  return ats === "smartrecruiters" ? value : value.toLowerCase();
}

export async function addSource(form: FormData) {
  const supabase = await db();
  const ats = str(form, "ats") as Ats;
  if (!(ats in ATS_INFO)) return;
  const slug = normalizeSlug(ats, str(form, "slug"));
  if (!slug) return;
  const fallbackName = ats === "swedengamejobs" ? "Sweden Game Jobs" : slug;
  check(
    (
      await supabase.from("sources").insert({
        ats,
        slug,
        company_name: str(form, "company_name") || fallbackName,
        country: str(form, "country").toLowerCase() || null,
        watchlist: form.get("watchlist") === "on",
      })
    ).error,
  );
  revalidatePath("/sources");
}

export async function acceptSuggestion(form: FormData) {
  const supabase = await db();
  const id = str(form, "id");
  const { data: s, error } = await supabase.from("source_suggestions").select("*").eq("id", id).single();
  check(error);
  if (!s || !(s.ats in ATS_INFO)) return;
  const insert = await supabase
    .from("sources")
    .insert({ ats: s.ats, slug: s.slug, company_name: s.company_name, watchlist: false });
  // Already a source (unique ats+slug): still mark the suggestion handled.
  if (insert.error && insert.error.code !== "23505") throw new Error(insert.error.message);
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
    (await supabase.from("sources").update({ [field]: str(form, "value") === "true" }).eq("id", str(form, "id"))).error,
  );
  revalidatePath("/sources");
}

export async function deleteSource(form: FormData) {
  const supabase = await db();
  check((await supabase.from("sources").delete().eq("id", str(form, "id"))).error);
  revalidatePath("/sources");
}

// --- Profile + answer bank --------------------------------------------------

export async function saveProfile(form: FormData) {
  const supabase = await db();
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
          links: list(form, "links"),
          cv_text: str(form, "cv_text"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1)
    ).error,
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

/** Records the balance the Anthropic Console shows (after a top-up, or as a correction). */
export async function addCreditEntry(form: FormData) {
  const supabase = await db();
  const balance = Number(str(form, "balance").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(balance) || balance < 0) return;
  // A past date is stored at midday UTC; today means "now", so it sorts after today's runs.
  const date = str(form, "date");
  const today = new Date().toISOString().slice(0, 10);
  const enteredAt = !date || date >= today ? new Date().toISOString() : `${date}T12:00:00Z`;
  check(
    (await supabase.from("credit_entries").insert({ balance_usd: balance, entered_at: enteredAt, note: str(form, "note") || null }))
      .error,
  );
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
