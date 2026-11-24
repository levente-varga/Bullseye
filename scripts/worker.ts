/**
 * Bullseye worker. Runs in GitHub Actions (or locally with `npm run worker -- <mode>`).
 *
 *   tick       every 15 minutes: run whatever the schedule (Settings) says is due
 *   watchlist  poll watched sources only; email alerts for strong new matches
 *   full       poll every followed source; score new listings
 *   score      describe and score listings already waiting (after a re-evaluation); no fetching
 *   digest     send each member's daily email: new matches, follow-ups due, status changes
 *
 * Several people can use one Bullseye. Postings (jobs) and boards (sources) are shared
 * and fetched once; each person has their own matches (status and score for a posting),
 * subscriptions (the sources they follow), criteria, CV and spend caps. A posting
 * reaches someone when a source they follow lists it, filtered by their own criteria.
 */
import "./env";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBoardCounted, isLandingJobsPosting, locationNeedsDetail, probeHost } from "../src/lib/ats";
import { dedupeKey, detectAts } from "../src/lib/dedupe";
import { describe, PostingClosedError, THIN_THRESHOLD } from "../src/lib/describe";
import { hardFilter } from "../src/lib/filters";
import { searchTerms } from "../src/lib/search-terms";
import { costUsd } from "../src/lib/pricing";
import { dueNow } from "../src/lib/schedule";
import { buildSystemPrompt, resolveModel, scoreJob, type FeedbackExample } from "../src/lib/scoring";
import { renderDigest, renderInvite, renderWatchlistAlert, sendEmail } from "../src/lib/email";
import {
  ATS_INFO,
  FETCH_MODES,
  type Criteria,
  type FetchedJob,
  type Job,
  type JobStatus,
  type Member,
  type Profile,
  type Settings,
  type Source,
} from "../src/lib/types";

type Mode = "watchlist" | "full" | "score" | "digest";

const MAX_SCORE_PER_RUN = Number(process.env.MAX_SCORE_PER_RUN || 60);
const SCORE_CONCURRENCY = 4;
const DESCRIBE_CONCURRENCY = 4;
const OPEN_STATUSES: JobStatus[] = ["new", "filtered", "scored"];

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

/** Splits a list into chunks (ids travel in the request URL, which is capped at ~16 KB). */
const chunks = <T>(xs: T[], n = 150): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Runs `fn` over `items` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

interface Subscription {
  user_id: string;
  source_id: string;
  watchlist: boolean;
  enabled: boolean;
}

interface Person {
  id: string;
  email: string;
  isAdmin: boolean;
  runCap: number;
  dayCap: number;
  criteria: Criteria;
  /** Enabled subscriptions only. */
  subs: Subscription[];
}

async function loadSettings(): Promise<Settings> {
  return must<Settings>(db.from("settings").select("*").eq("id", 1).single());
}

async function loadPeople(): Promise<Person[]> {
  const [members, criteria, subs] = await Promise.all([
    must<Member[]>(db.from("members").select("*")),
    must<Criteria[]>(db.from("criteria").select("*")),
    selectAll<Subscription>((a, b) => db.from("subscriptions").select("user_id, source_id, watchlist, enabled").eq("enabled", true).range(a, b)),
  ]);
  const byUser = new Map(criteria.map((c) => [c.user_id, c]));
  return members
    .filter((m) => byUser.has(m.user_id))
    .map((m) => ({
      id: m.user_id,
      email: m.email,
      isAdmin: m.is_admin,
      runCap: Number(m.max_run_cost_usd),
      dayCap: Number(m.max_daily_cost_usd),
      criteria: byUser.get(m.user_id)!,
      subs: subs.filter((s) => s.user_id === m.user_id),
    }));
}

/** The people who follow a source (enabled subscriptions). */
const followers = (people: Person[], sourceId: string) => people.filter((p) => p.subs.some((s) => s.source_id === sourceId));

/**
 * Per-person stats for this run (what was matched, filtered and scored for them, and
 * what it cost), saved to run_users: each person's Report and spend caps read these.
 */
