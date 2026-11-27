import { createClient, currentUser } from "@/lib/supabase/server";
import { AddJobForm } from "@/components/AddJobForm";
import { DraftPanel } from "@/components/DraftPanel";
import { RowMenu, type RowMenuItem } from "@/components/RowMenu";
import { SubmitButton } from "@/components/SubmitButton";
import { ExpandableJobRow, ExpandToggle } from "@/components/ExpandableJobRow";
import { Dot, Empty, PageHeader, Panel, Pill, ScoreMeter } from "@/components/ui";
import { estimateTask } from "@/lib/estimates";
import { agoText, nowMs } from "@/lib/time";
import { DEFAULT_SCORING_MODEL, JOB_LIST_COLUMNS, PIPELINE_STATUSES, SCORING_MODELS, isEffort, type Job, type JobStatus } from "@/lib/types";
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

/** Moves that aren't the main one (going backwards or out) live in the row's ⋮ menu. */
const isMain = (to: JobStatus) => to !== "rejected" && to !== "skipped";

/** A row's ⋮ menu: the other moves, plus "Followed up" for applied and "Back to Inbox" for to-apply. */
function menuFor(status: JobStatus, id: string): RowMenuItem[] {
  return [
    ...(status === "applied" ? [{ label: "Followed up", action: markFollowedUp, fields: { id } }] : []),
    ...(NEXT[status] ?? [])
      .filter((to) => !isMain(to))
      .map((to) => ({ label: ACTION[to] ?? to, action: setStatus, fields: { id, status: to } })),
    ...(status === "approved" ? [{ label: "Back to Inbox", action: restoreToInbox, fields: { id } }] : []),
  ];
}

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
    supabase.from("settings").select("writing_model, writing_effort").single(),
    supabase.from("profile").select("letter_questions").single(),
  ]);
  // Estimates for the draft buttons: drafts use the writing model, the questions Haiku.
  const writingModel = SCORING_MODELS.find((m) => m.id === st?.writing_model)?.id ?? DEFAULT_SCORING_MODEL;
  const writingEffort = isEffort(st?.writing_effort) ? st.writing_effort : "medium";
  const [cvEst, questionsEst, letterEst] = await Promise.all([
    estimateTask(supabase, me.id, "cv_draft", writingModel, writingEffort),
    estimateTask(supabase, me.id, "letter_questions", DEFAULT_SCORING_MODEL, "low"),
    estimateTask(supabase, me.id, "cover_letter", writingModel, writingEffort),
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
                        indent="lg:pl-[64px]"
                        extra={<DraftPanel jobId={job.id} estimates={estimates} questionsOn={questionsOn} />}
                        summaryClassName="flex cursor-pointer list-none items-start gap-x-4 px-3 py-2.5 hover:bg-[var(--surface-2)] group-open:bg-[var(--row-active)] [&::-webkit-details-marker]:hidden"
                        summary={
                          <>
                            <ScoreMeter score={job.score} />
                            <div className="min-w-0 flex-1">
                              {/* The drafts made for it sit beside the title. */}
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-medium [overflow-wrap:anywhere]">{job.title}</span>
                                {drafted.has(`${job.id}:cv`) && <Pill tone="muted">CV</Pill>}
                                {drafted.has(`${job.id}:cover_letter`) && <Pill tone="muted">Cover letter</Pill>}
                              </div>
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
                            {/* Phones too: the buttons stay on the first row, on the right. */}
                            <div className="flex shrink-0 items-center justify-end gap-1.5">
                              {/* The main move forward; everything else is in the ⋮ menu. */}
                              {(NEXT[status] ?? []).filter(isMain).map((to) => (
                                <form key={to} action={setStatus}>
                                  <input type="hidden" name="id" value={job.id} />
                                  <input type="hidden" name="status" value={to} />
                                  <SubmitButton className="btn-primary">{ACTION[to]}</SubmitButton>
                                </form>
                              ))}
                              {menuFor(status, job.id).length > 0 && <RowMenu items={menuFor(status, job.id)} />}
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
