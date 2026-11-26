import Link from "next/link";
import { createClient, currentUser } from "@/lib/supabase/server";
import { ExpandableJobRow, ExpandToggle } from "@/components/ExpandableJobRow";
import { IconExternal } from "@/components/icons";
import { InboxSearch } from "@/components/InboxSearch";
import { PendingBar } from "@/components/PendingBar";
import { Segmented } from "@/components/Segmented";
import { SubmitButton } from "@/components/SubmitButton";
import { RescoreButton } from "@/components/RescoreButton";
import { SkipForm } from "@/components/SkipForm";
import { Empty, PageHeader, Pill, ScoreMeter } from "@/components/ui";
import { estimateTask, type Estimate } from "@/lib/estimates";
import { ago, pad2 } from "@/lib/time";
import { DEFAULT_SCORING_MODEL, JOB_LIST_COLUMNS, SCORING_MODELS, type Job } from "@/lib/types";
import { approveJob, restoreToInbox } from "./actions";

const PAGE = 50;

/** Lower case without accents, like unaccent(lower(…)) in Postgres: "Göteborg" → "goteborg", "Straße" → "strasse". */
const LIGATURES: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", þ: "th", ð: "d" };
const foldAccents = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[ßæœøłđþð]/g, (c) => LIGATURES[c] ?? c);

