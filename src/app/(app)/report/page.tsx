import { createClient } from "@/lib/supabase/server";
import { CreditChart } from "@/components/CreditChart";
import { Bar, Dot, Empty, PageHeader, Panel, SectionHeader, Stat, type Tone } from "@/components/ui";
import { buildSeries, type CreditEntry } from "@/lib/credits";
import { formatUsd } from "@/lib/pricing";
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

export default async function ReportPage() {
  const supabase = await createClient();
  const counts = await Promise.all(
    FUNNEL.map(async (f) => {
      const { count } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", f.status);
      return [f.status, count ?? 0] as const;
    }),
  );
  const [{ data: runs, error }, { data: scores }] = await Promise.all([
    supabase.from("runs").select("*").order("started_at", { ascending: false }).limit(30),
    supabase.from("jobs").select("score").not("score", "is", null).limit(10000),
  ]);
  if (error) throw new Error(error.message);

  const c = Object.fromEntries(counts) as Record<JobStatus, number>;
  const applied = c.applied + c.interview + c.offer + c.rejected;
  const responded = c.interview + c.offer;
  const tracked = Object.values(c).reduce((a, b) => a + b, 0);
  // API spend is recorded per run from the first run that tracks it; older runs show "–".
  const COST_KEYS = new Set(["cost_usd", "tokens_in", "tokens_out"]);
  const costed = (runs as Run[]).filter((r) => typeof r.stats.cost_usd === "number");
  const totalCost = costed.reduce((a, r) => a + r.stats.cost_usd, 0);
  const funnelMax = Math.max(1, ...FUNNEL.map((f) => c[f.status]));
  const scoreList = (scores ?? []).map((s) => s.score as number);
  const bucketCounts = BUCKETS.map((b) => scoreList.filter((s) => s >= b.min && s <= b.max).length);
  const bucketMax = Math.max(1, ...bucketCounts);

  // Credits: manual balance entries minus recorded run costs since the first entry.
  const { data: entryRows } = await supabase.from("credit_entries").select("*").order("entered_at", { ascending: false });
  const entries = (entryRows ?? []).map((e) => ({ ...e, balance_usd: Number(e.balance_usd) })) as CreditEntry[];
  const firstEntry = entries.at(-1)?.entered_at;
  const { data: spendRows } = firstEntry
    ? await supabase.from("runs").select("finished_at, stats").gte("finished_at", firstEntry).limit(5000)
    : { data: [] };
  const costedRuns = (spendRows ?? [])
    .filter((r) => r.finished_at && typeof r.stats?.cost_usd === "number")
    .map((r) => ({ at: r.finished_at as string, cost_usd: r.stats.cost_usd as number }));
  const now = nowMs();
  const series = buildSeries(entries, costedRuns, now);
  const todayIso = new Date(now).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Report"
        meta={
          <>
            <span className="mono text-[var(--fg)]">{tracked}</span> listings tracked ·{" "}
            <span className="mono text-[var(--fg)]">{scoreList.length}</span> scored ·{" "}
            <span className="mono text-[var(--fg)]">{(runs as Run[]).length}</span> recent runs
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

        <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
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
          <SectionHeader
            title="Credits"
            actions={
              series && (
                <span className="muted">
                  <span className="mono text-[var(--fg)]">{formatUsd(series.current)}</span> left
                  {series.perDay ? (
                    <>
                      {" "}· burning <span className="mono">{formatUsd(series.perDay)}</span>/day
                      {series.zeroAt && (
                        <>
                          {" "}· runs out ≈{" "}
                          <span className="mono text-[var(--fg)]">
                            {new Date(series.zeroAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    " · no spend recorded yet"
                  )}
                </span>
              )
            }
          />
          <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
            <Panel title="Remaining API credit" aside={series?.perDay ? `trend: last ${Math.round(series.windowDays)}d` : undefined}>
              {series ? (
                <div className="px-2 pt-3 pb-1">
                  <CreditChart points={series.points} zeroAt={series.zeroAt} now={now} />
                </div>
              ) : (
                <Empty>
                  Enter your current balance from the Anthropic Console to start tracking. The chart subtracts each
                  run&apos;s cost and projects when you&apos;ll hit $0.
                </Empty>
              )}
            </Panel>

            <Panel title="Balance entries">
              <form action={addCreditEntry} className="space-y-2 border-b border-[var(--border)] p-3">
                <div className="grid grid-cols-[1fr_96px] gap-1.5">
                  <input name="date" type="date" defaultValue={todayIso} max={todayIso} className="input mono" />
                  <input name="balance" inputMode="decimal" required placeholder="$5.00" className="input mono" />
                </div>
                <input name="note" placeholder="Note, e.g. top-up $5" className="input" />
                <button className="btn-primary w-full">Add balance</button>
                <p className="hint">The balance the Console shows after a top-up. Re-enter it anytime to correct drift.</p>
              </form>
              {entries.length === 0 ? (
                <Empty>No entries yet.</Empty>
              ) : (
                <ul className="divide">
                  {entries.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                      <span className="mono muted w-20 shrink-0">
                        {new Date(e.entered_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                      </span>
                      <span className="mono w-16 shrink-0 text-right text-[13px]">${e.balance_usd.toFixed(2)}</span>
                      <span className="faint min-w-0 flex-1 truncate">{e.note}</span>
                      <form action={deleteCreditEntry}>
                        <input type="hidden" name="id" value={e.id} />
                        <button className="btn-ghost btn-danger text-[12px]" aria-label="Delete entry">
                          ✕
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </section>

        <section>
          <SectionHeader
            title="Runs"
            count={(runs as Run[]).length}
            actions={
              costed.length > 0 && (
                <span className="muted">
                  API spend <span className="mono text-[var(--fg)]">{formatUsd(totalCost)}</span> over{" "}
                  <span className="mono">{costed.length}</span> {costed.length === 1 ? "run" : "runs"}
                </span>
              )
            }
          />
          <Panel>
            {(runs as Run[]).length === 0 ? (
              <Empty>No runs yet. The worker logs here every time it runs.</Empty>
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
                    {(runs as Run[]).map((r) => {
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
                              typeof r.stats.cost_usd === "number"
                                ? `${r.stats.tokens_in ?? 0} tokens in, ${r.stats.tokens_out ?? 0} out`
                                : "Not recorded for this run"
                            }
                          >
                            {typeof r.stats.cost_usd === "number" ? formatUsd(r.stats.cost_usd) : <span className="faint">–</span>}
                          </td>
                          <td className="text-[12px]">
                            {r.error ? (
                              <span className="text-[var(--bad)]">{r.error}</span>
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
          </Panel>
        </section>
      </div>
    </>
  );
}