class PerPerson {
  private m = new Map<string, Record<string, number>>();
  add(userId: string, key: string, n = 1) {
    if (!n) return;
    const s = this.m.get(userId) ?? {};
    s[key] = (s[key] ?? 0) + n;
    this.m.set(userId, s);
  }
  set(userId: string, stats: Record<string, number>) {
    const s = this.m.get(userId) ?? {};
    for (const [k, v] of Object.entries(stats)) s[k] = (s[k] ?? 0) + v;
    this.m.set(userId, s);
  }
  entries() {
    return [...this.m.entries()];
  }
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

type Existing = { id: string; source_id: string; dedupe_key: string; thin: boolean };

/**
 * Jobs from any source sharing one of these dedupe keys. Keys travel in the request
 * URL, so batches are sized by length: URL-based keys can be 100+ characters.
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
    const rows = await must<Existing[]>(db.from("jobs").select("id, source_id, dedupe_key, thin").in("dedupe_key", batch));
    for (const r of rows) out.set(r.dedupe_key, r);
  }
  return out;
}

/** What a filter needs to know about a stored posting. */
type JobRow = { id: string; url: string; title: string; location: string; remote: boolean; description: string; thin: boolean; closed_at: string | null };

/** One person's filter verdict on a posting; null passes. Descriptions that aren't in yet skip the keyword check. */
function verdict(job: Pick<JobRow, "url" | "title" | "location" | "remote" | "description" | "thin">, c: Criteria): string | null {
  const noText = !job.description || job.thin;
  return hardFilter(job as unknown as FetchedJob, c, {
    skipKeywordCheck: noText,
    // Workday and Jobylon lists lack countries: judge the location once the detail is in.
    locationPending: !job.description && !job.thin && locationNeedsDetail(job.url),
  });
}

/**
 * Gives each of `people` a match for each posting they don't have one for yet, filtered
 * by their own criteria: "new" (to be described if needed, then scored) or "filtered".
 * Closed postings are skipped.
 */
async function fanOut(jobIds: string[], people: Person[], acc: PerPerson) {
  if (!jobIds.length || !people.length) return;
  const ids = [...new Set(jobIds)];
  const have = new Set<string>();
  for (const part of chunks(ids)) {
    const rows = await must<{ user_id: string; job_id: string }[]>(
      db.from("matches").select("user_id, job_id").in("job_id", part).in("user_id", people.map((p) => p.id)),
    );
    rows.forEach((r) => have.add(`${r.user_id}:${r.job_id}`));
  }
  const needed = ids.filter((id) => people.some((p) => !have.has(`${p.id}:${id}`)));
  if (!needed.length) return;
  const jobs: JobRow[] = [];
  for (const part of chunks(needed)) {
    jobs.push(...(await must<JobRow[]>(db.from("jobs").select("id, url, title, location, remote, description, thin, closed_at").in("id", part))));
  }
  const rows: Record<string, unknown>[] = [];
  for (const p of people) {
    for (const j of jobs) {
      if (j.closed_at || have.has(`${p.id}:${j.id}`)) continue;
      const reason = verdict(j, p.criteria);
      rows.push({ user_id: p.id, job_id: j.id, status: reason ? "filtered" : "new", filter_reason: reason });
      acc.add(p.id, "matched");
      if (reason) acc.add(p.id, "filtered");
    }
  }
  for (const part of chunks(rows, 500)) {
    await must(db.from("matches").upsert(part, { onConflict: "user_id,job_id", ignoreDuplicates: true }));
  }
}

/**
 * Fetches one source, stores postings that are new, and gives its followers matches
 * for what it lists. Direct sources (company ATSes) run before aggregators: an
 * aggregator only adds postings no other source has, and a direct source "adopts" a
 * posting an aggregator found first, so it gets the full description.
 */
async function syncSource(
  source: Source,
  people: Person[],
  aggregatorIds: Set<string>,
  direct: Set<string>,
  acc: PerPerson,
) {
  const stats = { fetched: 0, inserted: 0, closed: 0, duplicates: 0, adopted: 0, described: 0, stale: 0 };
  const subscribers = followers(people, source.id);
  const isAggregator = Boolean(ATS_INFO[source.ats]?.aggregator);
  // A searchable aggregator is searched for its followers' target roles (too big to fetch whole).
  const terms = ATS_INFO[source.ats]?.searchable ? searchTerms(subscribers.map((p) => p.criteria.roles)) : undefined;
  if (terms) console.log(`[${source.company_name}] searching: ${terms.length ? terms.join(", ") : "(no target roles: newest listings)"}`);
  let fetched: (FetchedJob & { dedupe_key: string })[];
  let requests = 0;
  try {
    const result = await fetchBoardCounted(source, terms);
    requests = result.requests;
    fetched = result.jobs.map((j) => ({ ...j, dedupe_key: dedupeKey(j.url) }));
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

  const existing = await selectAll<{ id: string; external_id: string; closed_at: string | null }>((a, b) =>
    db.from("jobs").select("id, external_id, closed_at").eq("source_id", source.id).range(a, b),
  );
  const byExternal = new Map(existing.map((j) => [j.external_id, j]));
  const live = new Set(fetched.map((j) => j.external_id));
  // The postings this source lists right now, as stored jobs: its followers get these.
  const listed = new Set(existing.filter((j) => live.has(j.external_id)).map((j) => j.id));

  // An aggregator skips postings of companies someone follows directly: their own board
  // is the source of truth, and entries missing from it are usually already closed.
  const coveredByDirect = (url: string) => {
    const d = detectAts(url);
    const slug = d.slug.toLowerCase();
    if (d.ats === "probe?") return direct.has(`teamtailor:${slug}`) || direct.has(`recruitee:${slug}`);
    return direct.has(`${d.ats}:${slug}`);
  };

  // New to this source, and unique within this fetch.
  const seenKeys = new Set<string>();
  const unknown = fetched.filter((j) => {
    if (byExternal.has(j.external_id) || seenKeys.has(j.dedupe_key)) return false;
    seenKeys.add(j.dedupe_key);
    return true;
  });

  // Already stored by another source (cross-source duplicates)?
  const elsewhere = await findByKeys(unknown.map((j) => j.dedupe_key));
  const candidates: typeof unknown = [];
  for (const j of unknown) {
    const m = elsewhere.get(j.dedupe_key);
    if (m && !isAggregator && aggregatorIds.has(m.source_id)) {
      // Adopt: move the aggregator's posting to this direct source, with full data.
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
          })
          .eq("id", m.id),
      );
      // Scored on title and location only: score again now that there's a description.
      if (m.thin) {
        await must(
          db.from("matches").update({ status: "new", score: null, score_checks: null, score_summary: null, score_pros: null, score_cons: null, scored_at: null })
            .eq("job_id", m.id).eq("status", "scored"),
        );
      }
      listed.add(m.id);
      stats.adopted++;
    } else if (m) {
      listed.add(m.id);
      stats.duplicates++;
    } else if (isAggregator && coveredByDirect(j.url)) {
      stats.duplicates++;
    } else {
      candidates.push(j);
    }
  }

  // Descriptions are fetched once per posting, and only when it passes someone's title
  // and location filters; each follower's full filter runs when their match is made.
  const passesSomeone = (j: FetchedJob) =>
    subscribers.some((p) => !verdict({ ...j, thin: false }, p.criteria));
  const needDescription = candidates.filter((j) => !j.description && passesSomeone(j));
  const rows = new Map<string, Record<string, unknown>>();
  for (const j of candidates) {
    if (!needDescription.includes(j)) rows.set(j.external_id, { ...j, source_id: source.id, thin: false });
  }
  await pool(needDescription, DESCRIBE_CONCURRENCY, async (j) => {
    try {
      const found = await describe(source, j);
      j.description = found.text;
      if (found.location) j.location = found.location;
      if (found.remote) j.remote = true; // Avature: the work model is on the posting page
      if (found.title) j.title = found.title; // Radancy: the link only has a rough title
      // Magnet.me lists have no company; Landing.jobs' is guessed from the link.
      if (found.company && (!j.company || isLandingJobsPosting(j.url))) j.company = found.company;
      stats.described++;
    } catch (e) {
      if (e instanceof PostingClosedError) {
        stats.stale++; // listed by the source, but the posting itself is gone: don't store it
        return;
      }
      console.warn(`  no description for ${j.title} @ ${j.company}: ${e instanceof Error ? e.message : e}`);
    }
    rows.set(j.external_id, { ...j, source_id: source.id, thin: j.description.length < THIN_THRESHOLD });
  });

  const toInsert = [...rows.values()];
  for (const part of chunks(toInsert, 500)) {
    await must(db.from("jobs").upsert(part, { onConflict: "source_id,external_id", ignoreDuplicates: true }));
  }
  stats.inserted = toInsert.length;
  if (toInsert.length) {
    const ids = await selectAll<{ id: string; external_id: string }>((a, b) =>
      db.from("jobs").select("id, external_id").eq("source_id", source.id).range(a, b),
    );
    for (const r of ids) if (rows.has(r.external_id)) listed.add(r.id);
  }

  // Postings that vanished get closed, and so do matches nobody acted on. Not for
  // partial feeds (they only show recent ads): there, dropping out isn't closing.
  const gone = ATS_INFO[source.ats]?.partial ? [] : existing.filter((j) => !live.has(j.external_id) && !j.closed_at);
  const now = new Date().toISOString();
  for (const part of chunks(gone.map((j) => j.id))) {
    await must(db.from("jobs").update({ closed_at: now }).in("id", part));
    await must(db.from("matches").update({ status: "closed" }).in("job_id", part).in("status", OPEN_STATUSES));
  }
  stats.closed = gone.length;

  await fanOut([...listed], subscribers, acc);

  if (ATS_INFO[source.ats]?.suggests) await discoverSources(fetched, subscribers);

  await db
    .from("sources")
    .update({ last_error: null, last_checked_at: now, last_success_at: now, last_job_count: fetched.length, last_request_count: requests })
    .eq("id", source.id);
  console.log(
    `[${source.company_name}] ${stats.fetched} live, ${stats.inserted} new (${stats.described} described), ` +
      `${stats.duplicates} duplicates, ${stats.adopted} adopted, ${stats.stale} stale skipped, ${stats.closed} closed, ` +
      `${subscribers.length} following, ${requests} requests`,
  );
  return { ...stats, errors: 0 };
}

