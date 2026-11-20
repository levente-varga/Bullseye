import Link from "next/link";
import { createClient, currentUser } from "@/lib/supabase/server";
import { ErrorDetails } from "@/components/ErrorDetails";
import { PendingBar } from "@/components/PendingBar";
import { Segmented } from "@/components/Segmented";
import { SubmitButton } from "@/components/SubmitButton";
import { CreditChart } from "@/components/CreditChart";
import { NewJobsChart, type DayCount } from "@/components/NewJobsChart";
import { IconChevronDown } from "@/components/icons";
import { Bar, Dot, Empty, PageHeader, Panel, Pill, SectionHeader, Stat, type Tone } from "@/components/ui";
import { buildSeries, dayStart, type TopUp } from "@/lib/credits";
import { formatRunCost, formatUsd } from "@/lib/pricing";
import { agoText, nowMs } from "@/lib/time";
import { addCreditEntry, deleteCreditEntry } from "../actions";
import { SCORING_MODELS, type JobStatus, type Run } from "@/lib/types";

/** A row of ai_usage: an AI task outside runs. */
type AiTask = { id: string; kind: string; model: string; tokens_in: number; tokens_out: number; cost_usd: number | string; detail: string; created_at: string };

const FUNNEL: { status: JobStatus; label: string; tone: Tone }[] = [
  { status: "new", label: "Waiting to be scored", tone: "muted" },
  { status: "scored", label: "Waiting in inbox", tone: "accent" },
  { status: "approved", label: "To apply", tone: "accent" },
  { status: "applied", label: "Applied", tone: "accent" },
  { status: "interview", label: "Interview", tone: "ok" },
  { status: "offer", label: "Offer", tone: "ok" },
  { status: "rejected", label: "Rejected", tone: "bad" },
  { status: "skipped", label: "Skipped", tone: "muted" },
  { status: "filtered", label: "Filtered out", tone: "muted" },
  { status: "closed", label: "Closed before action", tone: "muted" },
];

const BUCKETS: { label: string; min: number; max: number; tone: Tone }[] = [
  { label: "85–100", min: 85, max: 100, tone: "ok" },
  { label: "60–84", min: 60, max: 84, tone: "accent" },
  { label: "40–59", min: 40, max: 59, tone: "warn" },
  { label: "0–39", min: 0, max: 39, tone: "muted" },
];

/** Run-log filters. "Daily" covers the daily search and its digest. */
const RUN_FILTERS = {
  all: "All",
  daily: "Daily",
  watchlist: "Watchlist",
  failed: "Failed",
} as const;
type RunFilter = keyof typeof RUN_FILTERS;
const RUNS_PAGE = 20;

