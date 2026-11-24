import { createClient, currentUser } from "@/lib/supabase/server";
import { AddJobForm } from "@/components/AddJobForm";
import { DraftPanel } from "@/components/DraftPanel";
import { SubmitButton } from "@/components/SubmitButton";
import { ExpandableJobRow, ExpandToggle } from "@/components/ExpandableJobRow";
import { Dot, Empty, PageHeader, Panel, Pill, ScoreMeter } from "@/components/ui";
import { estimateTask } from "@/lib/estimates";
import { agoText, nowMs } from "@/lib/time";
import { DEFAULT_SCORING_MODEL, JOB_LIST_COLUMNS, PIPELINE_STATUSES, SCORING_MODELS, type Job, type JobStatus } from "@/lib/types";
import { markFollowedUp, restoreToInbox, setStatus } from "../actions";

const LABEL: Record<string, string> = {
  approved: "To apply",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

/** Button text for moving a job to a status. */
const ACTION: Partial<Record<JobStatus, string>> = {
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  skipped: "Drop",
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
  const me = await currentUser(supabase);
  const [{ data, error }, { data: criteria }, { data: draftRows }, { data: st }, { data: prof }] = await Promise.all([
    supabase.from("my_jobs").select(JOB_LIST_COLUMNS).in("status", PIPELINE_STATUSES).order("status_changed_at", { ascending: false }),
    supabase.from("criteria").select("followup_days").single(),
    // Written drafts only: a letter that waits for its questions has no content yet.
    supabase.from("drafts").select("job_id, kind").not("content", "is", null),
    supabase.from("settings").select("writing_model").single(),
    supabase.from("profile").select("letter_questions").single(),
  ]);
  // Estimates for the draft buttons: drafts use the writing model, the questions Haiku.
  const writingModel = SCORING_MODELS.find((m) => m.id === st?.writing_model)?.id ?? DEFAULT_SCORING_MODEL;
  const [cvEst, questionsEst, letterEst] = await Promise.all([
    estimateTask(supabase, me.id, "cv_draft", writingModel),
    estimateTask(supabase, me.id, "letter_questions", DEFAULT_SCORING_MODEL),
    estimateTask(supabase, me.id, "cover_letter", writingModel),
  ]);
  const estimates = { cv: cvEst, questions: questionsEst, letter: letterEst };
  const questionsOn = prof?.letter_questions ?? true;
  const drafted = new Set((draftRows ?? []).map((d) => `${d.job_id}:${d.kind}`));
  if (error) throw new Error(error.message);
  const jobs = data as unknown as Job[];
  const followupDays = criteria?.followup_days ?? 10;
  const followupMs = followupDays * 86_400_000;
  const now = nowMs();
  const due = (j: Job) => {
    const last = j.followed_up_at ?? j.applied_at;
    return j.status === "applied" && !!last && now - new Date(last).getTime() > followupMs;
  };

  return (
    <>
      <PageHeader title="Pipeline" />

      <div className="space-y-6">
        <AddJobForm />
        {PIPELINE_STATUSES.map((status) => {
          const rows = jobs.filter((j) => j.status === status);
          return (
            <Panel key={status} title={LABEL[status]} aside={rows.length}>
              {rows.length === 0 ? (
                <Empty>Empty.</Empty>
              ) : (
                <ul className="divide">
                  {rows.map((job) => (
                    <li key={job.id}>
                      <ExpandableJobRow
                        id={job.id}
                        url={job.url}
                        indent="lg:pl-[88px]"
                        extra={<DraftPanel jobId={job.id} estimates={estimates} questionsOn={questionsOn} />}
                        summaryClassName="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 hover:bg-[var(--surface-2)] group-open:bg-[var(--row-active)] [&::-webkit-details-marker]:hidden"
                        summary={
                          <>
                            <ScoreMeter score={job.score} width="w-14" />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium">{job.title}</div>
                              <div className="muted mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px]">
                                <span>{job.company}</span>
                                {drafted.has(`${job.id}:cv`) && <Pill tone="muted">CV</Pill>}
                                {drafted.has(`${job.id}:cover_letter`) && <Pill tone="muted">Cover letter</Pill>}
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
                                  <SubmitButton className="btn">Followed up</SubmitButton>
                                </form>
                              )}
                              {(NEXT[status] ?? []).map((to) => (
                                <form key={to} action={setStatus}>
                                  <input type="hidden" name="id" value={job.id} />
                                  <input type="hidden" name="status" value={to} />
                                  <SubmitButton className={to === "rejected" || to === "skipped" ? "btn" : "btn-primary"}>
                                    {ACTION[to]}
                                  </SubmitButton>
                                </form>
                              ))}
                              {status === "approved" && (
                                <form action={restoreToInbox}>
                                  <input type="hidden" name="id" value={job.id} />
                                  <SubmitButton className="btn" title="Undo the approval: back to the Inbox, as if untouched">
                                    Back to Inbox
                                  </SubmitButton>
                                </form>
                              )}
                              <ExpandToggle />
                            </div>
                          </>
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
