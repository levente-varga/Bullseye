/**
 * Bullseye worker. Runs in GitHub Actions (or locally with `npm run worker -- <mode>`).
 *
 *   tick       every 15 minutes: run whatever the schedule (Criteria page) says is due
 *   watchlist  poll watchlist companies only; email an alert for strong new matches
 *   full       poll every enabled source; score new listings
 *   score      describe and score jobs already waiting (after a re-evaluation); no fetching
 *   digest     send the daily email: new matches, follow-ups due, status changes
 */
import "./env";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBoard, probeHost, workdayFromUrl } from "../src/lib/ats";
import { dedupeKey, detectAts } from "../src/lib/dedupe";
import { describe, PostingClosedError, THIN_THRESHOLD } from "../src/lib/describe";
import { hardFilter } from "../src/lib/filters";
import { costUsd } from "../src/lib/pricing";
import { dueNow } from "../src/lib/schedule";
import { buildSystemPrompt, resolveModel, scoreJob, type FeedbackExample } from "../src/lib/scoring";
import { renderDigest, renderWatchlistAlert, sendEmail } from "../src/lib/email";
import { ATS_INFO, type Criteria, type FetchedJob, type Job, type Profile, type Source } from "../src/lib/types";

/**
 * watchlist / full: fetch sources, then describe and score what's new.
 * score: no fetching; describe and score jobs waiting from earlier (re-evaluation, overflow).
 * digest: the daily email.
 */
type Mode = "watchlist" | "full" | "score" | "digest";

const MAX_SCORE_PER_RUN = Number(process.env.MAX_SCORE_PER_RUN || 60);
const SCORE_CONCURRENCY = 4;
const DESCRIBE_CONCURRENCY = 4;
const OPEN_STATUSES = ["new", "filtered", "scored"];

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const db: SupabaseClient = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

/** Supabase caps selects at 1000 rows; page through. */
type Result = PromiseLike<{ data: unknown; error: unknown }>;

async function selectAll<T>(build: (from: number, to: number) => Result): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** Awaits a Supabase query, throws on error, returns its data. */
async function must<T = unknown>(p: Result): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

async function loadContext() {
  const criteria = await must<Criteria>(db.from("criteria").select("*").eq("id", 1).single());
  const profile = await must<Profile>(db.from("profile").select("*").eq("id", 1).single());
  const rows = await must<
    { decision: "approve" | "skip"; reasons: string[]; note: string | null; jobs: { title: string; company: string } | null }[]
  >(
    db
      .from("feedback")
      .select("decision, reasons, note, jobs(title, company)")
      .order("created_at", { ascending: false })
      .limit(40),
  );
  const feedback: FeedbackExample[] = rows
    .filter((r) => r.jobs)
    .map((r) => ({ ...r.jobs!, decision: r.decision, reasons: r.reasons, note: r.note }));
  return { criteria, profile, feedback };
}

// ---------------------------------------------------------------------------
// Fetch + filter
// ---------------------------------------------------------------------------

/** Runs `fn` over `items` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

type Existing = { id: string; source_id: string; dedupe_key: string; status: string; thin: boolean };

/** Jobs from any source sharing one of these dedupe keys. */
/**
 * Keys travel in the request URL, which the API caps at ~16 KB. Batches are sized
 * by length, not count: URL-based keys (aggregators like JobTech) can be 100+ chars.
 */
const KEY_BATCH_CHARS = 6000;

async function findByKeys(keys: string[]): Promise<Map<string, Existing>> {
  const out = new Map<string, Existing>();
  const batches: string[][] = [[]];
  let size = 0;
  for (const k of keys) {
    const cost = encodeURIComponent(k).length + 3; // quotes and comma
    if (size + cost > KEY_BATCH_CHARS && batches.at(-1)!.length) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1)!.push(k);
    size += cost;
  }
  for (const batch of batches.filter((b) => b.length)) {
    const rows = await must<Existing[]>(
      db.from("jobs").select("id, source_id, dedupe_key, status, thin").in("dedupe_key", batch),
    );
    for (const r of rows) out.set(r.dedupe_key, r);
  }
  return out;
}

