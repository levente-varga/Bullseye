import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { ATS_BOARD_URL } from "@/lib/ats";
import { Dot, Empty, PageHeader, Panel, Pill, SectionHeader } from "@/components/ui";
import { agoText, pad2 } from "@/lib/time";
import { ATS_INFO, type Ats, type Source, type SourceSuggestion } from "@/lib/types";
import { acceptSuggestion, addSource, deleteSource, dismissSuggestion, updateSource } from "../actions";

export default async function SourcesPage({ searchParams }: PageProps<"/sources">) {
  const sp = await searchParams;
  const added = typeof sp.added === "string" ? sp.added : null;
  const addError = typeof sp.error === "string" ? sp.error : null;
  const supabase = await createClient();
  const [{ data, error }, { data: sugg }] = await Promise.all([
    supabase.from("sources").select("*").order("company_name"),
    supabase.from("source_suggestions").select("*").eq("status", "new").order("job_count", { ascending: false }),
  ]);
  if (error) throw new Error(error.message);
  const sources = data as Source[];
  const suggestions = (sugg ?? []) as SourceSuggestion[];
  const addable = suggestions.filter((s) => s.ats !== "custom");
  const custom = suggestions.filter((s) => s.ats === "custom");

  // Listings per source (open = new, scored or in the pipeline).
  const counts = await Promise.all(
    sources.map(async (s) => {
      const { count } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("source_id", s.id)
        .not("status", "in", "(closed,filtered)");
      return [s.id, count ?? 0] as const;
    }),
  );
  const open = Object.fromEntries(counts);

  const ok = sources.filter((s) => s.enabled && !s.last_error).length;
  const failing = sources.filter((s) => s.enabled && s.last_error).length;
  const paused = sources.filter((s) => !s.enabled).length;

  return (
    <>
      <PageHeader
        title="Sources"
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><Dot tone="ok" /><span className="mono text-[var(--fg)]">{ok}</span> healthy</span>
            {failing > 0 && <span className="inline-flex items-center gap-1.5"><Dot tone="bad" /><span className="mono text-[var(--fg)]">{failing}</span> failing</span>}
            {paused > 0 && <span className="inline-flex items-center gap-1.5"><Dot /><span className="mono text-[var(--fg)]">{paused}</span> paused</span>}
            <span className="faint">A posting found in two places is stored once; the company&apos;s own board wins.</span>
          </span>
        }
      />

      <div className="space-y-10">
        <section>
          <Panel>
            {sources.length === 0 ? (
              <Empty>No sources yet. Add one below, or pick from the suggestions.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="table min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>Source</th>
                      <th className="w-40">Type</th>
                      <th className="w-20 text-right">Open</th>
                      <th className="w-28">Checked</th>
                      <th className="w-64" />
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s, i) => (
                      <tr key={s.id} className={s.enabled ? "" : "opacity-55"}>
                        <td className="mono faint text-[12px]">{pad2(i + 1)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Dot tone={!s.enabled ? "muted" : s.last_error ? "bad" : s.last_checked_at ? "ok" : "warn"} />
                            <a href={ATS_BOARD_URL[s.ats](s.slug)} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                              {s.company_name}
                            </a>
                            {s.watchlist && <Pill tone="accent">Watchlist</Pill>}
                          </div>
                          {!ATS_INFO[s.ats]?.aggregator && (
                            <div className="mono faint mt-0.5 pl-3.5 text-[11px]">
                              {s.slug}
                              {s.country && ` · ${s.country.toUpperCase()} only`}
                            </div>
                          )}
                          {s.last_error && <div className="mt-1 pl-3.5 text-[12px] text-[var(--bad)]">{s.last_error}</div>}
                        </td>
                        <td>
                          <Pill tone={ATS_INFO[s.ats]?.aggregator ? "warn" : "muted"}>{ATS_INFO[s.ats]?.label ?? s.ats}</Pill>
                        </td>
                        <td className="mono text-right">{open[s.id]}</td>
                        <td className="mono muted text-[12px]">{s.last_checked_at ? agoText(s.last_checked_at) : "never"}</td>
                        <td>
                          <div className="flex justify-end gap-1.5">
                            <Toggle id={s.id} field="watchlist" on={s.watchlist} onLabel="Unwatch" offLabel="Watch" />
                            <Toggle id={s.id} field="enabled" on={s.enabled} onLabel="Pause" offLabel="Resume" />
                            <form action={deleteSource}>
                              <input type="hidden" name="id" value={s.id} />
                              <SubmitButton className="btn btn-danger">Remove</SubmitButton>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </section>

        {addable.length > 0 && (
          <section>
            <SectionHeader title="Suggested" count={addable.length} actions={<span className="faint">seen on an aggregator · adding gets full descriptions and hourly-ready updates</span>} />
            <Panel>
              <div className="overflow-x-auto">
                <table className="table min-w-[620px]">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>Company</th>
                      <th className="w-40">Type</th>
                      <th className="w-20 text-right">Jobs</th>
                      <th className="w-44" />
                    </tr>
                  </thead>
                  <tbody>
                    {addable.map((s, i) => (
                      <tr key={s.id}>
                        <td className="mono faint text-[12px]">{pad2(i + 1)}</td>
                        <td>
                          <div className="font-medium">{s.company_name}</div>
                          <div className="mono faint mt-0.5 text-[11px]">{s.slug}</div>
                        </td>
                        <td><Pill>{ATS_INFO[s.ats as Ats]?.label ?? s.ats}</Pill></td>
                        <td className="mono text-right">{s.job_count}</td>
                        <td>
                          <div className="flex justify-end gap-1.5">
                            <form action={acceptSuggestion}>
                              <input type="hidden" name="id" value={s.id} />
                              <SubmitButton className="btn-primary">Add</SubmitButton>
                            </form>
                            <form action={dismissSuggestion}>
                              <input type="hidden" name="id" value={s.id} />
                              <SubmitButton className="btn">Dismiss</SubmitButton>
                            </form>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            {custom.length > 0 && (
              <p className="faint mt-3 text-[12px] leading-relaxed">
                <span className="eyebrow mr-2">Aggregator only</span>
                {custom.map((s) => `${s.company_name} (${s.job_count})`).join(" · ")}. These use custom career sites with
                no adapter; their jobs still arrive through the aggregator.
              </p>
            )}
          </section>
        )}

        <section id="add" className="scroll-mt-6">
          <SectionHeader title="Add a source" />
          {added && (
            <div className="mb-3 flex items-center gap-2 border border-[var(--border)] bg-[var(--ok-tint)] px-3 py-2 text-[13px]">
              <Dot tone="ok" /> Added {added}
            </div>
          )}
          {addError && (
            <div className="mb-3 flex items-start gap-2 border border-[var(--border)] bg-[var(--bad-tint)] px-3 py-2 text-[13px]">
              <span className="pt-1.5"><Dot tone="bad" /></span> {addError}
            </div>
          )}
          <form action={addSource} className="panel">
            <div className="grid gap-3 p-3 sm:grid-cols-[200px_1fr_220px]">
              <label className="field">
                <span className="label">Type</span>
                <select name="ats" className="input" defaultValue="auto">
                  <option value="auto">Auto-detect from URL</option>
                  {(Object.keys(ATS_INFO) as Ats[]).map((a) => (
                    <option key={a} value={a}>{ATS_INFO[a].label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Careers page, job posting or board</span>
                <input name="slug" className="input mono" placeholder="https://career.paradoxplaza.com" />
              </label>
              <label className="field">
                <span className="label">Company name</span>
                <input name="company_name" className="input" placeholder="Guessed if empty" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t border-[var(--border)] px-3 py-2.5">
              <label className="flex items-center gap-2 text-[13px]">
                <span className="muted">Country</span>
                <input name="country" className="input mono w-16" placeholder="se" maxLength={2} />
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="watchlist" />
                <span className="muted">Watchlist (hourly + instant email)</span>
              </label>
              <SubmitButton className="btn-primary ml-auto">Add source</SubmitButton>
            </div>
            <details className="border-t border-[var(--border)] px-3 py-2.5 text-[12px]">
              <summary className="faint cursor-pointer">How does this work?</summary>
              <p className="muted mt-2 leading-relaxed">
                Companies publish their jobs through a job system (an ATS). Bullseye reads nine of them. With{" "}
                <b>Auto-detect</b>, paste the company&apos;s careers page or any of its job postings; Bullseye finds the
                system and the board itself. If it can&apos;t, pick the type by hand and enter the board:
              </p>
              <ul className="muted mt-2 grid gap-1 sm:grid-cols-2">
                {(Object.keys(ATS_INFO) as Ats[]).map((a) => (
                  <li key={a}>
                    {ATS_INFO[a].label}:{" "}
                    {ATS_INFO[a].aggregator ? <span className="faint">leave empty</span> : <code className="mono faint">{ATS_INFO[a].slugExample}</code>}
                  </li>
                ))}
                <li>The country filter (two letters) only applies to SmartRecruiters.</li>
              </ul>
            </details>
          </form>
        </section>
      </div>
    </>
  );
}

function Toggle(props: { id: string; field: string; on: boolean; onLabel: string; offLabel: string }) {
  return (
    <form action={updateSource}>
      <input type="hidden" name="id" value={props.id} />
      <input type="hidden" name="field" value={props.field} />
      <input type="hidden" name="value" value={String(!props.on)} />
      <SubmitButton className="btn">{props.on ? props.onLabel : props.offLabel}</SubmitButton>
    </form>
  );
}
