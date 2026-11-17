import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SKIP_REASONS, type Job } from "@/lib/types";
import { approveJob, skipJob } from "./actions";

export default async function InboxPage({ searchParams }: PageProps<"/">) {
  const { all } = await searchParams;
  const showAll = all === "1";
  const supabase = await createClient();

  const { data: criteria } = await supabase.from("criteria").select("score_threshold").eq("id", 1).single();
  const threshold = criteria?.score_threshold ?? 60;

  let q = supabase.from("jobs").select("*").eq("status", "scored").order("score", { ascending: false }).limit(100);
  if (!showAll) q = q.gte("score", threshold);
  const { data: jobs, error } = await q;
  if (error) throw new Error(error.message);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="h1">Inbox</h1>
          <p className="muted text-sm">
            {jobs.length} scored {jobs.length === 1 ? "listing" : "listings"}
            {showAll ? "" : ` at or above your threshold of ${threshold}`}. Approve or skip each one. Skip reasons teach
            the scorer.
          </p>
        </div>
        <Link href={showAll ? "/" : "/?all=1"} className="btn">
          {showAll ? "Only above threshold" : "Show all scored"}
        </Link>
      </div>

      {jobs.length === 0 ? (
        <div className="card muted p-8 text-center text-sm">
          Nothing waiting. New listings arrive after the next worker run. Add companies under{" "}
          <Link href="/sources" className="underline">
            Sources
          </Link>{" "}
          if you haven&apos;t yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {(jobs as Job[]).map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </ul>
      )}
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  return (
    <li className="card p-4">
      <div className="flex gap-3">
        <ScoreBadge score={job.score} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <a href={job.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
              {job.title}
            </a>
            <p className="muted text-sm">
              {job.company} · {job.location || "Location n/a"}
              {job.remote && " · Remote"}
              {job.compensation && ` · ${job.compensation}`}
            </p>
          </div>
          {job.score_summary && <p className="text-sm">{job.score_summary}</p>}
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {!!job.score_pros?.length && (
              <ul className="space-y-0.5">
                {job.score_pros.map((p) => (
                  <li key={p} className="text-emerald-700 dark:text-emerald-400">
                    + {p}
                  </li>
                ))}
              </ul>
            )}
            {!!job.score_cons?.length && (
              <ul className="space-y-0.5">
                {job.score_cons.map((c) => (
                  <li key={c} className="text-amber-700 dark:text-amber-400">
                    − {c}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-start gap-2 pt-1">
            <form action={approveJob}>
              <input type="hidden" name="id" value={job.id} />
              <button className="btn-primary">Approve</button>
            </form>
            <details className="group flex-1">
              <summary className="btn list-none">Skip…</summary>
              <form action={skipJob} className="mt-3 space-y-3">
                <input type="hidden" name="id" value={job.id} />
                <div className="flex flex-wrap gap-1.5">
                  {SKIP_REASONS.map((r) => (
                    <label key={r} className="chip">
                      <input type="checkbox" name="reasons" value={r} className="sr-only" />
                      {r}
                    </label>
                  ))}
                </div>
                <input name="other" placeholder="Other reason (optional)" className="input" />
                <button className="btn">Confirm skip</button>
              </form>
            </details>
          </div>
        </div>
      </div>
    </li>
  );
}