/**
 * Fetches one source and stores what's new. Direct sources (company ATSes)
 * run before aggregators: an aggregator only adds postings no other source
 * has, and a direct source "adopts" a posting an aggregator found first, so
 * your decisions on it are kept and it gets the full description.
 */
async function syncSource(source: Source, criteria: Criteria, aggregatorIds: Set<string>) {
  const stats = { fetched: 0, inserted: 0, filtered: 0, closed: 0, duplicates: 0, adopted: 0, described: 0, stale: 0 };
  const isAggregator = Boolean(ATS_INFO[source.ats]?.aggregator);
  let fetched: (FetchedJob & { dedupe_key: string })[];
  try {
    fetched = (await fetchBoard(source)).map((j) => ({ ...j, dedupe_key: dedupeKey(j.url) }));
    // A company board can really have no openings, but an aggregator going from some
    // listings to none almost always means its site changed and the adapter reads nothing.
    if (isAggregator && fetched.length === 0 && (source.last_job_count ?? 0) > 0) {
      throw new Error(
        `Returned no listings (${source.last_job_count} last time). The site has probably changed and Bullseye can't read it anymore.`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("sources").update({ last_error: msg, last_checked_at: new Date().toISOString() }).eq("id", source.id);
    console.error(`[${source.company_name}] fetch failed: ${msg}`);
    return { ...stats, errors: 1 };
  }
  stats.fetched = fetched.length;

  const existing = await selectAll<{ id: string; external_id: string; status: string }>((a, b) =>
    db.from("jobs").select("id, external_id, status").eq("source_id", source.id).range(a, b),
  );
  const known = new Set(existing.map((j) => j.external_id));
  const live = new Set(fetched.map((j) => j.external_id));

  // An aggregator skips companies you follow directly: their own board is the source of
  // truth, and aggregator entries missing from it are usually already-closed postings.
  const direct = new Set<string>();
  if (isAggregator) {
    const rows = await must<{ ats: string; slug: string }[]>(db.from("sources").select("ats, slug").eq("enabled", true));
    rows.forEach((r) => direct.add(`${r.ats}:${r.slug.toLowerCase()}`));
  }
  const coveredByDirect = (url: string) => {
    const d = detectAts(url);
    const slug = d.slug.toLowerCase();
    // A custom career domain could be either; a source on that host covers it.
    if (d.ats === "probe?") return direct.has(`teamtailor:${slug}`) || direct.has(`recruitee:${slug}`);
    return direct.has(`${d.ats}:${slug}`);
  };

  // New to this source, and unique within this fetch.
  const seenKeys = new Set<string>();
  const fresh = fetched.filter((j) => {
    if (known.has(j.external_id) || seenKeys.has(j.dedupe_key)) return false;
    if (isAggregator && coveredByDirect(j.url)) {
      stats.duplicates++;
      return false;
    }
    seenKeys.add(j.dedupe_key);
    return true;
  });

  // Cross-source duplicates.
  const matches = await findByKeys(fresh.map((j) => j.dedupe_key));
  const candidates: typeof fresh = [];
  for (const j of fresh) {
    const m = matches.get(j.dedupe_key);
    if (!m) {
      candidates.push(j);
    } else if (!isAggregator && aggregatorIds.has(m.source_id)) {
      // Adopt: move the aggregator's row to this direct source with full data.
      const rescore = m.thin && m.status === "scored";
      await must(
        db
          .from("jobs")
          .update({
            source_id: source.id,
            external_id: j.external_id,
            url: j.url,
            title: j.title,
            location: j.location,
            remote: j.remote,
            description: j.description,
            compensation: j.compensation,
            thin: false,
            ...(rescore ? { status: "new", score: null } : {}),
          })
          .eq("id", m.id),
      );
      stats.adopted++;
    } else {
      stats.duplicates++;
    }
  }

  // Filter on title/location first, fetch descriptions only for survivors, then filter fully.
  // Every row sets the same columns: a bulk upsert sends missing ones as null, which `thin` rejects.
  const rows: Record<string, unknown>[] = [];
  const needDescription: (typeof candidates)[number][] = [];
  for (const j of candidates) {
    // Workday lists lack countries ("Best", "3 Locations"): judge the location after the detail fetch.
    const reason = hardFilter(j, criteria, {
      skipKeywordCheck: !j.description,
      locationPending: !j.description && workdayFromUrl(j.url) !== null,
    });
    if (reason) {
      stats.filtered++;
      rows.push({ ...j, source_id: source.id, thin: false, status: "filtered", filter_reason: reason });
    } else if (!j.description) {
      needDescription.push(j);
    } else {
      rows.push({ ...j, source_id: source.id, thin: false, status: "new", filter_reason: null });
    }
  }
  await pool(needDescription, DESCRIBE_CONCURRENCY, async (j) => {
    try {
      const found = await describe(source, j);
      j.description = found.text;
      if (found.location) j.location = found.location;
      stats.described++;
    } catch (e) {
      if (e instanceof PostingClosedError) {
        stats.stale++; // listed by the source, but the posting itself is gone: don't store it
        return;
      }
      console.warn(`  no description for ${j.title} @ ${j.company}: ${e instanceof Error ? e.message : e}`);
    }
    const thin = j.description.length < THIN_THRESHOLD;
    const reason = thin ? null : hardFilter(j, criteria);
    if (reason) stats.filtered++;
    rows.push({ ...j, source_id: source.id, thin, status: reason ? "filtered" : "new", filter_reason: reason });
  });

  for (let i = 0; i < rows.length; i += 500) {
    await must(
      db.from("jobs").upsert(rows.slice(i, i + 500), { onConflict: "source_id,external_id", ignoreDuplicates: true }),
    );
  }
  stats.inserted = rows.length;

  // Postings that vanished before you acted on them get closed. Not for partial feeds
  // (JobTech shows the last week only): there, dropping out of the window isn't closing.
  const gone = ATS_INFO[source.ats]?.partial
    ? []
    : existing.filter((j) => !live.has(j.external_id) && OPEN_STATUSES.includes(j.status));
  for (let i = 0; i < gone.length; i += 200) {
    await must(db.from("jobs").update({ status: "closed" }).in("id", gone.slice(i, i + 200).map((j) => j.id)));
  }
  stats.closed = gone.length;

  if (ATS_INFO[source.ats]?.suggests) await discoverSources(fetched);

  await db
    .from("sources")
    .update({ last_error: null, last_checked_at: new Date().toISOString(), last_job_count: fetched.length })
    .eq("id", source.id);
  console.log(
    `[${source.company_name}] ${stats.fetched} live, ${stats.inserted} new (${stats.filtered} filtered, ` +
      `${stats.described} described), ${stats.duplicates} duplicates, ${stats.adopted} adopted, ` +
      `${stats.stale} stale skipped, ${stats.closed} closed`,
  );
  return { ...stats, errors: 0 };
}

/** From aggregator listings, suggest companies that could be added as direct sources. */
async function discoverSources(jobs: FetchedJob[]) {
  const sources = await must<{ ats: string; slug: string }[]>(db.from("sources").select("ats, slug"));
  const have = new Set(sources.map((s) => `${s.ats}:${s.slug.toLowerCase()}`));
  const known = await must<{ ats: string; slug: string }[]>(db.from("source_suggestions").select("ats, slug"));
  const suggested = new Map(known.map((s) => [s.slug.toLowerCase(), s.ats]));

  const groups = new Map<string, { ats: string; slug: string; company_name: string; job_count: number }>();
  for (const j of jobs) {
    const d = detectAts(j.url);
    const key = `${d.ats}:${d.slug.toLowerCase()}`;
    const g = groups.get(key) ?? { ats: d.ats, slug: d.slug, company_name: j.company, job_count: 0 };
    g.job_count++;
    groups.set(key, g);
  }

  const rows = [];
  for (const g of groups.values()) {
    if (g.ats === "probe?") {
      // A custom career domain: Teamtailor, Recruitee, or neither. Checked once per host;
      // afterwards the stored suggestion remembers the answer.
      const prev = suggested.get(g.slug.toLowerCase());
      g.ats = prev ?? (await probeHost(g.slug)) ?? "custom";
    }
    if (have.has(`${g.ats}:${g.slug.toLowerCase()}`)) continue;
    rows.push({ ...g, last_seen_at: new Date().toISOString() });
  }
  // Two "probe?" groups can resolve to the same row; the upsert needs unique keys.
  const unique = [...new Map(rows.map((r) => [`${r.ats}:${r.slug.toLowerCase()}`, r])).values()];
  if (unique.length) await must(db.from("source_suggestions").upsert(unique, { onConflict: "ats,slug" }));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Fetches descriptions for waiting jobs that never got one: jobs a re-evaluation
 * moved back from "filtered", which were filtered before their description was
 * fetched. Then applies the full filter again (keywords, real Workday location).
 */
async function describePending(sources: Source[], criteria: Criteria) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const pending = await must<Job[]>(
    db
      .from("jobs")
      .select("*")
      .eq("status", "new")
      .eq("description", "")
      .eq("thin", false)
      .in("source_id", [...byId.keys()])
      .limit(MAX_SCORE_PER_RUN * 2),
  );
  let described = 0;
  let filtered = 0;
  await pool(pending, DESCRIBE_CONCURRENCY, async (job) => {
    const source = byId.get(job.source_id)!;
    let found: { text: string; location?: string } = { text: "" };
    try {
      found = await describe(source, job);
      described++;
    } catch (e) {
      if (e instanceof PostingClosedError) {
        await must(db.from("jobs").update({ status: "closed" }).eq("id", job.id));
        return;
      }
      console.warn(`  no description for ${job.title} @ ${job.company}: ${e instanceof Error ? e.message : e}`);
    }
    const updated = { ...job, description: found.text, location: found.location ?? job.location };
    const thin = updated.description.length < THIN_THRESHOLD;
    const reason = thin ? null : hardFilter(updated, criteria);
    if (reason) filtered++;
    await must(
      db
        .from("jobs")
        .update({
          description: updated.description,
          location: updated.location,
          thin,
          ...(reason ? { status: "filtered", filter_reason: reason } : {}),
        })
        .eq("id", job.id),
    );
  });
  return pending.length ? { described_later: described, filtered_later: filtered } : {};
}

async function scorePending(sourceIds: string[], ctx: Awaited<ReturnType<typeof loadContext>>) {
  const pending = await must<Job[]>(
    db
      .from("jobs")
      .select("*")
      .eq("status", "new")
      .in("source_id", sourceIds)
      .order("first_seen_at", { ascending: false })
      .limit(MAX_SCORE_PER_RUN),
  );
  // Always report a cost, even $0, so the Report never shows a run as "unknown".
  if (!pending.length) return { scored: 0, score_errors: 0, cost_usd: 0, tokens_in: 0, tokens_out: 0 };

  const client = new Anthropic();
  const system = buildSystemPrompt(ctx.profile, ctx.criteria, ctx.feedback);
  const model = resolveModel(ctx.criteria.scoring_model);
  console.log(`Scoring ${pending.length} listings with ${model}`);
  let scored = 0;
  let errors = 0;
  const spend = { cost: 0, tokensIn: 0, tokensOut: 0 };

  const queue = [...pending];
  await Promise.all(
    Array.from({ length: SCORE_CONCURRENCY }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          const { score: s, model: answeredBy, usage } = await scoreJob(client, model, system, job);
          spend.cost += costUsd(answeredBy, usage);
          spend.tokensIn += usage.input + usage.cacheWrite + usage.cacheRead;
          spend.tokensOut += usage.output;
          await must(
            db
              .from("jobs")
              .update({
                status: "scored",
                score: s.score,
                score_summary: s.summary,
                score_pros: s.pros.slice(0, 4),
                score_cons: s.cons.slice(0, 4),
                scored_at: new Date().toISOString(),
              })
              .eq("id", job.id),
          );
          scored++;
          console.log(`  scored ${s.score}: ${job.title} @ ${job.company}`);
        } catch (e) {
          errors++;
          console.error(`  score failed for ${job.title} @ ${job.company}:`, e instanceof Error ? e.message : e);
        }
      }
    }),
  );
  console.log(`Scoring cost $${spend.cost.toFixed(4)} (${spend.tokensIn} tokens in, ${spend.tokensOut} out)`);
  return {
    scored,
    score_errors: errors,
    cost_usd: Math.round(spend.cost * 1e6) / 1e6,
    tokens_in: spend.tokensIn,
    tokens_out: spend.tokensOut,
  };
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function runFetch(mode: "watchlist" | "full") {
  const ctx = await loadContext();
  let q = db.from("sources").select("*").eq("enabled", true);
  if (mode === "watchlist") q = q.eq("watchlist", true);
  const sources = await must<Source[]>(q);
  if (!sources.length) {
    console.log(`No ${mode === "watchlist" ? "watchlist " : ""}sources configured.`);
    return { sources: 0, cost_usd: 0 };
  }

  // Direct sources first, aggregators last (see syncSource). Aggregators are looked up across
  // all sources, so a watchlist run can still adopt rows an aggregator found.
  const all = await must<{ id: string; ats: Source["ats"] }[]>(db.from("sources").select("id, ats"));
  const aggregatorIds = new Set(all.filter((s) => ATS_INFO[s.ats]?.aggregator).map((s) => s.id));
  sources.sort((a, b) => Number(aggregatorIds.has(a.id)) - Number(aggregatorIds.has(b.id)));

  const totals: Record<string, number> = { sources: sources.length };
  for (const s of sources) {
    // One broken source must not stop the others (or the scoring after them).
    let st: Record<string, number>;
    try {
      st = await syncSource(s, ctx.criteria, aggregatorIds);
    } catch (e) {
      const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
      await db.from("sources").update({ last_error: msg, last_checked_at: new Date().toISOString() }).eq("id", s.id);
      console.error(`[${s.company_name}] failed: ${msg}`);
      st = { errors: 1 };
    }
    for (const [k, v] of Object.entries(st)) totals[k] = (totals[k] ?? 0) + v;
  }
  Object.assign(totals, await describePending(sources, ctx.criteria));
  Object.assign(totals, await scorePending(sources.map((s) => s.id), ctx));

  if (mode === "watchlist") {
    const strong = await must<Job[]>(
      db
        .from("jobs")
        .select("*")
        .eq("status", "scored")
        .gte("score", ctx.criteria.score_threshold)
        .is("notified_at", null)
        .in("source_id", sources.map((s) => s.id))
        .order("score", { ascending: false }),
    );
    if (strong.length) {
      const { subject, html } = renderWatchlistAlert(strong);
      await sendEmail(subject, html, ctx.criteria.digest_email);
      await must(db.from("jobs").update({ notified_at: new Date().toISOString() }).in("id", strong.map((j) => j.id)));
    }
    totals.alerted = strong.length;
  }
  return totals;
}

