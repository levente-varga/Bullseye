import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { IconExternal } from "@/components/icons";
import { PendingBar } from "@/components/PendingBar";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, PageHeader, Pill, ScoreMeter } from "@/components/ui";
import { ago, pad2 } from "@/lib/time";
import { SKIP_REASONS, type Job } from "@/lib/types";
import { approveJob, skipJob } from "./actions";

export default async function InboxPage({ searchParams }: PageProps<"/">) {
  const { all } = await searchParams;
  const showAll = all === "1";
  const supabase = await createClient();

  const { data: criteria } = await supabase.from("criteria").select("score_threshold").eq("id", 1).single();
  const threshold = criteria?.score_threshold ?? 60;

  const [{ data, error }, { count: scoredCount }] = await Promise.all([
    (showAll
      ? supabase.from("jobs").select("*").eq("status", "scored")
      : supabase.from("jobs").select("*").eq("status", "scored").gte("score", threshold)
    )
      .order("score", { ascending: false })
      .limit(150),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "scored"),
  ]);
  if (error) throw new Error(error.message);
  const jobs = data as Job[];
  const above = showAll ? jobs.filter((j) => (j.score ?? 0) >= threshold).length : jobs.length;

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
          <div className="inline-flex border border-[var(--border-strong)] text-[12px]">
            <Link href="/" className={`px-2.5 py-1 ${!showAll ? "bg-[var(--surface-2)]" : "muted"}`}>
              Above threshold
              <PendingBar />
            </Link>
            <Link href="/?all=1" className={`border-l border-[var(--border-strong)] px-2.5 py-1 ${showAll ? "bg-[var(--surface-2)]" : "muted"}`}>
              All scored
              <PendingBar />
            </Link>
          </div>
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
          <Empty>
            Nothing waiting. New listings arrive with the next run.{" "}
            <Link href="/sources" className="link">
              Add sources
            </Link>{" "}
            if you haven&apos;t yet.
          </Empty>
        ) : (
          <ol className="divide">
            {jobs.map((job, i) => (
              <JobRow key={job.id} job={job} index={i + 1} dim={(job.score ?? 0) < threshold} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function JobRow({ job, index, dim }: { job: Job; index: number; dim: boolean }) {
  return (
    <li>
      <details className="group">
        <summary
          className={`grid cursor-pointer list-none grid-cols-[28px_72px_1fr] items-start gap-x-4 gap-y-2 px-3 py-3 hover:bg-[var(--surface-2)] group-open:bg-[var(--row-active)] lg:grid-cols-[28px_72px_1fr_200px_44px_150px] [&::-webkit-details-marker]:hidden ${dim ? "opacity-60" : ""}`}
        >
          <span className="mono faint pt-0.5 text-[12px]">{pad2(index)}</span>
          <ScoreMeter score={job.score} width="w-[72px]" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{job.title}</span>
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
          <span className="mono faint hidden pt-0.5 text-[12px] lg:block">{ago(job.first_seen_at)}</span>
          <div className="col-start-3 flex items-start gap-1.5 lg:col-start-auto lg:justify-end">
            <form action={approveJob}>
              <input type="hidden" name="id" value={job.id} />
              <SubmitButton className="btn-primary">Approve</SubmitButton>
            </form>
            <span className="btn">
              <span className="group-open:hidden">Details</span>
              <span className="hidden group-open:inline">Close</span>
            </span>
          </div>
        </summary>

        <div className="grid gap-5 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-4 lg:grid-cols-[1fr_320px] lg:pl-[132px]">
          <div className="space-y-3">
            {job.score_summary && <p className="text-[13px] leading-relaxed">{job.score_summary}</p>}
            <div className="grid gap-3 text-[13px] sm:grid-cols-2">
              <ul className="space-y-1">
                {(job.score_pros ?? []).map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="mono text-[var(--ok)]">+</span>
                    <span className="muted">{p}</span>
                  </li>
                ))}
              </ul>
              <ul className="space-y-1">
                {(job.score_cons ?? []).map((c) => (
                  <li key={c} className="flex gap-2">
                    <span className="mono text-[var(--bad)]">−</span>
                    <span className="muted">{c}</span>
                  </li>
                ))}
              </ul>
            </div>
            <a href={job.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-[12px]">
              Open posting <IconExternal />
            </a>
          </div>

          <form action={skipJob} className="space-y-2.5">
            <input type="hidden" name="id" value={job.id} />
            <div className="eyebrow">Skip because</div>
            <div className="flex flex-wrap gap-1.5">
              {SKIP_REASONS.map((r) => (
                <label key={r} className="chip">
                  <input type="checkbox" name="reasons" value={r} className="sr-only" />
                  {r}
                </label>
              ))}
            </div>
            <input name="other" placeholder="Other reason (optional)" className="input" />
            <SubmitButton className="btn">Skip</SubmitButton>
          </form>
        </div>
      </details>
    </li>
  );
}
