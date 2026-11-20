import Link from "next/link";
import { redirect } from "next/navigation";
import { Money, Row } from "@/components/FormRow";
import { SubmitButton } from "@/components/SubmitButton";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { PageHeader, Panel } from "@/components/ui";
import { formatUsd } from "@/lib/pricing";
import { formatNextRun, nextRuns, timezones } from "@/lib/schedule";
import { createClient, currentUser } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { SCORING_MODELS, WATCH_INTERVALS, type Member, type ScoringModel, type Settings } from "@/lib/types";
import { saveSettings } from "../actions";

/**
 * Settings shared by everyone, changed by the admin only: the schedule, the AI models
 * (scoring and writing) and the spend caps. Members see the schedule as a line on
 * Criteria; their own caps are set on the Members page.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const me = await currentUser(supabase);
  if (!me.isAdmin) redirect("/");

  const lastRun = (kind: string) =>
    supabase.from("runs").select("started_at").eq("kind", kind).order("started_at", { ascending: false }).limit(1);
  const dayAgo = new Date(nowMs() - 86_400_000).toISOString();
  const [
    { data: st },
    { data: mem },
    { data: lastWatch },
    { data: lastFull },
    { data: myDay },
    { data: allDay },
    { data: scoredRuns },
    { data: tasksDay },
  ] = await Promise.all([
      supabase.from("settings").select("*").single(),
      supabase.from("members").select("*").eq("user_id", me.id).single(),
      lastRun("watchlist"),
      lastRun("full"),
      supabase.from("run_users").select("stats, runs!inner(started_at)").eq("user_id", me.id).gte("runs.started_at", dayAgo),
      supabase.from("runs").select("stats").gte("started_at", dayAgo),
      // Your recent run shares that scored something: their cost per listing sizes a run.
      supabase.from("run_users").select("stats").eq("user_id", me.id).gt("stats->scored", 0).order("run_id").limit(20),
      // Other AI tasks (CV imports, drafts) in the last 24 hours: they count against the caps too.
      supabase.from("ai_usage").select("user_id, cost_usd").gte("created_at", dayAgo),
    ]);
  const settings = st as Settings;
  const member = mem as Member;
  const sum = (rows: { stats: Record<string, unknown> }[] | null) => (rows ?? []).reduce((a, r) => a + (Number(r.stats?.cost_usd) || 0), 0);
  const tasks = (tasksDay ?? []) as { user_id: string; cost_usd: number | string }[];
  const tasksCost = (rows: typeof tasks) => rows.reduce((a, t) => a + Number(t.cost_usd), 0);
  const spent24h = sum(myDay) + tasksCost(tasks.filter((t) => t.user_id === me.id));
  const spentAll24h = sum(allDay) + tasksCost(tasks);
  const scored = (scoredRuns ?? []).reduce(
    (a, r) => ({ cost: a.cost + (Number(r.stats.cost_usd) || 0), jobs: a.jobs + (Number(r.stats.scored) || 0) }),
    { cost: 0, jobs: 0 },
  );
  const perJob = scored.jobs ? scored.cost / scored.jobs : 0.0005;
  const ms = (rows: { started_at: string }[] | null) => (rows?.[0] ? Date.parse(rows[0].started_at) : null);
  const next = nextRuns(settings, { watchlist: ms(lastWatch), full: ms(lastFull) }, nowMs());
  const tz = settings.timezone;

  return (
    <>
      <PageHeader title="Settings" meta="Shared by everyone; only you can change them." />

      {/* Keyed by what was saved: a <select>'s defaultValue only applies when it mounts, so
          without the remount the form would keep showing the old choice after saving. */}
      <form
        key={`${settings.updated_at}|${member.max_run_cost_usd}|${member.max_daily_cost_usd}`}
        action={saveSettings}
        className="max-w-[52rem] space-y-6"
      >
        <Panel title="Schedule" aside={`times in ${tz.replace(/_/g, " ")}`}>
          <div className="divide">
            <Row label="Daily search" hint="Fetch, score, then send digests.">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" name="daily_enabled" defaultChecked={settings.daily_enabled} />
                  <span className="muted">every day at</span>
                </label>
                <input name="daily_time" type="time" defaultValue={settings.daily_time} className="input mono w-28" />
              </div>
              <p className="hint mt-1.5">Next: {formatNextRun(next.daily, tz, nowMs())}</p>
            </Row>
            <Row label="Watchlist check" hint="Watched sources; strong matches are emailed.">
              <select name="watch_interval_minutes" defaultValue={settings.watch_interval_minutes} className="input w-auto">
                {WATCH_INTERVALS.map((w) => (
                  <option key={w.minutes} value={w.minutes}>
                    {w.label}
                  </option>
                ))}
              </select>
              <p className="hint mt-1.5">Next: {formatNextRun(next.watchlist, tz, nowMs())}</p>
            </Row>
            <Row label="Timezone">
              <TimezoneSelect name="timezone" value={tz} options={timezones()} />
            </Row>
          </div>
          <p className="faint border-t border-[var(--border)] px-3 py-2 text-[12px]">Runs can start up to ~20 minutes late.</p>
        </Panel>

        <Panel title="AI">
          <div className="divide">
            <Row label="Scoring model" hint="Reads job listings and scores them. For everyone, from the next run.">
              <ModelPicker name="scoring_model" value={settings.scoring_model} />
            </Row>
            <Row label="Writing model" hint="Builds careers from CVs; will write CV and cover letter drafts.">
              <ModelPicker name="writing_model" value={settings.writing_model ?? "claude-haiku-5-5"} />
            </Row>
            <Row label="Your spend caps" hint="Over-cap listings wait for budget. 0 pauses scoring.">
              <div className="flex flex-wrap items-end gap-4">
                <Money name="max_run_cost_usd" label="Per run" value={member.max_run_cost_usd} />
                <Money name="max_daily_cost_usd" label="Per 24 hours" value={member.max_daily_cost_usd} />
              </div>
              <p className="faint mt-2 text-[12px]">
                <span className="mono text-[var(--fg)]">{formatUsd(spent24h)}</span> spent in 24h · a run covers ~
                <span className="mono">{perJob > 0 ? Math.floor(Number(member.max_run_cost_usd) / perJob).toLocaleString("en-US") : "–"}</span>{" "}
                listings
              </p>
            </Row>
            <Row label="Everyone, per 24 hours" hint="Stops all scoring once reached.">
              <Money name="max_total_daily_cost_usd" label="All members" value={settings.max_total_daily_cost_usd} />
              <p className="faint mt-2 text-[12px]">
                <span className="mono text-[var(--fg)]">{formatUsd(spentAll24h)}</span> spent in 24h
              </p>
            </Row>
          </div>
        </Panel>

        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton className="btn-primary" done="Saved">
            Save settings
          </SubmitButton>
          <Link href="/admin" className="link text-[13px]">
            Members and their caps →
          </Link>
        </div>
      </form>
    </>
  );
}

/** Haiku / Sonnet / Opus with their notes; three across when there's room. */
function ModelPicker({ name, value }: { name: string; value: ScoringModel }) {
  return (
    <div className="grid gap-px border border-[var(--border)] bg-[var(--border)] @md:grid-cols-3">
      {SCORING_MODELS.map((m) => (
        <label key={m.id} className="flex cursor-pointer gap-2 bg-[var(--surface)] p-2.5 text-[13px] has-[:checked]:bg-[var(--row-active)]">
          <input type="radio" name={name} value={m.id} defaultChecked={value === m.id} className="mt-0.5" />
          <span>
            <span className="block font-medium">{m.label.replace("Claude ", "")}</span>
            <span className="faint block text-[12px]">{m.note}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