/** Describes and scores jobs already waiting, across all sources, without fetching anything. */
async function runScore() {
  const ctx = await loadContext();
  const sources = await must<Source[]>(db.from("sources").select("*"));
  return {
    ...(await describePending(sources, ctx.criteria)),
    ...(await scorePending(sources.map((s) => s.id), ctx)),
  };
}

async function runDigest() {
  const { criteria } = await loadContext();
  const now = Date.now();
  const followCutoff = new Date(now - criteria.followup_days * 86_400_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString();

  const newMatches = await must<Job[]>(
    db
      .from("jobs")
      .select("*")
      .eq("status", "scored")
      .gte("score", criteria.score_threshold)
      .is("notified_at", null)
      .order("score", { ascending: false })
      .limit(25),
  );
  const applied = await must<Job[]>(db.from("jobs").select("*").eq("status", "applied"));
  const followUps = applied.filter((j) => (j.followed_up_at ?? j.applied_at ?? j.status_changed_at) < followCutoff);
  const statusChanges = await must<Job[]>(
    db
      .from("jobs")
      .select("*")
      .in("status", ["applied", "interview", "offer", "rejected"])
      .gte("status_changed_at", dayAgo)
      .order("status_changed_at", { ascending: false }),
  );

  // cost_usd: the digest makes no Claude calls.
  const stats = { new_matches: newMatches.length, follow_ups: followUps.length, status_changes: statusChanges.length, emailed: 0, cost_usd: 0 };
  if (newMatches.length || followUps.length || statusChanges.length) {
    const { subject, html } = renderDigest({ newMatches, followUps, statusChanges });
    await sendEmail(subject, html, criteria.digest_email);
    stats.emailed = 1;
    if (newMatches.length) {
      await must(db.from("jobs").update({ notified_at: new Date().toISOString() }).in("id", newMatches.map((j) => j.id)));
    }
  } else {
    console.log("Nothing to report; no email sent.");
  }
  return stats;
}

/** Runs one mode and logs it in the runs table (the Report's run log). */
async function record(mode: Mode) {
  const run = await must<{ id: string }>(db.from("runs").insert({ kind: mode }).select("id").single());
  try {
    const stats = mode === "digest" ? await runDigest() : mode === "score" ? await runScore() : await runFetch(mode);
    await db.from("runs").update({ finished_at: new Date().toISOString(), stats }).eq("id", run.id);
    console.log(`${mode} done:`, stats);
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    await db.from("runs").update({ finished_at: new Date().toISOString(), error: msg }).eq("id", run.id);
    throw e;
  }
}

/** When each mode last started (failed runs count too, so a failure isn't retried every tick). */
async function lastStarted(kind: Mode): Promise<number | null> {
  const rows = await must<{ started_at: string }[]>(
    db.from("runs").select("started_at").eq("kind", kind).order("started_at", { ascending: false }).limit(1),
  );
  return rows[0] ? Date.parse(rows[0].started_at) : null;
}

/**
 * Jobs waiting to be scored (after a re-evaluation, or more than one run's cap) are
 * scored at the next quiet tick, 60 at a time. If the last scoring run scored nothing
 * (e.g. the API key stopped working), it waits 6 hours instead of retrying every tick.
 */
async function scoringDue(): Promise<boolean> {
  const { count } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("status", "new");
  if (!count) return false;
  const [last] = await must<{ started_at: string; stats: Record<string, number>; error: string | null }[]>(
    db.from("runs").select("started_at, stats, error").eq("kind", "score").order("started_at", { ascending: false }).limit(1),
  );
  if (!last) return true;
  const stuck = Boolean(last.error) || !(last.stats?.scored > 0);
  return !stuck || Date.now() - Date.parse(last.started_at) > 6 * 3_600_000;
}

/** Called every 15 minutes by GitHub Actions: runs whatever the schedule on the Criteria page says is due. */
async function tick() {
  const criteria = await must<Criteria>(db.from("criteria").select("*").eq("id", 1).single());
  const last = { watchlist: await lastStarted("watchlist"), full: await lastStarted("full") };
  const due = dueNow(criteria, last, Date.now());
  console.log(`Tick (${criteria.timezone}): daily ${due.daily ? "due" : "not due"}, watchlist ${due.watchlist ? "due" : "not due"}`);
  if (due.daily) {
    try {
      await record("full");
    } finally {
      await record("digest"); // the digest goes out even if some sources failed
    }
  } else if (due.watchlist) {
    const { count } = await db.from("sources").select("id", { count: "exact", head: true }).eq("watchlist", true).eq("enabled", true);
    if (count) await record("watchlist");
    else console.log("No watched sources; nothing to check.");
  } else if (await scoringDue()) {
    await record("score");
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "tick") return tick();
  if (!["watchlist", "full", "score", "digest"].includes(mode)) {
    console.error("Usage: worker <tick|watchlist|full|score|digest>");
    process.exit(2);
  }
  await record(mode as Mode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
