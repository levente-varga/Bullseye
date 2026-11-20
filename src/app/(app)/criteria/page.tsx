import Link from "next/link";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient, currentUser } from "@/lib/supabase/server";
import { Bar, Empty, PageHeader, Panel } from "@/components/ui";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { formatUsd } from "@/lib/pricing";
import { dailySlots, nextRuns, timezones } from "@/lib/schedule";
import { daysAgoIso, nowMs } from "@/lib/time";
import { SCORING_MODELS, WATCH_INTERVALS, type Criteria, type Member, type Settings } from "@/lib/types";
import { addExcludeKeyword, reevaluate, saveCriteria, saveSettings } from "../actions";

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

export default async function CriteriaPage({ searchParams }: PageProps<"/criteria">) {
  const done = await searchParams; // set after a re-evaluation
  const supabase = await createClient();
  const me = await currentUser(supabase);
  const lastRun = (kind: string) =>
    supabase.from("runs").select("started_at").eq("kind", kind).order("started_at", { ascending: false }).limit(1);
  const dayAgo = new Date(nowMs() - 86_400_000).toISOString();
  const [
    { data: c, error },
    { data: skips },
    { data: lastWatch },
    { data: lastFull },
    { count: openCount },
    { count: scoredCount },
    { data: scoredRuns },
    { data: dayRuns },
    { data: st },
    { data: mem },
    { data: allDayRuns },
  ] = await Promise.all([
    supabase.from("criteria").select("*").single(),
    supabase.from("feedback").select("reasons").eq("decision", "skip").gte("created_at", daysAgoIso(60)),
    lastRun("watchlist"),
    lastRun("full"),
    supabase.from("my_jobs").select("id", { count: "exact", head: true }).in("status", ["new", "scored", "filtered"]),
    supabase.from("my_jobs").select("id", { count: "exact", head: true }).eq("status", "scored"),
    // Your recent run shares that scored something: their cost per listing prices a re-score.
    supabase.from("run_users").select("stats").eq("user_id", me.id).gt("stats->scored", 0).order("run_id").limit(20),
    // Your spend in the last 24 hours, against your daily cap.
    supabase.from("run_users").select("stats, runs!inner(started_at)").eq("user_id", me.id).gte("runs.started_at", dayAgo),
    supabase.from("settings").select("*").single(),
    supabase.from("members").select("*").eq("user_id", me.id).single(),
    // Everyone's spend (admin only; RLS returns nothing to others), against the global cap.
    me.isAdmin ? supabase.from("runs").select("stats").gte("started_at", dayAgo) : Promise.resolve({ data: [] }),
  ]);
  const settings = st as Settings;
  const member = mem as Member;
  const spent24h = (dayRuns ?? []).reduce((sum, r) => sum + (Number(r.stats?.cost_usd) || 0), 0);
  const spentAll24h = ((allDayRuns ?? []) as { stats: Record<string, number> }[]).reduce((sum, r) => sum + (Number(r.stats?.cost_usd) || 0), 0);
  const spent = (scoredRuns ?? []).reduce(
    (a, r) => ({ cost: a.cost + (Number(r.stats.cost_usd) || 0), jobs: a.jobs + (Number(r.stats.scored) || 0) }),
    { cost: 0, jobs: 0 },
  );
  const perJob = spent.jobs ? spent.cost / spent.jobs : 0.0005;
  const rescoreCost = (scoredCount ?? 0) * perJob;
  if (error) throw new Error(error.message);
  const criteria = c as Criteria;
  const ms = (rows: { started_at: string }[] | null) => (rows?.[0] ? Date.parse(rows[0].started_at) : null);
  // Run history is private to the admin, so others get the next slot from the schedule alone.
  const next = me.isAdmin
    ? nextRuns(settings, { watchlist: ms(lastWatch), full: ms(lastFull) }, nowMs())
    : { daily: settings.daily_enabled ? dailySlots(settings, nowMs()).next : null, watchlist: null };

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

        <SettingsForm
          settings={settings}
          member={member}
          isAdmin={me.isAdmin}
          next={next}
          spent24h={spent24h}
          spentAll24h={spentAll24h}
          perJob={perJob}
        />
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
                    Re-score the <span className="mono text-[var(--fg)]">{scoredCount ?? 0}</span> scored ones too (~<span className="mono text-[var(--fg)]">{formatUsd(rescoreCost)}</span>)
                  </span>
                </label>
                <SubmitButton className="btn" done="Done">
                  Re-evaluate
                </SubmitButton>
                {done.filtered !== undefined && (
                  <p className="border-t border-[var(--border)] pt-2.5 text-[12px] leading-relaxed">
                    <span className="mono">{done.filtered}</span> moved to Filtered ·{" "}
                    <span className="mono">{done.waiting}</span> waiting to be scored ·{" "}
                    <span className="mono">{done.kept}</span> unchanged.
                    {Number(done.waiting) > 0 && (
                      <span className="faint"> Scored in the background.</span>
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

/**
 * The shared schedule, the scoring model and AI spend caps. The admin edits them;
 * everyone else sees them read-only (their own caps are set by the admin).
 */
function SettingsForm(props: {
  settings: Settings;
  member: Member;
  isAdmin: boolean;
  next: { daily: number | null; watchlist: number | null };
  spent24h: number;
  spentAll24h: number;
  perJob: number;
}) {
  const { settings, member, isAdmin, next } = props;
  return (
    // Keyed by what was saved: a <select>'s defaultValue only applies when it mounts, so
    // without the remount the form would keep showing the old choice after saving.
    <form
      key={`${settings.updated_at}|${member.max_run_cost_usd}|${member.max_daily_cost_usd}`}
      action={saveSettings}
      className="space-y-6"
    >
      <fieldset disabled={!isAdmin} className="space-y-6">
        <Panel title="Schedule" aside={`times in ${settings.timezone.replace(/_/g, " ")}${isAdmin ? "" : " · set by the admin"}`}>
          <div className="divide">
            <Row label="Daily search" hint="Fetch, score, then send digests.">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" name="daily_enabled" defaultChecked={settings.daily_enabled} />
                  <span className="muted">every day at</span>
                </label>
                <input name="daily_time" type="time" defaultValue={settings.daily_time} className="input mono w-28" />
              </div>
              <p className="hint mt-1.5">Next: {fmtRun(next.daily, settings.timezone)}</p>
            </Row>
            <Row label="Watchlist check" hint="Watched sources; strong matches are emailed.">
              <select name="watch_interval_minutes" defaultValue={settings.watch_interval_minutes} className="input w-auto">
                {WATCH_INTERVALS.map((w) => (
                  <option key={w.minutes} value={w.minutes}>
                    {w.label}
                  </option>
                ))}
              </select>
              {isAdmin && <p className="hint mt-1.5">Next: {fmtRun(next.watchlist, settings.timezone)}</p>}
            </Row>
            {isAdmin && (
              <Row label="Timezone">
                <TimezoneSelect name="timezone" value={settings.timezone} options={timezones()} />
              </Row>
            )}
          </div>
          <p className="faint border-t border-[var(--border)] px-3 py-2 text-[12px]">
            Runs can start up to ~20 minutes late.
          </p>
        </Panel>

        <Panel title="AI scoring" aside={isAdmin ? undefined : "set by the admin"}>
          <div className="divide">
            <Row label="Model" hint="For everyone, from the next run.">
              {/* Three across when the value has room for them, stacked otherwise. */}
              <div className="grid gap-px border border-[var(--border)] bg-[var(--border)] @md:grid-cols-3">
                {SCORING_MODELS.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer gap-2 bg-[var(--surface)] p-2.5 text-[13px] has-[:checked]:bg-[var(--row-active)]"
                  >
                    <input type="radio" name="scoring_model" value={m.id} defaultChecked={settings.scoring_model === m.id} className="mt-0.5" />
                    <span>
                      <span className="block font-medium">{m.label.replace("Claude ", "")}</span>
                      <span className="faint block text-[12px]">{m.note}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Row>
            <Row
              label={isAdmin ? "Your spend caps" : "Spend caps"}
              hint="Over-cap listings wait for budget. 0 pauses scoring."
            >
              <div className="flex flex-wrap items-end gap-4">
                <Money name="max_run_cost_usd" label="Per run" value={member.max_run_cost_usd} />
                <Money name="max_daily_cost_usd" label="Per 24 hours" value={member.max_daily_cost_usd} />
              </div>
              <p className="faint mt-2 text-[12px]">
                <span className="mono text-[var(--fg)]">{formatUsd(props.spent24h)}</span> spent in 24h · a run covers ~<span className="mono">
                  {props.perJob > 0 ? Math.floor(Number(member.max_run_cost_usd) / props.perJob).toLocaleString("en-US") : "–"}
                </span>{" "}
                listings
              </p>
            </Row>
            {isAdmin && (
              <Row label="Everyone, per 24 hours" hint="Stops all scoring once reached.">
                <Money name="max_total_daily_cost_usd" label="All members" value={settings.max_total_daily_cost_usd} />
                <p className="faint mt-2 text-[12px]">
                  <span className="mono text-[var(--fg)]">{formatUsd(props.spentAll24h)}</span> spent in 24h
                </p>
              </Row>
            )}
          </div>
        </Panel>
      </fieldset>
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton className="btn-primary" done="Saved">
            Save schedule and AI settings
          </SubmitButton>
          <Link href="/admin" className="link text-[13px]">
            Members and their caps →
          </Link>
        </div>
      )}
    </form>
  );
}

function Money(props: { name: string; label: string; value: number }) {
  return (
    <label className="field">
      <span className="hint">{props.label}</span>
      <span className="flex items-center gap-1.5">
        <span className="faint mono">$</span>
        <input name={props.name} type="number" min={0} step={0.01} defaultValue={props.value} className="input mono w-24" />
      </span>
    </label>
  );
}

/**
 * A label (and hint) beside its value when the row has room (28rem, by its own width:
 * the main column narrows when the side panel shows), above it otherwise. The value
 * is a container too, so what's inside can lay itself out by its width.
 */
function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid gap-2 px-3 py-3 @md:grid-cols-[180px_1fr] @md:gap-4">
        <div>
          <div className="text-[13px]">{props.label}</div>
          {props.hint && <div className="hint mt-0.5">{props.hint}</div>}
        </div>
        <div className="@container min-w-0">{props.children}</div>
      </div>
    </div>
  );
}

function List(props: { name: string; value: string[]; placeholder: string }) {
  return <textarea name={props.name} defaultValue={props.value.join(", ")} rows={2} className="input" placeholder={props.placeholder} />;
}