/** From an aggregator's listings, suggest companies its followers could add as direct sources. */
async function discoverSources(jobs: FetchedJob[], subscribers: Person[]) {
  if (!subscribers.length) return;
  const sources = await must<{ id: string; ats: string; slug: string }[]>(db.from("sources").select("id, ats, slug"));
  const slugOf = new Map(sources.map((s) => [s.id, `${s.ats}:${s.slug.toLowerCase()}`]));
  // Probe results are shared: a host is checked once, whoever it was suggested to.
  const known = await must<{ ats: string; slug: string }[]>(db.from("source_suggestions").select("ats, slug"));
  const probed = new Map(known.map((s) => [s.slug.toLowerCase(), s.ats]));

  const groups = new Map<string, { ats: string; slug: string; company_name: string; job_count: number }>();
  for (const j of jobs) {
    const d = detectAts(j.url);
    const key = `${d.ats}:${d.slug.toLowerCase()}`;
    const g = groups.get(key) ?? { ats: d.ats, slug: d.slug, company_name: j.company, job_count: 0 };
    g.job_count++;
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    if (g.ats === "probe?") {
      // A custom career domain: Teamtailor, Recruitee, or neither.
      g.ats = probed.get(g.slug.toLowerCase()) ?? (await probeHost(g.slug)) ?? "custom";
      probed.set(g.slug.toLowerCase(), g.ats);
    }
  }
  // Two "probe?" groups can resolve to the same key; the upsert needs unique keys.
  const unique = [...new Map([...groups.values()].map((g) => [`${g.ats}:${g.slug.toLowerCase()}`, g])).values()];
  for (const p of subscribers) {
    const followed = new Set(p.subs.map((s) => slugOf.get(s.source_id)));
    const rows = unique
      .filter((g) => !followed.has(`${g.ats}:${g.slug.toLowerCase()}`))
      .map((g) => ({ ...g, user_id: p.id, last_seen_at: new Date().toISOString() }));
    for (const part of chunks(rows, 500)) {
      await must(db.from("source_suggestions").upsert(part, { onConflict: "user_id,ats,slug" }));
    }
  }
}

