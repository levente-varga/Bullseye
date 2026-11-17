import { createClient } from "@/lib/supabase/server";
import { ScoreBadge } from "@/components/ScoreBadge";
import { PIPELINE_STATUSES, type Job, type JobStatus } from "@/lib/types";
import { nowMs } from "@/lib/time";
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

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

export default async function PipelinePage() {
  const supabase = await createClient();
  const [{ data: jobs, error }, { data: criteria }] = await Promise.all([
    supabase.from("jobs").select("*").in("status", PIPELINE_STATUSES).order("status_changed_at", { ascending: false }),
    supabase.from("criteria").select("followup_days").eq("id", 1).single(),
  ]);
  if (error) throw new Error(error.message);
  const followupMs = (criteria?.followup_days ?? 10) * 86_400_000;
  const now = nowMs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Pipeline</h1>
        <p className="muted text-sm">
          Move each application along as it progresses. Follow-ups are flagged after {criteria?.followup_days ?? 10} days
          without contact.
        </p>
      </div>

      {PIPELINE_STATUSES.map((status) => {
        const rows = (jobs as Job[]).filter((j) => j.status === status);
        return (
          <section key={status} className="space-y-2">
            <h2 className="font-medium">
              {LABEL[status]} <span className="muted">({rows.length})</span>
            </h2>
            {rows.length === 0 ? (
              <p className="muted text-sm">Empty.</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((job) => {
                  const lastContact = job.followed_up_at ?? job.applied_at;
                  const dueFollowUp =
                    status === "applied" && lastContact && now - new Date(lastContact).getTime() > followupMs;
                  return (
                    <li key={job.id} className="card flex flex-wrap items-center gap-3 p-3">
                      <ScoreBadge score={job.score} />
                      <div className="min-w-0 flex-1">
                        <a href={job.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                          {job.title}
                        </a>
                        <p className="muted text-sm">
                          {job.company} · applied {fmt(job.applied_at)}
                          {job.followed_up_at && ` · followed up ${fmt(job.followed_up_at)}`}
                          {dueFollowUp && <span className="ml-1 font-medium text-amber-600"> · follow-up due</span>}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
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
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