export default async function InboxPage({ searchParams }: PageProps<"/">) {
  const { all, view: viewParam, n, q: qParam } = await searchParams;
  // Search: every word must appear in the title, company, location or description, ignoring
  // case and accents ("goteborg" finds "Göteborg"): the words are folded the way Postgres's
  // unaccent folds the jobs' search_text. Wildcard characters are dropped.
  const q = (typeof qParam === "string" ? qParam : "").trim().slice(0, 200);
  const words = foldAccents(q)
    .split(/\s+/)
    .map((w) => w.replace(/[%_*\\]/g, ""))
    .filter(Boolean)
    .slice(0, 8);
  // "above" (default), "all" scored, "waiting" (passed the filters, not scored yet), or
  // "skipped" (skipped in the Inbox or dropped from the Pipeline, restorable).
  const view =
    viewParam === "skipped" ? "skipped" : viewParam === "waiting" ? "waiting" : viewParam === "all" || all === "1" ? "all" : "above";
  // 50 rows at a time; "Show more" raises the limit.
  const limit = Math.min(500, Math.max(PAGE, Number(n) || PAGE));
  const supabase = await createClient();

  const [{ data: criteria }, { data: st }, me] = await Promise.all([
    supabase.from("criteria").select("score_threshold").single(),
    supabase.from("settings").select("scoring_model").single(),
    currentUser(supabase),
  ]);
  const threshold = criteria?.score_threshold ?? 60;
  // "Re-score now" in opened rows: one scoring call on the scoring model.
  const rescoreEstimate = await estimateTask(
    supabase,
    me.id,
    "rescore",
    SCORING_MODELS.find((m) => m.id === st?.scoring_model)?.id ?? DEFAULT_SCORING_MODEL,
  );

  // With a search, the total number of matches comes back too.
  const rows = () => supabase.from("my_jobs").select(JOB_LIST_COLUMNS, words.length ? { count: "exact" } : undefined);
  let rowsQuery =
    view === "skipped"
      ? rows().eq("status", "skipped").order("status_changed_at", { ascending: false })
      : view === "waiting"
        ? rows().eq("status", "new").order("first_seen_at", { ascending: false })
        : view === "all"
          ? rows().eq("status", "scored").order("score", { ascending: false })
          : rows().eq("status", "scored").gte("score", threshold).order("score", { ascending: false });
  for (const w of words) {
    // Short words match whole words only ("go" shouldn't find "Google"); longer ones anywhere ("kube").
    rowsQuery =
      w.length <= 3
        ? rowsQuery.filter("search_text", "imatch", `(^|[^a-z0-9])${w.replace(/[.+?^${}()|[\]\\#$-]/g, "\\$&")}([^a-z0-9]|$)`)
        : rowsQuery.ilike("search_text", `%${w}%`);
  }
  const [{ data, error, count: matchCount }, { count: scoredCount }, { count: aboveCount }, { count: waitingCount }, { data: prof }] = await Promise.all([
    rowsQuery.limit(limit + 1), // one extra row tells us whether there's more
    // Header counts need only your matches (not the job rows): straight from matches.
    supabase.from("matches").select("id", { count: "exact", head: true }).eq("status", "scored"),
    supabase.from("matches").select("id", { count: "exact", head: true }).eq("status", "scored").gte("score", threshold),
    supabase.from("matches").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase.from("profile").select("career").single(),
  ]);
  // The scorer reads the career: without one, nothing gets scored.
  const noCareer = !prof?.career;
  if (error) throw new Error(error.message);
  const hasMore = (data?.length ?? 0) > limit;
  const jobs = (data as unknown as Job[]).slice(0, limit);
  const moreHref = `/?${new URLSearchParams({ ...(view !== "above" ? { view } : {}), ...(q ? { q } : {}), n: String(limit + PAGE) })}`;
  // The tabs keep the search.
  const tab = (v?: string) => {
    const qs = new URLSearchParams({ ...(v ? { view: v } : {}), ...(q ? { q } : {}) }).toString();
    return qs ? `/?${qs}` : "/";
  };
  const above = aboveCount ?? 0;

  return (
    <>
      <PageHeader
        title="Inbox"
        meta={
          <>
            <span className="mono text-[var(--fg)]">{above}</span> above your threshold of{" "}
            <span className="mono">{threshold}</span> · <span className="mono">{scoredCount ?? 0}</span> scored ·{" "}
            <span className="mono">{waitingCount ?? 0}</span> waiting to be scored
          </>
        }
        actions={
          <Segmented
            options={[
              { href: tab(), label: "Above threshold", active: view === "above" },
              { href: tab("all"), label: "All scored", active: view === "all" },
              { href: tab("waiting"), label: "Waiting", active: view === "waiting" },
              { href: tab("skipped"), label: "Skipped", active: view === "skipped" },
            ]}
          />
        }
      />

      {noCareer && (
        <p className="panel mb-4 px-3 py-2.5 text-[13px]" style={{ background: "var(--warn-tint)" }}>
          Nothing gets scored until your career is filled in: that&apos;s what the scorer reads.{" "}
          <Link href="/profile#career" className="link">
            Add it on Profile →
          </Link>
        </p>
      )}

      <InboxSearch matches={words.length ? (matchCount ?? 0) : null} />

      <section className="panel">
        <div className="eyebrow hidden grid-cols-[28px_72px_1fr_200px_44px_150px] gap-4 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 lg:grid">
          <span>#</span>
          <span>Fit</span>
          <span>Role</span>
          <span>Location</span>
          <span>Seen</span>
          <span />
        </div>
        {jobs.length === 0 ? (
          words.length ? (
            <Empty>
              No matches for “{q}” here.{" "}
              {view !== "all" && (
                <Link href={tab("all")} className="link">
                  Search all scored
                </Link>
              )}
            </Empty>
          ) : view === "skipped" ? (
            <Empty>Nothing skipped.</Empty>
          ) : view === "waiting" ? (
            <Empty>Nothing waiting to be scored.</Empty>
          ) : (
            <Empty>
              Nothing waiting.{" "}
              <Link href="/sources" className="link">
                Add sources
              </Link>
            </Empty>
          )
        ) : (
          <ol className="divide">
            {view === "waiting"
              ? jobs.map((job, i) => <WaitingRow key={job.id} job={job} index={i + 1} />)
              : jobs.map((job, i) => (
              <JobRow
                key={job.id}
                job={job}
                index={i + 1}
                dim={view === "skipped" || (job.score ?? 0) < threshold}
                rescoreEstimate={rescoreEstimate}
                skipped={view === "skipped"}
              />
            ))}
          </ol>
        )}
        {hasMore && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2.5 text-[12px]">
            <span className="faint">
              Showing <span className="mono">{jobs.length}</span>
            </span>
            <Link href={moreHref} scroll={false} className="btn">
              Show {PAGE} more
              <PendingBar />
            </Link>
          </div>
        )}
      </section>
    </>
  );
}

