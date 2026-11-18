import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { Bar, Empty, PageHeader, Panel } from "@/components/ui";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { nextRuns, timezones } from "@/lib/schedule";
import { daysAgoIso, nowMs } from "@/lib/time";
import { SCORING_MODELS, WATCH_INTERVALS, type Criteria } from "@/lib/types";
import { addExcludeKeyword, saveCriteria } from "../actions";

/** "Today 07:00", "Tomorrow 07:00", "Off", in the schedule's timezone. */
function fmtRun(t: number | null, tz: string): string {
  if (t === null) return "off";
  const now = nowMs();
  if (t <= now + 60_000) return "at the next check (within ~15 min)";
  const day = (x: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(t);
  const label = day(t) === day(now) ? "today" : day(t) === day(now + 86_400_000) ? "tomorrow" : day(t);
  return `${label} ${time}`;
}

export default async function CriteriaPage() {
  const supabase = await createClient();
  const lastRun = (kind: string) =>
    supabase.from("runs").select("started_at").eq("kind", kind).order("started_at", { ascending: false }).limit(1);
  const [{ data: c, error }, { data: skips }, { data: lastWatch }, { data: lastFull }] = await Promise.all([
    supabase.from("criteria").select("*").eq("id", 1).single(),
    supabase.from("feedback").select("reasons").eq("decision", "skip").gte("created_at", daysAgoIso(60)),
    lastRun("watchlist"),
    lastRun("full"),
  ]);
  if (error) throw new Error(error.message);
  const criteria = c as Criteria;
  const ms = (rows: { started_at: string }[] | null) => (rows?.[0] ? Date.parse(rows[0].started_at) : null);
  const next = nextRuns(criteria, { watchlist: ms(lastWatch), full: ms(lastFull) }, nowMs());

  const counts = new Map<string, number>();
  for (const s of skips ?? []) for (const r of s.reasons as string[]) counts.set(r, (counts.get(r) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = ranked[0]?.[1] ?? 1;

  return (
    <>
      <PageHeader
        title="Criteria"
        meta="Hard filters run first and cost nothing; only listings that pass are scored. Separate list entries with commas or new lines. Changes apply to listings fetched from now on."
      />

      <div className="split">
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
              <Row label="Must-have keywords" hint="The description must contain one. Empty means any.">
                <List name="include_keywords" value={criteria.include_keywords} placeholder="TypeScript, React" />
              </Row>
              <Row label="Exclude" hint="Whole words in the title.">
                <List name="exclude_keywords" value={criteria.exclude_keywords} placeholder="Principal, Staff, PHP" />
              </Row>
            </div>
          </Panel>

          <Panel title="Scoring">
            <div className="divide">
              <Row label="Preferences" hint="Free text the scorer reads.">
                <textarea
                  name="preferences"
                  defaultValue={criteria.preferences}
                  rows={4}
                  className="input"
                  placeholder="E.g. I prefer product companies over agencies, small-to-mid teams, and want to grow towards full-stack."
                />
              </Row>
              <Row label="Model" hint="Used from the next run. Scored listings keep their score.">
                <div className="grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
                  {SCORING_MODELS.map((m) => (
                    <label
                      key={m.id}
                      className="flex cursor-pointer gap-2 bg-[var(--surface)] p-2.5 text-[13px] has-[:checked]:bg-[var(--row-active)]"
                    >
                      <input type="radio" name="scoring_model" value={m.id} defaultChecked={criteria.scoring_model === m.id} className="mt-0.5" />
                      <span>
                        <span className="block font-medium">{m.label.replace("Claude ", "")}</span>
                        <span className="faint block text-[12px]">{m.note}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Row>
              <Row label="Inbox threshold" hint="Scores below this stay out of the Inbox and the digest.">
                <input name="score_threshold" type="number" min={0} max={100} defaultValue={criteria.score_threshold} className="input mono w-24" />
              </Row>
            </div>
          </Panel>

          <Panel title="Schedule" aside={`times in ${criteria.timezone.replace(/_/g, " ")}`}>
            <div className="divide">
              <Row label="Daily search" hint="Checks every source, scores what's new, then sends the digest.">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" name="daily_enabled" defaultChecked={criteria.daily_enabled} />
                    <span className="muted">every day at</span>
                  </label>
                  <input name="daily_time" type="time" defaultValue={criteria.daily_time} className="input mono w-28" />
                </div>
                <p className="hint mt-1.5">Next: {fmtRun(next.daily, criteria.timezone)}</p>
              </Row>
              <Row label="Watchlist check" hint="Only watched sources; strong new matches are emailed right away.">
                <select name="watch_interval_minutes" defaultValue={criteria.watch_interval_minutes} className="input w-auto">
                  {WATCH_INTERVALS.map((w) => (
                    <option key={w.minutes} value={w.minutes}>
                      {w.label}
                    </option>
                  ))}
                </select>
                <p className="hint mt-1.5">Next: {fmtRun(next.watchlist, criteria.timezone)}</p>
              </Row>
              <Row label="Timezone" hint="The daily time above is in this timezone.">
                <TimezoneSelect name="timezone" value={criteria.timezone} options={timezones()} />
              </Row>
            </div>
            <p className="faint border-t border-[var(--border)] px-3 py-2 text-[12px]">
              Bullseye checks the schedule every 15 minutes, and GitHub sometimes starts that a few minutes late, so
              runs happen up to ~20 minutes after the set time.
            </p>
          </Panel>

          <Panel title="Notifications">
            <div className="divide">
              <Row label="Send emails to" hint="The daily digest and watchlist alerts.">
                <input name="digest_email" type="email" defaultValue={criteria.digest_email} className="input" placeholder="you@example.com" />
              </Row>
              <Row
                label="Remind me to follow up"
                hint="When an application gets no reply for this long, it's flagged in the Pipeline and listed in your digest, so you can write to the company."
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
          <p className="faint text-[12px] leading-relaxed">
            The scorer already reads your recent decisions. Turn frequent skip reasons into filters to save scoring cost.
          </p>
        </aside>
      </div>
    </>
  );
}

function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 px-3 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
      <div>
        <div className="text-[13px]">{props.label}</div>
        {props.hint && <div className="hint mt-0.5">{props.hint}</div>}
      </div>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

function List(props: { name: string; value: string[]; placeholder: string }) {
  return <textarea name={props.name} defaultValue={props.value.join(", ")} rows={2} className="input" placeholder={props.placeholder} />;
}