// ---------------------------------------------------------------------------
// Describe + score
// ---------------------------------------------------------------------------

type MatchWithJob = { id: string; user_id: string; job_id: string; jobs: Job };

/**
 * Fetches descriptions for postings someone is waiting on that never got one: postings
 * filtered for everyone when they arrived (so not described), which a re-evaluation or
 * a new follower then let through. Applies each waiting person's full filter after.
 */
async function describePending(people: Person[], sourceIds: string[] | null, acc: PerPerson): Promise<Record<string, number>> {
  let q = db
    .from("matches")
    .select("id, user_id, job_id, jobs!inner(*)")
    .eq("status", "new")
    .eq("jobs.description", "")
    .eq("jobs.thin", false);
  if (sourceIds) q = q.in("jobs.source_id", sourceIds);
  const waiting = await must<MatchWithJob[]>(q.limit(MAX_SCORE_PER_RUN * 4));
  if (!waiting.length) return {};
  const byJob = new Map<string, MatchWithJob[]>();
  for (const m of waiting) byJob.set(m.job_id, [...(byJob.get(m.job_id) ?? []), m]);
  // Jobs added by hand have no source to read a description from: the person's own text stands.
  const jobs = [...byJob.values()]
    .map((ms) => ms[0].jobs)
    .filter((j) => j.source_id)
    .slice(0, MAX_SCORE_PER_RUN * 2);
  const sources = new Map(
    (await must<Source[]>(db.from("sources").select("*").in("id", [...new Set(jobs.map((j) => j.source_id))]))).map((s) => [s.id, s]),
  );
  const criteriaOf = new Map(people.map((p) => [p.id, p.criteria]));

  let described = 0;
  await pool(jobs, DESCRIBE_CONCURRENCY, async (job) => {
    let found: { text: string; location?: string; company?: string; remote?: boolean; title?: string } = { text: "" };
    try {
      found = await describe(sources.get(job.source_id!)!, job); // jobs without a source were filtered out above
      described++;
    } catch (e) {
      if (e instanceof PostingClosedError) {
        const now = new Date().toISOString();
        await must(db.from("jobs").update({ closed_at: now }).eq("id", job.id));
        await must(db.from("matches").update({ status: "closed" }).eq("job_id", job.id).in("status", OPEN_STATUSES));
        return;
      }
      console.warn(`  no description for ${job.title} @ ${job.company}: ${e instanceof Error ? e.message : e}`);
    }
    const updated = {
      ...job,
      description: found.text,
      location: found.location ?? job.location,
      remote: job.remote || Boolean(found.remote),
      title: found.title || job.title, // Radancy: the posting's own title replaces the rough one
    };
    const thin = updated.description.length < THIN_THRESHOLD;
    await must(
      db
        .from("jobs")
        .update({
          description: updated.description,
          location: updated.location,
          remote: updated.remote,
          title: updated.title,
          thin,
          ...(found.company && !job.company ? { company: found.company } : {}),
        })
        .eq("id", job.id),
    );
    for (const m of byJob.get(job.id)!) {
      const c = criteriaOf.get(m.user_id);
      const reason = c ? verdict({ ...updated, thin }, c) : null;
      if (reason) {
        await must(db.from("matches").update({ status: "filtered", filter_reason: reason }).eq("id", m.id));
        acc.add(m.user_id, "filtered_later");
      }
    }
  });
  return { described_later: described };
}