export default async function ReportPage({ searchParams }: PageProps<"/report">) {
  const { runs: runsParam, rn, member: memberParam } = await searchParams;
  const runFilter: RunFilter = typeof runsParam === "string" && runsParam in RUN_FILTERS ? (runsParam as RunFilter) : "all";
  const runLimit = Math.min(500, Math.max(RUNS_PAGE, Number(rn) || RUNS_PAGE));
  const supabase = await createClient();
  const me = await currentUser(supabase);
  // Whose report: your own, or (admin only) a member's, opened from Members or the summary.
  // A member's report shows their money (balance, spend, runs, AI tasks); their jobs and
  // decisions stay private. The admin's own report is the account's (all spend, top-ups).
  const viewing = me.isAdmin && typeof memberParam === "string" && memberParam !== me.id ? memberParam : null;
  const subjectId = viewing ?? me.id;
  const accountView = me.isAdmin && !viewing;
  const { data: viewedMember } = viewing ? await supabase.from("members").select("email").eq("user_id", viewing).maybeSingle() : { data: null };
  const runsHref = (q: { runs?: RunFilter; rn?: number }) => {
    const p = new URLSearchParams();
    if (viewing) p.set("member", viewing);
    if (q.runs && q.runs !== "all") p.set("runs", q.runs);
    if (q.rn) p.set("rn", String(q.rn));
    return `/report${p.size ? `?${p}` : ""}#runs`;
  };
  // Each run with the signed-in person's share of it (RLS: your own run_users rows); for a
  // member's report, only the runs that did something for them.
  let runsQuery = viewing
    ? supabase.from("runs").select("*, run_users!inner(user_id, stats)", { count: "exact" }).eq("run_users.user_id", viewing)
    : supabase.from("runs").select("*, run_users(user_id, stats)", { count: "exact" });
  if (runFilter === "daily") runsQuery = runsQuery.in("kind", ["full", "digest"]);
  if (runFilter === "watchlist") runsQuery = runsQuery.eq("kind", "watchlist");
  if (runFilter === "failed") runsQuery = runsQuery.not("error", "is", null);
  const counts = await Promise.all(
    FUNNEL.map(async (f) => {
      const { count } = await supabase.from("my_jobs").select("id", { count: "exact", head: true }).eq("status", f.status);
      return [f.status, count ?? 0] as const;
    }),
  );
  const { data: tzRow } = await supabase.from("settings").select("timezone").single();
  const timezone = (tzRow?.timezone as string | undefined) ?? "UTC";
  const [{ data: runRows, count: runTotal, error }, { data: scores }, { data: perDay }] = await Promise.all([
    runsQuery.order("started_at", { ascending: false }).limit(runLimit),
    supabase.from("my_jobs").select("score").not("score", "is", null).limit(10000),
    supabase.rpc("my_new_per_day", { p_days: 30, p_tz: timezone }),
  ]);
  const newPerDay = fillDays((perDay ?? []) as DayCount[], timezone);
  if (error) throw new Error(error.message);
  // The admin sees each run as a whole (all spend is theirs); everyone else sees their own share.
  // `mine` is the viewer's share either way: what reached them, was filtered, was scored.
  const runs = (runRows as (Run & { run_users: { user_id: string; stats: Run["stats"] }[] })[]).map((r) => {
    const mine = r.run_users.find((u) => u.user_id === subjectId)?.stats;
    return { ...(accountView ? r : { ...r, stats: mine ?? {} }), mine };
  }) as (Run & { mine?: Run["stats"] })[];
  const moreRuns = (runTotal ?? 0) > runs.length;

  const c = Object.fromEntries(counts) as Record<JobStatus, number>;
  const applied = c.applied + c.interview + c.offer + c.rejected;
  const responded = c.interview + c.offer;
  const tracked = Object.values(c).reduce((a, b) => a + b, 0);
  // API spend is recorded per run from the first run that tracks it; older runs show "–".
  const costed = runs.filter((r) => r.stats.cost_usd > 0);
  const totalCost = costed.reduce((a, r) => a + r.stats.cost_usd, 0);
  const funnelMax = Math.max(1, ...FUNNEL.map((f) => c[f.status]));
  const scoreList = (scores ?? []).map((s) => s.score as number);
  const bucketCounts = BUCKETS.map((b) => scoreList.filter((s) => s >= b.min && s <= b.max).length);
  const bucketMax = Math.max(1, ...bucketCounts);

  // Credits. The account (admin's own report): Anthropic top-ups minus everyone's spend.
  // A person's balance (a member's own report, or a member's opened by the admin): the
  // credit granted to them minus their own spend (their run shares and AI tasks).
  // (credit_entries.balance_usd holds the top-up amount; the name is historical.)
  const topUps: TopUp[] = accountView
    ? ((await supabase.from("credit_entries").select("id, entered_at, balance_usd").order("entered_at", { ascending: false })).data ?? []).map((e) => ({
        id: e.id,
        entered_at: e.entered_at,
        amount_usd: Number(e.balance_usd),
      }))
    : ((await supabase.from("credit_grants").select("id, created_at, amount_usd, note").eq("user_id", subjectId).order("created_at", { ascending: false })).data ?? []).map(
        (g) => ({ id: g.id, entered_at: g.created_at, amount_usd: Number(g.amount_usd), note: g.note as string }),
      );
  const firstTopUp = topUps.at(-1)?.entered_at;
  const since = firstTopUp ? new Date(dayStart(firstTopUp)).toISOString() : null;
  // Only runs that cost something: most watchlist checks cost $0, so this stays small as runs pile up.
  const { data: spendRows } = !since
    ? { data: [] }
    : accountView
      ? await supabase.from("runs").select("finished_at, stats").gte("finished_at", since).gt("stats->cost_usd", 0).limit(10000)
      : await supabase
          .from("run_users")
          .select("stats, runs!inner(finished_at)")
          .eq("user_id", subjectId)
          .gte("runs.finished_at", since)
          .gt("stats->cost_usd", 0)
          .limit(10000);
  // Other AI tasks (CV imports, drafts): everyone's on the account report, else the person's own.
  const taskQuery = supabase.from("ai_usage").select("*").order("created_at", { ascending: false }).limit(50);
  const { data: taskRows } = accountView ? await taskQuery : await taskQuery.eq("user_id", subjectId);
  const aiTasks = (taskRows ?? []) as AiTask[];
  // The credit chart subtracts runs and these tasks alike.
  type SpendRow = { finished_at?: string; stats: Record<string, number>; runs?: { finished_at: string } | { finished_at: string }[] };
  const finishedAt = (r: SpendRow) => r.finished_at ?? (Array.isArray(r.runs) ? r.runs[0]?.finished_at : r.runs?.finished_at);
  const costedRuns = [
    ...((spendRows ?? []) as SpendRow[])
      .filter((r) => finishedAt(r) && typeof r.stats?.cost_usd === "number")
      .map((r) => ({ at: finishedAt(r) as string, cost_usd: r.stats.cost_usd })),
    ...aiTasks.filter((t) => since && t.created_at >= since).map((t) => ({ at: t.created_at, cost_usd: Number(t.cost_usd) })),
  ];
  const now = nowMs();
  const series = buildSeries(topUps, costedRuns, now);
  const todayIso = new Date(now).toISOString().slice(0, 10);
  // The account report lists every member's balance, with a link to their report.
  const { data: balanceRows } = accountView
    ? await supabase.from("member_balances").select("user_id, email, is_admin, granted_usd, spent_usd, balance_usd").order("email")
    : { data: null };
  const balances = (balanceRows ?? []) as { user_id: string; email: string; is_admin: boolean; granted_usd: number; spent_usd: number; balance_usd: number }[];

  return (
    <>
      <PageHeader
        title={viewing ? `Report: ${viewedMember?.email ?? "member"}` : "Report"}
        meta={
          viewing ? (
            <>
              Their AI balance, spending and runs; their jobs and decisions stay private.{" "}
              <Link href="/report" className="link">
                ← Your report
              </Link>
            </>
          ) : (
            <>
              <span className="mono text-[var(--fg)]">{tracked}</span> listings tracked ·{" "}
              <span className="mono text-[var(--fg)]">{scoreList.length}</span> scored ·{" "}
              <span className="mono text-[var(--fg)]">{runTotal ?? 0}</span> {runFilter === "all" ? "runs" : `${RUN_FILTERS[runFilter].toLowerCase()} runs`}
            </>
          )
        }
      />

      <div className="space-y-10">
        {/* A member's report opened by the admin: money only (their jobs stay private). */}
        {!viewing && (
          <>
        <section className="panel grid grid-cols-2 divide-[var(--border)] max-sm:[&>*:nth-child(n+3)]:border-t sm:grid-cols-4 sm:divide-x [&>*]:border-[var(--border)] max-sm:[&>*:nth-child(even)]:border-l">
          <Stat label="Waiting" value={c.scored} unit="in inbox" />
          <Stat label="Applications" value={applied} unit="sent" />
          <Stat label="Responses" value={responded} unit="interview + offer" />
          <Stat label="Response rate" value={applied ? Math.round((responded / applied) * 100) : "–"} unit={applied ? "%" : undefined} />
        </section>

        <Panel title="New listings per day" aside={`last ${newPerDay.length} ${newPerDay.length === 1 ? "day" : "days"} · ${timezone.replace(/_/g, " ")}`}>
          <div className="p-3">
            {newPerDay.length ? <NewJobsChart days={newPerDay} /> : <Empty>No listings in the last 30 days.</Empty>}
          </div>
        </Panel>

        <div className="split">
          <Panel title="Funnel" aside="all time">
            <ul className="space-y-3 p-3">
              {FUNNEL.map((f) => (
                <li key={f.status} className="grid grid-cols-[150px_1fr_48px] items-center gap-3 text-[13px]">
                  <span className="muted truncate">{f.label}</span>
                  <Bar value={(c[f.status] / funnelMax) * 100} tone={f.tone} />
                  <span className="mono text-right">{c[f.status]}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Fit scores" aside={`${scoreList.length} scored`}>
            <ul className="space-y-3 p-3">
              {BUCKETS.map((b, i) => (
                <li key={b.label} className="grid grid-cols-[56px_1fr_40px] items-center gap-3 text-[13px]">
                  <span className="mono muted">{b.label}</span>
                  <Bar value={(bucketCounts[i] / bucketMax) * 100} tone={b.tone} />
                  <span className="mono text-right">{bucketCounts[i]}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
          </>
        )}

        {/* The account's credit (admin's own report) or a person's AI balance. */}
        <section>
          <SectionHeader title="Credits" />
          <div className="split">
            <Panel
              title={accountView ? "Remaining API credit" : viewing ? "Their AI balance" : "Your AI balance"}
              aside={series?.perDay ? `trend: last ${Math.round(series.windowDays)}d` : undefined}
            >
              {series ? (
                <>
                  <div className="px-2 pt-3 pb-1">
                    <CreditChart points={series.points} zeroAt={series.zeroAt} now={now} />
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-[var(--border)] border-t border-[var(--border)]">
                    <Stat small label="Remaining" value={formatUsd(series.current)} />
                    <Stat small label="Burn rate" value={series.perDay ? formatUsd(series.perDay) : "–"} unit={series.perDay ? "/ day" : undefined} />
                    <Stat
                      small
                      label="Runs out"
                      value={
                        series.zeroAt
                          ? new Date(series.zeroAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
                          : "–"
                      }
                    />
                  </div>
                </>
              ) : (
                <Empty>
                  {accountView
                    ? "Add your first top-up to start tracking."
                    : viewing
                      ? "No credit granted yet: add some on the Members page."
                      : "No AI credit yet: the admin grants it. Until then, nothing gets scored."}
                </Empty>
              )}
            </Panel>

            {accountView ? (
            <Panel title="Top-ups">
              <form action={addCreditEntry} className="flex gap-1.5 border-b border-[var(--border)] p-3">
                <input name="date" type="date" defaultValue={todayIso} max={todayIso} className="input mono min-w-0 flex-1" />
                <input name="amount" inputMode="decimal" required placeholder="$5.00" className="input mono w-20" />
                <SubmitButton className="btn-primary" done="Added">Add</SubmitButton>
              </form>
              {topUps.length === 0 ? (
                <Empty>No top-ups yet.</Empty>
              ) : (
                <ul className="divide">
                  {topUps.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                      <span className="mono muted flex-1">
                        {new Date(e.entered_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
                      </span>
                      <span className="mono text-right text-[13px]">+${e.amount_usd.toFixed(2)}</span>
                      <form action={deleteCreditEntry}>
                        <input type="hidden" name="id" value={e.id} />
                        <SubmitButton className="btn-ghost btn-danger text-[12px]" aria-label="Delete top-up">
                          ✕
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            ) : (
            // A person's credit comes from the admin (Members page); listed here read-only.
            <Panel title="Credit granted" aside={viewing ? <Link href="/admin" className="link font-sans text-[12px] normal-case tracking-normal">Add on Members →</Link> : undefined}>
              {topUps.length === 0 ? (
                <Empty>None yet.</Empty>
              ) : (
                <ul className="divide">
                  {topUps.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                      <span className="mono muted">
                        {new Date(e.entered_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
                      </span>
                      <span className="faint min-w-0 flex-1 truncate">{(e as TopUp & { note?: string }).note}</span>
                      <span className="mono text-right text-[13px]">
                        {e.amount_usd < 0 ? "−" : "+"}${Math.abs(e.amount_usd).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            )}
          </div>
        </section>

        {/* The account report: every member's balance, with their report. */}
        {accountView && balances.length > 0 && (
          <section>
            <SectionHeader title="Members" count={balances.length} actions={<span className="faint">AI balances on your key</span>} />
            <Panel>
              <div className="md:overflow-x-auto">
                <table className="table table-stack max-md:block md:min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th className="w-28 text-right">Granted</th>
                      <th className="w-28 text-right">Spent</th>
                      <th className="w-28 text-right">Balance</th>
                      <th className="w-24" />
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b) => (
                      <tr key={b.user_id}>
                        <td className="text-[13px] max-md:w-full">
                          {b.email}
                          {b.is_admin && <span className="faint text-[12px]"> · you (the account)</span>}
                        </td>
                        <td className="mono text-right text-[12px]" data-label="Granted">
                          {b.is_admin ? "–" : formatUsd(Number(b.granted_usd))}
                        </td>
                        <td className="mono text-right text-[12px]" data-label="Spent">
                          {formatUsd(Number(b.spent_usd))}
                        </td>
                        <td
                          className={`mono text-right text-[12px] ${!b.is_admin && Number(b.balance_usd) <= 0 ? "text-[var(--bad)]" : ""}`}
                          data-label="Balance"
                        >
                          {b.is_admin ? "–" : formatUsd(Number(b.balance_usd))}
                        </td>
                        <td className="text-right text-[12px]">
                          {!b.is_admin && (
                            <Link href={`/report?member=${b.user_id}`} className="link">
                              Report →
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>
        )}

        <section id="runs" className="scroll-mt-6">
          <SectionHeader
            title="Runs"
            count={runTotal ?? 0}
            actions={
              <Segmented
                options={(Object.keys(RUN_FILTERS) as RunFilter[]).map((f) => ({
                  href: runsHref({ runs: f }),
                  label: RUN_FILTERS[f],
                  active: f === runFilter,
                }))}
              />
            }
          />
          <Panel>
            {runs.length === 0 ? (
              <Empty>{runFilter === "all" ? "No runs yet." : "No runs match this filter."}</Empty>
            ) : (
              <div className="md:overflow-x-auto">
                <table className="table table-stack max-md:block md:min-w-[640px]">
                  <thead>
                    <tr>
                      <th className="w-24">When</th>
                      <th className="w-24">Kind</th>
                      <th className="w-20">Took</th>
                      <th className="w-24 text-right">Cost</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => {
                      const took = r.finished_at ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000) : null;
                      return (
                        <tr key={r.id}>
                          <td className="mono muted text-[12px] max-md:order-2" title={new Date(r.started_at).toLocaleString()}>
                            {agoText(r.started_at)}
                          </td>
                          <td className="max-md:order-1">
                            <span className="inline-flex items-center gap-2">
                              <Dot tone={r.error ? "bad" : r.finished_at ? "ok" : "warn"} />
                              {r.kind}
                            </span>
                          </td>
                          <td className="mono muted text-[12px] max-md:order-3" data-label="Took">{took == null ? "…" : took < 60 ? `${took}s` : `${Math.round(took / 60)}m`}</td>
                          <td
                            className="mono text-right text-[12px] max-md:order-4 max-md:ml-auto"
                            title={
                              r.stats.cost_estimated
                                ? "Estimated: this run predates cost tracking"
                                : r.stats.cost_usd > 0
                                  ? `${r.stats.tokens_in ?? 0} tokens in, ${r.stats.tokens_out ?? 0} out`
                                  : !r.finished_at
                                    ? "Still running"
                                    : r.kind === "digest"
                                      ? "Digests don't use AI"
                                      : typeof r.stats.cost_usd === "number"
                                        ? "Nothing new to score, so no AI was used"
                                        : "Not recorded for this run"
                            }
                          >
                            {/* Only runs that used AI show a cost; the rest (digests, nothing to score) a dash. */}
                            {r.stats.cost_usd > 0 ? formatRunCost(r.stats.cost_usd) : <span className="faint">–</span>}
                          </td>
                          <td className="text-[12px] max-md:order-5 max-md:w-full md:max-w-0">
                            {r.error ? (
                              <ErrorDetails error={r.error} />
                            ) : !r.finished_at ? (
                              <span className="muted">running…</span>
                            ) : (
                              <RunResult run={r} mine={r.mine} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {(moreRuns || costed.length > 0) && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2.5 text-[12px]">
                <span className="faint">
                  Showing <span className="mono">{runs.length}</span> of <span className="mono">{runTotal ?? 0}</span>
                  {costed.length > 0 && (
                    <>
                      {" "}
                      · API spend <span className="mono text-[var(--fg)]">{formatUsd(totalCost)}</span> across these
                    </>
                  )}
                </span>
                {moreRuns && (
                  <Link href={runsHref({ runs: runFilter, rn: runLimit + RUNS_PAGE })} scroll={false} className="btn">
                    Show {RUNS_PAGE} more
                    <PendingBar />
                  </Link>
                )}
              </div>
            )}
          </Panel>
        </section>

        <section id="ai-tasks" className="scroll-mt-6">
          <SectionHeader title="Other AI tasks" count={aiTasks.length} actions={<span className="faint">AI spend outside runs: CV imports, drafts</span>} />
          <Panel>
            {aiTasks.length === 0 ? (
              <Empty>None yet. CV imports and CV or cover letter drafts show up here with their cost.</Empty>
            ) : (
              <div className="md:overflow-x-auto">
                <table className="table table-stack max-md:block md:min-w-[560px]">
                  <thead>
                    <tr>
                      <th className="w-24">When</th>
                      <th>Task</th>
                      <th className="w-28">Model</th>
                      <th className="w-32 text-right">Tokens</th>
                      <th className="w-24 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiTasks.map((t) => (
                      <tr key={t.id}>
                        <td className="mono muted text-[12px]" title={new Date(t.created_at).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"}>
                          {agoText(t.created_at)}
                        </td>
                        <td className="text-[13px] max-md:w-full">
                          {AI_TASKS[t.kind] ?? t.kind}
                          {t.detail && <span className="mono faint text-[12px]"> · {t.detail}</span>}
                        </td>
                        <td className="muted text-[12px]" data-label="Model">
                          {(SCORING_MODELS.find((m) => m.id === t.model)?.label ?? t.model).replace("Claude ", "")}
                        </td>
                        <td className="mono muted text-right text-[12px]" data-label="Tokens">
                          {n(t.tokens_in)} in · {n(t.tokens_out)} out
                        </td>
                        <td className="mono text-right text-[12px]" data-label="Cost">
                          {formatRunCost(Number(t.cost_usd))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {aiTasks.length > 0 && (
              <div className="border-t border-[var(--border)] px-3 py-2.5 text-[12px]">
                <span className="faint">
                  Total <span className="mono text-[var(--fg)]">{formatUsd(aiTasks.reduce((a, t) => a + Number(t.cost_usd), 0))}</span> across these
                </span>
              </div>
            )}
          </Panel>
        </section>
      </div>
    </>
  );
}

/** Labels for ai_usage kinds. */
const AI_TASKS: Record<string, string> = {
  career_import: "CV import into the career",
  cv_draft: "CV draft",
  cover_letter: "Cover letter draft",
};

/** Bookkeeping counters, shown under "details" (with their labels), in this order. */
const RUN_DETAILS: [key: string, label: string][] = [
  ["sources", "sources checked"],
  ["fetched", "listings fetched"],
  ["duplicates", "duplicates skipped"],
  ["adopted", "taken over from aggregators"],
  ["described", "descriptions fetched"],
  ["described_later", "descriptions fetched"],
  ["stale", "stale postings skipped"],
  ["closed", "closed"],
  ["filtered_later", "filtered once described"],
  ["follow_ups", "follow-ups"],
  ["status_changes", "status changes"],
  ["tokens_in", "tokens in"],
  ["tokens_out", "tokens out"],
];

const n = (v: number) => v.toLocaleString("en");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

/**
 * A run's result as one line, the same funnel as the rest of the app:
 * "2,258 new → 189 passed filters → 60 scored". The funnel is the viewer's own share
 * (`mine`: what reached them, was filtered out, was scored for them); runs from before
 * shares were recorded fall back to the run's own counters. Problems (failed sources,
 * scoring errors) show as badges; the bookkeeping counters open under a chevron.
 */
function RunResult({ run, mine }: { run: Run; mine?: Run["stats"] }) {
  const s = run.stats;
  const f = mine ?? s;
  const steps: string[] = [];
  if (run.kind === "digest") {
    const parts = [s.new_matches && plural(s.new_matches, "new match", "new matches"), s.follow_ups && plural(s.follow_ups, "follow-up")].filter(Boolean);
    steps.push(s.emailed ? `Emailed${parts.length ? `: ${parts.join(", ")}` : ""}` : "Nothing to email");
  } else {
    const arrived = mine ? f.matched : s.inserted;
    if (arrived) {
      steps.push(`${n(arrived)} new`);
      // "Passed" isn't recorded: it's new minus filtered out (unknown on old runs without either).
      if (mine || typeof s.filtered === "number") steps.push(`${n(Math.max(0, arrived - (f.filtered ?? 0)))} passed filters`);
    }
    if (f.scored) steps.push(`${n(f.scored)} scored`);
    if (f.alerted ?? s.alerted) steps.push(plural(f.alerted ?? s.alerted, "alert") + " sent");
  }
  const line = steps.length ? steps.join(" → ") : run.kind === "watchlist" ? "No new listings" : "Nothing to do";
  const details = RUN_DETAILS.filter(([k]) => s[k]).map(([k, label]) => `${n(s[k])} ${label}`);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {details.length ? (
        <details className="group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span>{line}</span>{" "}
            <IconChevronDown width={10} height={10} className="faint inline transition-transform group-open:rotate-180" />
          </summary>
          <p className="mono faint mt-1 text-[11px]">{details.join(" · ")}</p>
        </details>
      ) : (
        <span>{line}</span>
      )}
      {s.errors > 0 && (
        <Link href="/sources" className="pill pill-bad" title="The failing sources are marked on the Sources page">
          {plural(s.errors, "source")} failed
        </Link>
      )}
      {s.score_errors > 0 && <Pill tone="warn">{plural(s.score_errors, "scoring error")}</Pill>}
    </div>
  );
}

/**
 * Every day from the first with listings through today (in `timezone`), with 0 for days
 * nothing came in: the counts only list days that had some.
 */
function fillDays(rows: DayCount[], timezone: string): DayCount[] {
  if (!rows.length) return [];
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()); // YYYY-MM-DD
  const out: DayCount[] = [];
  for (let d = new Date(`${rows[0].day}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const r = byDay.get(day);
    out.push({ day, passed: Number(r?.passed ?? 0), filtered: Number(r?.filtered ?? 0) });
    if (day >= today || out.length >= 30) break;
  }
  return out;
}
