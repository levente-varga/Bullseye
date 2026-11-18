import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ErrorDetails } from "@/components/ErrorDetails";
import { PendingBar } from "@/components/PendingBar";
import { Segmented } from "@/components/Segmented";
import { SubmitButton } from "@/components/SubmitButton";
import { CreditChart } from "@/components/CreditChart";
import { Bar, Dot, Empty, PageHeader, Panel, SectionHeader, Stat, type Tone } from "@/components/ui";
import { buildSeries, dayStart, type TopUp } from "@/lib/credits";
import { formatRunCost, formatUsd } from "@/lib/pricing";
import { agoText, nowMs } from "@/lib/time";
import { addCreditEntry, deleteCreditEntry } from "../actions";
import type { JobStatus, Run } from "@/lib/types";

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
  const { runs: runsParam, rn } = await searchParams;
  const runFilter: RunFilter = typeof runsParam === "string" && runsParam in RUN_FILTERS ? (runsParam as RunFilter) : "all";
  const runLimit = Math.min(500, Math.max(RUNS_PAGE, Number(rn) || RUNS_PAGE));
  const runsHref = (q: { runs?: RunFilter; rn?: number }) => {
    const p = new URLSearchParams();
    if (q.runs && q.runs !== "all") p.set("runs", q.runs);
    if (q.rn) p.set("rn", String(q.rn));
    return `/report${p.size ? `?${p}` : ""}#runs`;
  };
  const supabase = await createClient();
  let runsQuery = supabase.from("runs").select("*", { count: "exact" });
  if (runFilter === "daily") runsQuery = runsQuery.in("kind", ["full", "digest"]);
  if (runFilter === "watchlist") runsQuery = runsQuery.eq("kind", "watchlist");
  if (runFilter === "failed") runsQuery = runsQuery.not("error", "is", null);
  const counts = await Promise.all(
    FUNNEL.map(async (f) => {
      const { count } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", f.status);
      return [f.status, count ?? 0] as const;
    }),
  );
  const [{ data: runRows, count: runTotal, error }, { data: scores }] = await Promise.all([
    runsQuery.order("started_at", { ascending: false }).limit(runLimit),
    supabase.from("jobs").select("score").not("score", "is", null).limit(10000),
  ]);
  if (error) throw new Error(error.message);
  const runs = runRows as Run[];
  const moreRuns = (runTotal ?? 0) > runs.length;

  const c = Object.fromEntries(counts) as Record<JobStatus, number>;
  const applied = c.applied + c.interview + c.offer + c.rejected;
  const responded = c.interview + c.offer;
  const tracked = Object.values(c).reduce((a, b) => a + b, 0);
  // API spend is recorded per run from the first run that tracks it; older runs show "–".
  const COST_KEYS = new Set(["cost_usd", "tokens_in", "tokens_out", "cost_estimated"]);
  const costed = runs.filter((r) => r.stats.cost_usd > 0);
  const totalCost = costed.reduce((a, r) => a + r.stats.cost_usd, 0);
  const funnelMax = Math.max(1, ...FUNNEL.map((f) => c[f.status]));
  const scoreList = (scores ?? []).map((s) => s.score as number);
  const bucketCounts = BUCKETS.map((b) => scoreList.filter((s) => s >= b.min && s <= b.max).length);
  const bucketMax = Math.max(1, ...bucketCounts);

  // Credits: top-ups minus recorded run costs from the day of the first top-up on.
  // (The column is still called balance_usd; it holds the top-up amount.)
  const { data: entryRows } = await supabase.from("credit_entries").select("id, entered_at, balance_usd").order("entered_at", { ascending: false });
  const topUps: TopUp[] = (entryRows ?? []).map((e) => ({ id: e.id, entered_at: e.entered_at, amount_usd: Number(e.balance_usd) }));
  const firstTopUp = topUps.at(-1)?.entered_at;
  const { data: spendRows } = firstTopUp
    ? // Only runs that cost something: most watchlist checks cost $0, so this stays small as runs pile up.
      await supabase
        .from("runs")
        .select("finished_at, stats")
        .gte("finished_at", new Date(dayStart(firstTopUp)).toISOString())
        .gt("stats->cost_usd", 0)
        .limit(10000)
    : { data: [] };
  const costedRuns = (spendRows ?? [])
    .filter((r) => r.finished_at && typeof r.stats?.cost_usd === "number")
    .map((r) => ({ at: r.finished_at as string, cost_usd: r.stats.cost_usd as number }));
  const now = nowMs();
  const series = buildSeries(topUps, costedRuns, now);
  const todayIso = new Date(now).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Report"
        meta={
          <>
            <span className="mono text-[var(--fg)]">{tracked}</span> listings tracked ·{" "}
            <span className="mono text-[var(--fg)]">{scoreList.length}</span> scored ·{" "}
            <span className="mono text-[var(--fg)]">{runTotal ?? 0}</span> {runFilter === "all" ? "runs" : `${RUN_FILTERS[runFilter].toLowerCase()} runs`}
          </>
        }
      />

      <div className="space-y-10">
        <section className="panel grid grid-cols-2 divide-[var(--border)] max-sm:[&>*:nth-child(n+3)]:border-t sm:grid-cols-4 sm:divide-x [&>*]:border-[var(--border)] max-sm:[&>*:nth-child(even)]:border-l">
          <Stat label="Waiting" value={c.scored} unit="in inbox" />
          <Stat label="Applications" value={applied} unit="sent" />
          <Stat label="Responses" value={responded} unit="interview + offer" />
          <Stat label="Response rate" value={applied ? Math.round((responded / applied) * 100) : "–"} unit={applied ? "%" : undefined} />
        </section>

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

        <section>
          <SectionHeader title="Credits" />
          <div className="split">
            <Panel title="Remaining API credit" aside={series?.perDay ? `trend: last ${Math.round(series.windowDays)}d` : undefined}>
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
                <Empty>Add your first top-up to start tracking.</Empty>
              )}
            </Panel>

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
          </div>
        </section>

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
              <Empty>{runFilter === "all" ? "No runs yet. The worker logs here every time it runs." : "No runs match this filter."}</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="table min-w-[640px]">
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
                          <td className="mono muted text-[12px]" title={new Date(r.started_at).toLocaleString()}>
                            {agoText(r.started_at)}
                          </td>
                          <td>
                            <span className="inline-flex items-center gap-2">
                              <Dot tone={r.error ? "bad" : r.finished_at ? "ok" : "warn"} />
                              {r.kind}
                            </span>
                          </td>
                          <td className="mono muted text-[12px]">{took == null ? "…" : took < 60 ? `${took}s` : `${Math.round(took / 60)}m`}</td>
                          <td
                            className="mono text-right text-[12px]"
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
                          <td className="max-w-0 text-[12px]">
                            {r.error ? (
                              <ErrorDetails error={r.error} />
                            ) : !r.finished_at ? (
                              <span className="muted">running…</span>
                            ) : (
                              <span className="mono muted">
                                {Object.entries(r.stats)
                                  .filter(([k, v]) => v && !COST_KEYS.has(k))
                                  .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
                                  .join(" · ") || "nothing to do"}
                              </span>
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
      </div>
    </>
  );
}