/** One person's AI spend over the last 24 hours, from their run shares. */
/** AI spend in the last 24 hours (one person's, or everyone's): runs plus other AI tasks (CV imports, drafts). */
async function spentLast24h(userId?: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const sum = (rows: { stats?: Record<string, number> | null; cost_usd?: number | string }[]) =>
    rows.reduce((a, r) => a + (Number(r.stats?.cost_usd ?? r.cost_usd) || 0), 0);
  let tasks = db.from("ai_usage").select("cost_usd").gte("created_at", since);
  if (userId) tasks = tasks.eq("user_id", userId);
  const [runs, other] = await Promise.all([
    userId
      ? must<{ stats: Record<string, number> | null }[]>(
          db.from("run_users").select("stats, runs!inner(started_at)").eq("user_id", userId).gte("runs.started_at", since),
        )
      : must<{ stats: Record<string, number> | null }[]>(db.from("runs").select("stats").gte("started_at", since)),
    must<{ cost_usd: number | string }[]>(tasks),
  ]);
  return sum(runs) + sum(other);
}

/**
 * What a person may spend on scoring in this run: their per-run cap, or what's left of
 * their 24-hour cap, or what's left of everyone's 24-hour cap, whichever is least.
 * `runSpend` is what this run has spent so far (not in the runs log yet).
 */
async function budgetFor(p: Person, settings: Settings, runSpend: { total: number }): Promise<number> {
  const [mine, all, balance] = await Promise.all([spentLast24h(p.id), spentLast24h(), balanceLeft(p)]);
  return Math.max(
    0,
    Math.min(p.runCap, p.dayCap - mine, Number(settings.max_total_daily_cost_usd) - all - runSpend.total, balance),
  );
}

/**
 * What's left of a member's AI balance (granted by the admin minus what they spent). The
 * admin draws on the Anthropic account directly, so has no balance limit here.
 */
async function balanceLeft(p: Person): Promise<number> {
  if (p.isAdmin) return Infinity;
  const { data } = await db.from("member_balances").select("balance_usd").eq("user_id", p.id).maybeSingle();
  return Number(data?.balance_usd ?? 0);
}

async function loadContext(p: Person) {
  const profile = await must<Profile>(db.from("profile").select("*").eq("user_id", p.id).single());
  const rows = await must<
    { decision: "approve" | "skip"; reasons: string[]; note: string | null; jobs: { title: string; company: string } | null }[]
  >(
    db
      .from("feedback")
      .select("decision, reasons, note, jobs(title, company)")
      .eq("user_id", p.id)
      .order("created_at", { ascending: false })
      .limit(40),
  );
  const feedback: FeedbackExample[] = rows
    .filter((r) => r.jobs)
    .map((r) => ({ ...r.jobs!, decision: r.decision, reasons: r.reasons, note: r.note }));
  return { profile, feedback };
}

/**
 * Scores one person's waiting matches, within their budget. Over-budget ones stay waiting.
 * First the re-scores asked for on Criteria (status "scored", scored_at cleared: they keep
 * their old score in the Inbox until this replaces it), then waiting matches, those that
 * started waiting most recently first (just arrived, or just passed a re-evaluation).
 */
