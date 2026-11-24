import Link from "next/link";
import { Row } from "@/components/FormRow";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient, currentUser } from "@/lib/supabase/server";
import { Bar, Empty, PageHeader, Panel } from "@/components/ui";
import { Price } from "@/components/Price";
import { estimateScoringPerJob } from "@/lib/estimates";
import { dailySlots, formatNextRun } from "@/lib/schedule";
import { daysAgoIso, nowMs } from "@/lib/time";
import { DEFAULT_SCORING_MODEL, SCORING_MODELS, type Criteria, type Member, type Settings } from "@/lib/types";
import { addExcludeKeyword, reevaluate, saveCriteria } from "../actions";

export default async function CriteriaPage({ searchParams }: PageProps<"/criteria">) {
  const done = await searchParams; // set after a re-evaluation
  const supabase = await createClient();
  const me = await currentUser(supabase);
  const [
    { data: c, error },
    { data: skips },
    { count: openCount },
    { count: scoredCount },
    { data: st },
    { data: mem },
  ] = await Promise.all([
    supabase.from("criteria").select("*").single(),
    supabase.from("feedback").select("reasons").eq("decision", "skip").gte("created_at", daysAgoIso(60)),
    supabase.from("my_jobs").select("id", { count: "exact", head: true }).in("status", ["new", "scored", "filtered"]),
    supabase.from("my_jobs").select("id", { count: "exact", head: true }).eq("status", "scored"),
    supabase.from("settings").select("*").single(),
    supabase.from("members").select("*").eq("user_id", me.id).single(),
  ]);
  const settings = st as Settings;
  const member = mem as Member;
  // Re-scoring them all: scoring one job in your last runs, priced at the current scoring model.
  const perJob = await estimateScoringPerJob(supabase, me.id, SCORING_MODELS.find((m) => m.id === settings.scoring_model)?.id ?? DEFAULT_SCORING_MODEL);
  const rescoreEstimate = { ...perJob, usd: (scoredCount ?? 0) * perJob.usd };
  if (error) throw new Error(error.message);
  const criteria = c as Criteria;
  // A $0 cap (per run or per 24h) stops all scoring for this person.
  const scoringPaused = Number(member.max_run_cost_usd) <= 0 || Number(member.max_daily_cost_usd) <= 0;
  const nextDaily = settings.daily_enabled ? dailySlots(settings, nowMs()).next : null;

  const counts = new Map<string, number>();
  for (const s of skips ?? []) for (const r of s.reasons as string[]) counts.set(r, (counts.get(r) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = ranked[0]?.[1] ?? 1;

  return (
    <>
      <PageHeader
        title="Criteria"
        meta="Filters are free; only listings that pass get scored. Separate entries with commas or new lines."
      />

      <div className="split">
        <div className="space-y-10">
        <form action={saveCriteria} className="space-y-6">
          <Panel title="Filters">
            <div className="divide">
              <Row label="Target roles" hint="The title must contain one.">
                <List name="roles" value={criteria.roles} placeholder="Frontend, Full-stack, React" />
              </Row>
              <Row label="Locations" hint="The location must contain one.">
                <List name="locations" value={criteria.locations} placeholder="Budapest, Hungary, Europe" />
                <label className="mt-2 flex items-center gap-2 text-[13px]">
                  <input type="checkbox" name="remote_ok" defaultChecked={criteria.remote_ok} />
                  <span className="muted">Remote listings pass the location filter</span>
                </label>
              </Row>
              <Row label="Must-have keywords" hint="In the description. Empty means any.">
                <List name="include_keywords" value={criteria.include_keywords} placeholder="TypeScript, React" />
              </Row>
              <Row label="Exclude" hint="Whole words in the title.">
                <List name="exclude_keywords" value={criteria.exclude_keywords} placeholder="Principal, Staff, PHP" />
              </Row>
            </div>
          </Panel>

          <Panel title="Scoring">
            <div className="divide">
              <Row label="Preferences" hint="For the scorer.">
                <textarea
                  name="preferences"
                  defaultValue={criteria.preferences}
                  rows={4}
                  className="input"
                  placeholder="E.g. I prefer product companies over agencies, small-to-mid teams, and want to grow towards full-stack."
                />
              </Row>
              <Row label="Inbox threshold" hint="Lower scores stay out of the Inbox.">
                <input name="score_threshold" type="number" min={0} max={100} defaultValue={criteria.score_threshold} className="input mono w-24" />
              </Row>
            </div>
          </Panel>

          <Panel title="Notifications">
            <div className="divide">
              <Row label="Send emails to" hint="Digest and watchlist alerts.">
                <input name="digest_email" type="email" defaultValue={criteria.digest_email} className="input" placeholder="you@example.com" />
              </Row>
              <Row
                label="Remind me to follow up"
                hint="Flags applications with no reply."
              >
                <div className="flex items-center gap-2">
                  <span className="muted text-[12px]">after</span>
                  <input name="followup_days" type="number" min={1} defaultValue={criteria.followup_days} className="input mono w-24" />
                  <span className="muted text-[12px]">days without a reply</span>
                </div>
              </Row>
            </div>
          </Panel>

          <SubmitButton className="btn-primary" done="Saved">Save criteria</SubmitButton>
        </form>

        {/* The schedule is a shared setting (the admin's Settings page): here just when the next search runs. */}
        <p className="hint">
          Daily search{" "}
          {nextDaily === null ? (
            "off"
          ) : (
            <>
              next <span className="mono text-[var(--fg)]">{formatNextRun(nextDaily, settings.timezone, nowMs())}</span> (
              {settings.timezone.replace(/_/g, " ")})
            </>
          )}
          {me.isAdmin ? (
            <>
              {" "}
              ·{" "}
              <Link href="/settings" className="link">
                Settings →
              </Link>
            </>
          ) : (
            " · set by the admin"
          )}
        </p>
        </div>

        <aside className="space-y-3">
          <Panel title="What your skips say" aside="60 days">
            {ranked.length === 0 ? (
              <Empty>No skips yet.</Empty>
            ) : (
              <ul className="space-y-2.5 p-3">
                {ranked.map(([reason, n]) => (
                  <li key={reason}>
                    <div className="mb-1 flex justify-between text-[12px]">
                      <span className="muted">{reason}</span>
                      <span className="mono">{n}</span>
                    </div>
                    <Bar value={(n / max) * 100} />
                  </li>
                ))}
              </ul>
            )}
            <form action={addExcludeKeyword} className="flex gap-1.5 border-t border-[var(--border)] p-3">
              <input name="keyword" placeholder="Exclude a title word" className="input" />
              <SubmitButton className="btn" done="Added">Add</SubmitButton>
            </form>
          </Panel>
          <p className="faint text-[12px]">Frequent reasons make good filters.</p>

          <div id="reevaluate" className="scroll-mt-6">
            <Panel title="Re-evaluate">
              <form action={reevaluate} className="space-y-3 p-3 text-[13px]">
                <p className="muted leading-relaxed">
                  Apply the saved criteria to the <span className="mono text-[var(--fg)]">{openCount ?? 0}</span> listings
                  you haven&apos;t acted on. Free.
                </p>
                <label className="flex items-start gap-2">
                  <input type="checkbox" name="rescore" className="mt-0.5" />
                  <span className="muted">
                    Re-score the <span className="mono text-[var(--fg)]">{scoredCount ?? 0}</span> scored ones too <Price estimate={rescoreEstimate} />.
                    They keep their score in the Inbox until the new one arrives, and go first.
                  </span>
                </label>
                {scoringPaused && (
                  <p className="text-[12px] text-[var(--warn)]">
                    Scoring is paused: your AI budget is $0{me.isAdmin ? " (Settings)" : " (set by the admin)"}. Nothing gets scored until it&apos;s raised.
                  </p>
                )}
                <SubmitButton className="btn" done="Done">
                  Re-evaluate
                </SubmitButton>
                {done.filtered !== undefined && (
                  <p className="border-t border-[var(--border)] pt-2.5 text-[12px] leading-relaxed">
                    <span className="mono">{done.filtered}</span> moved to Filtered ·{" "}
                    <span className="mono">{done.waiting}</span> newly waiting to be scored ·{" "}
                    {Number(done.rescore) > 0 && (
                      <>
                        <span className="mono">{done.rescore}</span> to re-score ·{" "}
                      </>
                    )}
                    <span className="mono">{done.kept}</span> unchanged.
                    {Number(done.waiting) + Number(done.rescore ?? 0) > 0 && (
                      <span className="faint">
                        {" "}
                        {scoringPaused ? "They're scored once your AI budget is raised." : "Scored in the background, re-scores first."}
                      </span>
                    )}
                  </p>
                )}
              </form>
            </Panel>
          </div>
        </aside>
      </div>
    </>
  );
}

function List(props: { name: string; value: string[]; placeholder: string }) {
  return <textarea name={props.name} defaultValue={props.value.join(", ")} rows={2} className="input" placeholder={props.placeholder} />;
}