function JobRow(props: { job: Job; index: number; dim: boolean; skipped: boolean; rescoreEstimate: Estimate }) {
  const { job, index, dim, skipped } = props;
  return (
    <li>
      <ExpandableJobRow
        id={job.id}
        url={job.url}
        side={skipped ? undefined : <DecisionPanel id={job.id} rescoreEstimate={props.rescoreEstimate} />}
        version={job.scored_at}
        summaryClassName={`grid cursor-pointer list-none grid-cols-[28px_72px_1fr] items-start gap-x-4 gap-y-2 px-3 py-3 hover:bg-[var(--surface-2)] group-open:bg-[var(--row-active)] lg:grid-cols-[28px_72px_1fr_200px_44px_150px] [&::-webkit-details-marker]:hidden ${dim ? "opacity-60" : ""}`}
        summary={
          <>
          <span className="mono faint pt-0.5 text-[12px]">{pad2(index)}</span>
          <ScoreMeter score={job.score} width="w-[72px]" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium [overflow-wrap:anywhere]">{job.title}</span>
              {job.thin && <Pill tone="warn">Limited info</Pill>}
            </div>
            <div className="muted mt-0.5 text-[12px]">
              {job.company}
              {job.compensation && <span className="mono"> · {job.compensation}</span>}
            </div>
          </div>
          <LocationCell job={job} />
          <span className="mono faint hidden pt-0.5 text-[12px] lg:block">{ago(skipped ? job.status_changed_at : job.first_seen_at)}</span>
          <div className="col-start-3 flex items-start gap-1.5 lg:col-start-auto lg:justify-end">
            {skipped && (
              <form action={restoreToInbox}>
                <input type="hidden" name="id" value={job.id} />
                <SubmitButton className="btn">Restore</SubmitButton>
              </form>
            )}
            <ExpandToggle />
          </div>
          </>
        }
      />
    </li>
  );
}

/** The location column: a Remote pill (remote is where you'd work), then the places. */
function LocationCell({ job }: { job: Pick<Job, "location" | "remote"> }) {
  return (
    <div className="muted col-start-3 flex min-w-0 items-center gap-1.5 text-[12px] lg:col-start-auto lg:pt-0.5">
      {job.remote && (
        <span className="shrink-0">
          <Pill tone="accent">Remote</Pill>
        </span>
      )}
      <span className="truncate" title={job.location || undefined}>
        {job.location || (job.remote ? "" : "Location n/a")}
      </span>
    </div>
  );
}

/**
 * A listing that passed the filters and waits to be scored: no score or reasoning yet,
 * so no decision either. It links to the posting.
 */
function WaitingRow({ job, index }: { job: Job; index: number }) {
  return (
    <li className="grid grid-cols-[28px_72px_1fr] items-start gap-x-4 gap-y-2 px-3 py-3 lg:grid-cols-[28px_72px_1fr_200px_44px_150px]">
      <span className="mono faint pt-0.5 text-[12px]">{pad2(index)}</span>
      <span className="mono faint pt-0.5 text-[11px]">waiting</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium [overflow-wrap:anywhere]">{job.title}</span>
        </div>
        <div className="muted mt-0.5 text-[12px]">
          {job.company}
          {job.compensation && <span className="mono"> · {job.compensation}</span>}
        </div>
      </div>
      <LocationCell job={job} />
      <span className="mono faint hidden pt-0.5 text-[12px] lg:block">{ago(job.first_seen_at)}</span>
      <div className="col-start-3 flex lg:col-start-auto lg:justify-end">
        <a href={job.url} target="_blank" rel="noreferrer" className="btn btn-icon" title="Open posting">
          <IconExternal />
          <span className="sr-only">Open posting</span>
        </a>
      </div>
    </li>
  );
}

/** The opened row's right column: approve, or skip with reasons. Approving needs the row open, so the reasoning gets read first. */
function DecisionPanel({ id, rescoreEstimate }: { id: string; rescoreEstimate: Estimate }) {
  return (
    <div className="space-y-4">
      <form action={approveJob} className="space-y-2.5">
        <input type="hidden" name="id" value={id} />
        <div className="eyebrow">Worth applying?</div>
        <SubmitButton className="btn-primary">Approve</SubmitButton>
      </form>
      <div className="border-t border-[var(--border)] pt-4">
        <SkipForm id={id} />
      </div>
      <div className="border-t border-[var(--border)] pt-4">
        <RescoreButton id={id} estimate={rescoreEstimate} />
      </div>
    </div>
  );
}
