import { createClient } from "@/lib/supabase/server";
import { IconExternal } from "@/components/icons";
import { Dot, Empty, PageHeader, Panel, Pill, ScoreMeter } from "@/components/ui";
import { agoText, nowMs } from "@/lib/time";
import { PIPELINE_STATUSES, type Job, type JobStatus } from "@/lib/types";
import { markFollowedUp, setStatus } from "../actions";

const LABEL: Record<string, string> = {
  approved: "To apply",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

const NEXT: Partial<Record<JobStatus, JobStatus[]>> = {
  approved: ["applied", "skipped"],
  applied: ["interview", "rejected"],
  interview: ["offer", "rejected"],
  offer: ["rejected"],
  rejected: ["applied"],
};

export default async function PipelinePage() {
  const supabase = await createClient();
  const [{ data, error }, { data: criteria }] = await Promise.all([
    supabase.from("jobs").select("*").in("status", PIPELINE_STATUSES).order("status_changed_at", { ascending: false }),
    supabase.from("criteria").select("followup_days").eq("id", 1).single(),
  ]);
  if (error) throw new Error(error.message);
  const jobs = data as Job[];
  const followupDays = criteria?.followup_days ?? 10;
  const followupMs = followupDays * 86_400_000;
  const now = nowMs();
  const due = (j: Job) => {
    const last = j.followed_up_at ?? j.applied_at;
    return j.status === "applied" && !!last && now - new Date(last).getTime() > followupMs;
  };
  const count = (s: JobStatus) => jobs.filter((j) => j.status === s).length;
  const dueCount = jobs.filter(due).length;

  return (
    <>
      <PageHeader
        title="Pipeline"
        meta={
          <>
            {PIPELINE_STATUSES.map((s, i) => (
              <span key={s}>
                {i > 0 && " · "}
                <span className="mono text-[var(--fg)]">{count(s)}</span> {LABEL[s].toLowerCase()}
              </span>
            ))}
            {dueCount > 0 && (
              <span className="text-[var(--warn)]">
                {" "}
                · <span className="mono">{dueCount}</span> follow-up{dueCount === 1 ? "" : "s"} due
              </span>
            )}
          </>
        }
      />

      <div className="space-y-6">
        {PIPELINE_STATUSES.map((status) => {
          const rows = jobs.filter((j) => j.status === status);
          return (
            <Panel key={status} title={LABEL[status]} aside={rows.length}>
              {rows.length === 0 ? (
                <Empty>Empty.</Empty>
              ) : (
                <ul className="divide">
                  {rows.map((job) => (
                    <li key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 hover:bg-[var(--surface-2)]">
                      <ScoreMeter score={job.score} width="w-14" />
                      <div className="min-w-0 flex-1">
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 font-medium hover:underline"
                        >
                          {job.title} <IconExternal className="text-[var(--faint)]" />
                        </a>
                        <div className="muted mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px]">
                          <span>{job.company}</span>
                          {job.applied_at && <span className="mono faint">applied {agoText(job.applied_at)}</span>}
                          {job.followed_up_at && <span className="mono faint">followed up {agoText(job.followed_up_at)}</span>}
                          {due(job) && (
                            <span className="inline-flex items-center gap-1.5">
                              <Dot tone="warn" />
                              <Pill tone="warn">Follow-up due</Pill>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {status === "applied" && (
                          <form action={markFollowedUp}>
                            <input type="hidden" name="id" value={job.id} />
                            <button className="btn">Followed up</button>
                          </form>
                        )}
                        {(NEXT[status] ?? []).map((to) => (
                          <form key={to} action={setStatus}>
                            <input type="hidden" name="id" value={job.id} />
                            <input type="hidden" name="status" value={to} />
                            <button className={to === "rejected" || to === "skipped" ? "btn" : "btn-primary"}>
                              {to === "skipped" ? "Drop" : `→ ${LABEL[to]}`}
                            </button>
                          </form>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })}
      </div>
      <p className="faint mt-4 text-[12px]">
        Follow-ups are flagged after <span className="mono">{followupDays}</span> days without contact (set on the
        Criteria page).
      </p>
    </>
  );
}