async function scoreFor(p: Person, settings: Settings, sourceIds: string[] | null, runSpend: { total: number }): Promise<Record<string, number>> {
  const select = () => {
    const q = db.from("matches").select("id, user_id, job_id, jobs!inner(*)").eq("user_id", p.id);
    return sourceIds ? q.in("jobs.source_id", sourceIds) : q;
  };
  const rescores = await must<MatchWithJob[]>(
    select().eq("status", "scored").is("scored_at", null).order("status_changed_at", { ascending: false }).limit(MAX_SCORE_PER_RUN),
  );
  const waiting =
    rescores.length < MAX_SCORE_PER_RUN
      ? await must<MatchWithJob[]>(
          select().eq("status", "new").order("status_changed_at", { ascending: false }).limit(MAX_SCORE_PER_RUN - rescores.length),
        )
      : [];
  const pending = [...rescores, ...waiting];
  if (!pending.length) return {};
  // The career (Profile) is what the scorer knows about the person: none, no scoring.
  if (!(await hasCareer(p.id))) {
    console.log(`[${p.email}] no career on their profile yet; ${pending.length} listings wait.`);
    return { no_career: pending.length };
  }

  const budget = await budgetFor(p, settings, runSpend);
  if (budget <= 0) {
    console.log(`[${p.email}] spend cap reached or balance used up; ${pending.length} listings wait.`);
    return { over_budget: pending.length };
  }

  const client = new Anthropic();
  const { profile, feedback } = await loadContext(p);
  const system = buildSystemPrompt(profile, p.criteria, feedback);
  const model = resolveModel(settings.scoring_model);
  console.log(`[${p.email}] scoring ${pending.length} listings with ${model}, budget $${budget.toFixed(4)}`);
  let scored = 0;
  let errors = 0;
  const spend = { cost: 0, tokensIn: 0, tokensOut: 0 };

  const queue = [...pending];
  await Promise.all(
    Array.from({ length: SCORE_CONCURRENCY }, async () => {
      // Stop taking new listings once the budget is spent. Calls already in flight
      // finish, so a run can go over by at most a few listings' cost.
      for (let m = queue.shift(); m && spend.cost < budget; m = queue.shift()) {
        const job = m.jobs;
        try {
          const { score: s, model: answeredBy, usage } = await scoreJob(client, model, system, job);
          const cost = costUsd(answeredBy, usage);
          spend.cost += cost;
          runSpend.total += cost;
          spend.tokensIn += usage.input + usage.cacheWrite + usage.cacheRead;
          spend.tokensOut += usage.output;
          await must(
            db
              .from("matches")
              .update({
                status: "scored",
                score: s.score,
                score_checks: s.checks,
                score_summary: s.summary,
                score_pros: s.pros.slice(0, 6), // a sanity cap, not a target
                score_cons: s.cons.slice(0, 6),
                scored_at: new Date().toISOString(),
              })
              .eq("id", m.id),
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
  const overBudget = pending.length - scored - errors;
  console.log(`[${p.email}] scoring cost $${spend.cost.toFixed(4)} (${spend.tokensIn} tokens in, ${spend.tokensOut} out)`);
  if (overBudget > 0) console.log(`[${p.email}] spend cap reached or balance used up; ${overBudget} listings wait for the next run.`);
  return {
    scored,
    score_errors: errors,
    ...(overBudget > 0 ? { over_budget: overBudget } : {}),
    cost_usd: Math.round(spend.cost * 1e6) / 1e6,
    tokens_in: spend.tokensIn,
    tokens_out: spend.tokensOut,
  };
}

/** Whether the person has a career on their profile (the scorer needs one). */
async function hasCareer(userId: string): Promise<boolean> {
  const { data } = await db.from("profile").select("career").eq("user_id", userId).single();
  return Boolean(data?.career);
}

/** Scores everyone's waiting matches, person by person. */
async function scoreAll(people: Person[], settings: Settings, sourceIds: string[] | null, acc: PerPerson) {
  const runSpend = { total: 0 };
  for (const p of people) acc.set(p.id, await scoreFor(p, settings, sourceIds, runSpend));
  return runSpend.total;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/** A match flattened into the Job shape the email templates take. */
function asJob(m: MatchWithJob & Partial<Job>): Job {
  return {
    ...m.jobs,
    status: m.status!,
    status_changed_at: m.status_changed_at!,
    filter_reason: m.filter_reason ?? null,
    score: m.score ?? null,
    score_summary: m.score_summary ?? null,
    score_pros: m.score_pros ?? null,
    score_cons: m.score_cons ?? null,
    applied_at: m.applied_at ?? null,
    followed_up_at: m.followed_up_at ?? null,
    notified_at: m.notified_at ?? null,
  };
}

/** Where a person's emails go. Only the admin falls back to DIGEST_TO; nobody else's mail can land there. */
const recipient = (p: Person): string | undefined | null => p.criteria.digest_email.trim() || (p.isAdmin ? undefined : null);

const MATCH_WITH_JOB = "id, user_id, job_id, status, status_changed_at, filter_reason, score, score_summary, score_pros, score_cons, notified_at, applied_at, followed_up_at, jobs!inner(*)";

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

type RunResult = { stats: Record<string, number>; perPerson: PerPerson };

async function runFetch(mode: "watchlist" | "full"): Promise<RunResult> {
  const acc = new PerPerson();
  const [settings, people] = await Promise.all([loadSettings(), loadPeople()]);
  // A board is fetched if anyone follows it (watched, for a watchlist run).
  const wanted = new Set(people.flatMap((p) => p.subs.filter((s) => mode === "full" || s.watchlist).map((s) => s.source_id)));
  const all = await must<Source[]>(db.from("sources").select("*"));
  // Watchlist runs skip sources too expensive to fetch that often (paged, search).
  const sources = all.filter((s) => wanted.has(s.id) && (mode === "full" || FETCH_MODES[ATS_INFO[s.ats]?.fetch]?.watchable));
  if (!sources.length) {
    console.log(`No ${mode === "watchlist" ? "watched " : ""}sources followed.`);
    return { stats: { sources: 0, cost_usd: 0 }, perPerson: acc };
  }

  // Direct sources first, aggregators last (see syncSource).
  const aggregatorIds = new Set(all.filter((s) => ATS_INFO[s.ats]?.aggregator).map((s) => s.id));
  const followedAnywhere = new Set(people.flatMap((p) => p.subs.map((s) => s.source_id)));
  const direct = new Set(
    all.filter((s) => followedAnywhere.has(s.id) && !aggregatorIds.has(s.id)).map((s) => `${s.ats}:${s.slug.toLowerCase()}`),
  );
  sources.sort((a, b) => Number(aggregatorIds.has(a.id)) - Number(aggregatorIds.has(b.id)));

  const totals: Record<string, number> = { sources: sources.length };
  for (const s of sources) {
    // One broken source must not stop the others (or the scoring after them).
    let st: Record<string, number>;
    try {
      st = await syncSource(s, people, aggregatorIds, direct, acc);
    } catch (e) {
      const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
      await db.from("sources").update({ last_error: msg, last_checked_at: new Date().toISOString() }).eq("id", s.id);
      console.error(`[${s.company_name}] failed: ${msg}`);
      st = { errors: 1 };
    }
    for (const [k, v] of Object.entries(st)) totals[k] = (totals[k] ?? 0) + v;
  }
  const ids = sources.map((s) => s.id);
  Object.assign(totals, await describePending(people, ids, acc));
  // A watchlist run scores only what the watched sources brought in.
  const cost = await scoreAll(people, settings, mode === "watchlist" ? ids : null, acc);
  totals.cost_usd = Math.round(cost * 1e6) / 1e6;

  if (mode === "watchlist") {
    for (const p of people) {
      const watched = p.subs.filter((s) => s.watchlist).map((s) => s.source_id);
      const to = recipient(p);
      if (!watched.length || to === null) continue;
      const strong = await must<(MatchWithJob & Partial<Job>)[]>(
        db
          .from("matches")
          .select(MATCH_WITH_JOB)
          .eq("user_id", p.id)
          .eq("status", "scored")
          .gte("score", p.criteria.score_threshold)
          .is("notified_at", null)
          .in("jobs.source_id", watched)
          .order("score", { ascending: false }),
      );
      if (!strong.length) continue;
      const { subject, html } = renderWatchlistAlert(strong.map(asJob));
      await sendEmail(subject, html, to);
      await must(db.from("matches").update({ notified_at: new Date().toISOString() }).in("id", strong.map((m) => m.id)));
      acc.add(p.id, "alerted", strong.length);
      totals.alerted = (totals.alerted ?? 0) + strong.length;
    }
  }
  return { stats: totals, perPerson: acc };
}

/** Describes and scores listings already waiting, for everyone, without fetching anything. */
async function runScore(): Promise<RunResult> {
  const acc = new PerPerson();
  const [settings, people] = await Promise.all([loadSettings(), loadPeople()]);
  const stats: Record<string, number> = { ...(await describePending(people, null, acc)) };
  stats.cost_usd = Math.round((await scoreAll(people, settings, null, acc)) * 1e6) / 1e6;
  for (const [, s] of acc.entries()) {
    for (const k of ["scored", "score_errors", "over_budget"]) if (s[k]) stats[k] = (stats[k] ?? 0) + s[k];
  }
  return { stats, perPerson: acc };
}

async function runDigest(): Promise<RunResult> {
  const acc = new PerPerson();
  const people = await loadPeople();
  const now = Date.now();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  // cost_usd: the digest makes no Claude calls.
  const stats: Record<string, number> = { emailed: 0, cost_usd: 0 };

  for (const p of people) {
    const to = recipient(p);
    if (to === null) continue;
    const mine = () => db.from("matches").select(MATCH_WITH_JOB).eq("user_id", p.id);
    const followCutoff = new Date(now - p.criteria.followup_days * 86_400_000).toISOString();
    const [newMatches, applied, statusChanges] = await Promise.all([
      must<(MatchWithJob & Partial<Job>)[]>(
        mine().eq("status", "scored").gte("score", p.criteria.score_threshold).is("notified_at", null).order("score", { ascending: false }).limit(25),
      ),
      must<(MatchWithJob & Partial<Job>)[]>(mine().eq("status", "applied")),
      must<(MatchWithJob & Partial<Job>)[]>(
        mine().in("status", ["applied", "interview", "offer", "rejected"]).gte("status_changed_at", dayAgo).order("status_changed_at", { ascending: false }),
      ),
    ]);
    const followUps = applied.filter((m) => (m.followed_up_at ?? m.applied_at ?? m.status_changed_at!) < followCutoff);
    const mineStats = { new_matches: newMatches.length, follow_ups: followUps.length, status_changes: statusChanges.length, emailed: 0 };
    if (newMatches.length || followUps.length || statusChanges.length) {
      const { subject, html } = renderDigest({
        newMatches: newMatches.map(asJob),
        followUps: followUps.map(asJob),
        statusChanges: statusChanges.map(asJob),
      });
      await sendEmail(subject, html, to);
      mineStats.emailed = 1;
      stats.emailed++;
      if (newMatches.length) {
        await must(db.from("matches").update({ notified_at: new Date().toISOString() }).in("id", newMatches.map((m) => m.id)));
      }
    } else {
      console.log(`[${p.email}] nothing to report; no email sent.`);
    }
    acc.set(p.id, mineStats);
  }
  return { stats, perPerson: acc };
}

/** Runs one mode and logs it: the runs table (whole run) and run_users (each person's share). */
async function record(mode: Mode) {
  const run = await must<{ id: string }>(db.from("runs").insert({ kind: mode }).select("id").single());
  try {
    const { stats, perPerson } =
      mode === "digest" ? await runDigest() : mode === "score" ? await runScore() : await runFetch(mode);
    await db.from("runs").update({ finished_at: new Date().toISOString(), stats }).eq("id", run.id);
    const shares = perPerson
      .entries()
      .filter(([, s]) => Object.values(s).some((v) => v))
      .map(([user_id, s]) => ({ run_id: run.id, user_id, stats: { cost_usd: 0, ...s } }));
    if (shares.length) await must(db.from("run_users").upsert(shares, { onConflict: "run_id,user_id" }));
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
 * Listings waiting to be scored (after a re-evaluation, a new follower, or more than one
 * run's cap) are scored at the next quiet tick, if someone waiting has budget left. If
 * the last scoring run scored nothing (e.g. the API key stopped working), it waits 6
 * hours instead of retrying every tick.
 */
async function scoringDue(settings: Settings): Promise<boolean> {
  const people = await loadPeople();
  const runSpend = { total: 0 };
  let due = false;
  for (const p of people) {
    // Waiting, or scored but asked to be re-scored (scored_at cleared).
    const { count } = await db
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", p.id)
      .or("status.eq.new,and(status.eq.scored,scored_at.is.null)");
    if (!count) continue;
    if (!(await hasCareer(p.id))) {
      console.log(`[${p.email}] ${count} listings waiting, but there's no career to score against yet.`);
      continue;
    }
    if ((await budgetFor(p, settings, runSpend)) > 0) due = true;
    else console.log(`[${p.email}] ${count} listings waiting, but a spend cap is reached or the balance is used up.`);
  }
  if (!due) return false;
  const [last] = await must<{ started_at: string; stats: Record<string, number>; error: string | null }[]>(
    db.from("runs").select("started_at, stats, error").eq("kind", "score").order("started_at", { ascending: false }).limit(1),
  );
  if (!last) return true;
  const stuck = Boolean(last.error) || !(last.stats?.scored > 0 || last.stats?.over_budget > 0);
  return !stuck || Date.now() - Date.parse(last.started_at) > 6 * 3_600_000;
}

/**
 * Invites the admin added on the Members page: creates the account, makes it a member,
 * and emails a link to set a password. Someone who already has an account gets a
 * password-reset link instead. Done here because the worker has the service-role and
 * email keys; the web app doesn't.
 */
async function processInvites() {
  const pending = await must<{ email: string }[]>(db.from("invites").select("email").is("sent_at", null).is("error", null));
  if (!pending.length) return;
  const settings = await loadSettings();
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  for (const { email } of pending) {
    try {
      if (!appUrl || !process.env.RESEND_API_KEY) throw new Error("APP_URL and RESEND_API_KEY are needed to send invites.");
      let reset = false;
      let link = await db.auth.admin.generateLink({ type: "invite", email });
      if (link.error && /already been registered|already exists/i.test(link.error.message)) {
        reset = true;
        link = await db.auth.admin.generateLink({ type: "recovery", email });
      }
      if (link.error || !link.data.user) throw new Error(link.error?.message ?? "no user returned");
      // New members start with the admin's default caps; an existing member keeps theirs.
      await must(
        db.from("members").upsert(
          {
            user_id: link.data.user.id,
            email,
            max_run_cost_usd: settings.default_run_cost_usd,
            max_daily_cost_usd: settings.default_daily_cost_usd,
          },
          { onConflict: "user_id", ignoreDuplicates: true },
        ),
      );
      const url = `${appUrl}/auth/confirm?${new URLSearchParams({ token_hash: link.data.properties.hashed_token, type: reset ? "recovery" : "invite" })}`;
      const { subject, html } = renderInvite(url, reset);
      await sendEmail(subject, html, email);
      await must(db.from("invites").update({ sent_at: new Date().toISOString() }).eq("email", email));
      console.log(`Invite sent to ${email}${reset ? " (existing account: password reset)" : ""}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("invites").update({ error: msg }).eq("email", email);
      console.error(`Invite to ${email} failed: ${msg}`);
    }
  }
}

/** Called every 15 minutes: sends pending invites, then runs whatever the shared schedule says is due. */
async function tick() {
  await processInvites().catch((e) => console.error("Invites failed:", e)); // never blocks the schedule
  const settings = await loadSettings();
  const last = { watchlist: await lastStarted("watchlist"), full: await lastStarted("full") };
  const due = dueNow(settings, last, Date.now());
  console.log(`Tick (${settings.timezone}): daily ${due.daily ? "due" : "not due"}, watchlist ${due.watchlist ? "due" : "not due"}`);
  if (due.daily) {
    try {
      await record("full");
    } finally {
      await record("digest"); // the digests go out even if some sources failed
    }
  } else if (due.watchlist) {
    const { count } = await db.from("subscriptions").select("source_id", { count: "exact", head: true }).eq("watchlist", true).eq("enabled", true);
    if (count) await record("watchlist");
    else console.log("Nobody watches a source; nothing to check.");
  } else if (await scoringDue(settings)) {
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
