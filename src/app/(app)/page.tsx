import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ExpandableJobRow } from "@/components/ExpandableJobRow";
import { PendingBar } from "@/components/PendingBar";
import { Segmented } from "@/components/Segmented";
import { SubmitButton } from "@/components/SubmitButton";
import { SkipForm } from "@/components/SkipForm";
import { Empty, PageHeader, Pill, ScoreMeter } from "@/components/ui";
import { ago, pad2 } from "@/lib/time";
import { JOB_LIST_COLUMNS, type Job } from "@/lib/types";
import { approveJob, restoreToInbox } from "./actions";

const PAGE = 50;

export default async function InboxPage({ searchParams }: PageProps<"/">) {
  const { all, view: viewParam, n } = await searchParams;
  // "above" (default), "all" scored, or "skipped" (skipped in the Inbox or dropped from the Pipeline, restorable).
  const view = viewParam === "skipped" ? "skipped" : viewParam === "all" || all === "1" ? "all" : "above";
  // 50 rows at a time; "Show more" raises the limit.
  const limit = Math.min(500, Math.max(PAGE, Number(n) || PAGE));
  const supabase = await createClient();

  const { data: criteria } = await supabase.from("criteria").select("score_threshold").eq("id", 1).single();
  const threshold = criteria?.score_threshold ?? 60;

  const rowsQuery =
    view === "skipped"
      ? supabase.from("jobs").select(JOB_LIST_COLUMNS).eq("status", "skipped").order("status_changed_at", { ascending: false })
      : view === "all"
        ? supabase.from("jobs").select(JOB_LIST_COLUMNS).eq("status", "scored").order("score", { ascending: false })
        : supabase.from("jobs").select(JOB_LIST_COLUMNS).eq("status", "scored").gte("score", threshold).order("score", { ascending: false });
  const [{ data, error }, { count: scoredCount }, { count: aboveCount }] = await Promise.all([
    rowsQuery.limit(limit + 1), // one extra row tells us whether there's more
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "scored"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "scored").gte("score", threshold),
  ]);
  if (error) throw new Error(error.message);
  const hasMore = (data?.length ?? 0) > limit;
  const jobs = (data as unknown as Job[]).slice(0, limit);
  const moreHref = `/?${new URLSearchParams({ ...(view !== "above" ? { view } : {}), n: String(limit + PAGE) })}`;
  const above = aboveCount ?? 0;

  return (
    <>
      <PageHeader
        title="Inbox"
        meta={
          <>
            <span className="mono text-[var(--fg)]">{above}</span> above your threshold of{" "}
            <span className="mono">{threshold}</span> · <span className="mono">{scoredCount ?? 0}</span> scored and
            waiting · approve or skip each one, and your skip reasons tune the scorer
          </>
        }
        actions={
          <Segmented
            options={[
              { href: "/", label: "Above threshold", active: view === "above" },
              { href: "/?view=all", label: "All scored", active: view === "all" },
              { href: "/?view=skipped", label: "Skipped", active: view === "skipped" },
            ]}
          />
        }
      />

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
          view === "skipped" ? (
            <Empty>Nothing skipped. Listings you skip here or drop from the Pipeline show up here, ready to restore.</Empty>
          ) : (
            <Empty>
              Nothing waiting. New listings arrive with the next run.{" "}
              <Link href="/sources" className="link">
                Add sources
              </Link>{" "}
              if you haven&apos;t yet.
            </Empty>
          )
        ) : (
          <ol className="divide">
            {jobs.map((job, i) => (
              <JobRow
                key={job.id}
                job={job}
                index={i + 1}
                dim={view === "skipped" || (job.score ?? 0) < threshold}
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

function JobRow({ job, index, dim, skipped }: { job: Job; index: number; dim: boolean; skipped: boolean }) {
  return (
    <li>
      <ExpandableJobRow
        id={job.id}
        url={job.url}
        side={skipped ? undefined : <DecisionPanel id={job.id} />}
        summaryClassName={`grid cursor-pointer list-none grid-cols-[28px_72px_1fr] items-start gap-x-4 gap-y-2 px-3 py-3 hover:bg-[var(--surface-2)] group-open:bg-[var(--row-active)] lg:grid-cols-[28px_72px_1fr_200px_44px_150px] [&::-webkit-details-marker]:hidden ${dim ? "opacity-60" : ""}`}
        summary={
          <>
          <span className="mono faint pt-0.5 text-[12px]">{pad2(index)}</span>
          <ScoreMeter score={job.score} width="w-[72px]" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium [overflow-wrap:anywhere]">{job.title}</span>
              {job.remote && <Pill tone="accent">Remote</Pill>}
              {job.thin && <Pill tone="warn">Limited info</Pill>}
            </div>
            <div className="muted mt-0.5 text-[12px]">
              {job.company}
              {job.compensation && <span className="mono"> · {job.compensation}</span>}
            </div>
          </div>
          <div className="muted col-start-3 truncate text-[12px] lg:col-start-auto lg:pt-0.5">
            {job.location || "Location n/a"}
          </div>
          <span className="mono faint hidden pt-0.5 text-[12px] lg:block">{ago(skipped ? job.status_changed_at : job.first_seen_at)}</span>
          <div className="col-start-3 flex items-start gap-1.5 lg:col-start-auto lg:justify-end">
            {skipped && (
              <form action={restoreToInbox}>
                <input type="hidden" name="id" value={job.id} />
                <SubmitButton className="btn">Restore</SubmitButton>
              </form>
            )}
            <span className="btn">
              <span className="group-open:hidden">Details</span>
              <span className="hidden group-open:inline">Close</span>
            </span>
          </div>
          </>
        }
      />
    </li>
  );
}

/** The opened row's right column: approve, or skip with reasons. Approving needs the row open, so the reasoning gets read first. */
function DecisionPanel({ id }: { id: string }) {
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
    </div>
  );
}
