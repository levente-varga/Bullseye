import { createClient } from "@/lib/supabase/server";
import { ErrorDetails } from "@/components/ErrorDetails";
import { Notice } from "@/components/Notice";
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
    supabase.from("my_sources").select("*").order("company_name"),
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
        .from("my_jobs")
        .select("id", { count: "exact", head: true })
        .eq("source_id", s.id)
        .not("status", "in", "(closed,filtered)");
      return [s.id, count ?? 0] as const;
    }),
  );
  const open = Object.fromEntries(counts);

  // Healthy means fetched successfully; a source that hasn't been fetched yet is unknown, not healthy.
  // Company boards (one employer each) and aggregators (many employers) are listed apart.
  const boards = sources.filter((s) => !ATS_INFO[s.ats]?.aggregator);
  const aggregators = sources.filter((s) => ATS_INFO[s.ats]?.aggregator);
  // Aggregators not added yet: one click each, with their default search.
  const missingAggregators = (Object.keys(ATS_INFO) as Ats[]).filter(
    (a) => ATS_INFO[a].aggregator && !sources.some((s) => s.ats === a),
  );
  const ok = sources.filter((s) => s.enabled && !s.last_error && s.last_checked_at).length;
  const unchecked = sources.filter((s) => s.enabled && !s.last_error && !s.last_checked_at).length;
  const failing = sources.filter((s) => s.enabled && s.last_error).length;
  const paused = sources.filter((s) => !s.enabled).length;

  return (
    <>
      <PageHeader
        title="Sources"
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><Dot tone="ok" /><span className="mono text-[var(--fg)]">{ok}</span> healthy</span>
            {unchecked > 0 && <span className="inline-flex items-center gap-1.5"><Dot tone="warn" /><span className="mono text-[var(--fg)]">{unchecked}</span> not checked yet</span>}
            {failing > 0 && <span className="inline-flex items-center gap-1.5"><Dot tone="bad" /><span className="mono text-[var(--fg)]">{failing}</span> failing</span>}
            {paused > 0 && <span className="inline-flex items-center gap-1.5"><Dot /><span className="mono text-[var(--fg)]">{paused}</span> paused</span>}
          </span>
        }
      />

      <div className="space-y-10">
        <section>
          <SectionHeader title="Company boards" count={boards.length} />
          <Panel>
            {boards.length === 0 ? (
              <Empty>No company boards yet. Add one below, or pick from the suggestions.</Empty>
            ) : (
              <SourceTable rows={boards} open={open} />
            )}
          </Panel>
        </section>

        <section>
          <SectionHeader title="Aggregators" count={aggregators.length} />
          <Panel>
            {aggregators.length === 0 ? (
              <Empty>No aggregators yet.</Empty>
            ) : (
              <SourceTable rows={aggregators} open={open} aggregators />
            )}
          </Panel>
          {missingAggregators.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px]">
              {missingAggregators.map((a) => (
                <form key={a} action={addSource}>
                  <input type="hidden" name="ats" value={a} />
                  <input type="hidden" name="slug" value="" />
                  <SubmitButton className="btn" done="Added">
                    <span title={ATS_INFO[a].blurb}>+ {ATS_INFO[a].defaultName}</span>
                  </SubmitButton>
                </form>
              ))}
            </div>
          )}
        </section>

        {addable.length > 0 && (
          <section>
            <SectionHeader title="Suggested" count={addable.length} actions={<span className="faint">seen on an aggregator · adding gets full descriptions and hourly-ready updates</span>} />
            <Panel>
              <div className="md:overflow-x-auto">
                <table className="table table-stack max-md:block md:min-w-[620px]">
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
                        <td className="mono faint text-[12px] max-md:hidden">{pad2(i + 1)}</td>
                        <td className="max-md:w-full">
                          <div className="font-medium">{s.company_name}</div>
                          <div className="mono faint mt-0.5 text-[11px]">{s.slug}</div>
                        </td>
                        <td><Pill>{ATS_INFO[s.ats as Ats]?.label ?? s.ats}</Pill></td>
                        <td className="mono text-right" data-label="Jobs">{s.job_count}</td>
                        <td className="max-md:ml-auto">
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
                {custom.map((s) => `${s.company_name} (${s.job_count})`).join(" · ")}
              </p>
            )}
          </section>
        )}

        <section id="add" className="scroll-mt-6">
          <SectionHeader title="Add a source" />
          {added && (
            <Notice key={crypto.randomUUID()} tone="ok" params={["added", "error"]}>
              Added {added}
            </Notice>
          )}
          {addError && (
            <Notice key={crypto.randomUUID()} tone="bad" params={["added", "error"]}>
              {addError}
            </Notice>
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
                With <b>Auto-detect</b>, paste a careers page or any job posting. Otherwise pick the type and enter:
              </p>
              <ul className="muted mt-2 grid gap-1 sm:grid-cols-2">
                {(Object.keys(ATS_INFO) as Ats[]).map((a) => (
                  <li key={a}>
                    {ATS_INFO[a].label}:{" "}
                    {ATS_INFO[a].fixedSlug ? (
                      <span className="faint">leave empty</span>
                    ) : (
                      <>
                        <code className="mono faint">{ATS_INFO[a].slugExample}</code>
                        {a === "jobtech" && <span className="faint"> (or leave empty for IT + design jobs)</span>}
                        {a === "himalayas" && <span className="faint"> (or leave empty for “developer”)</span>}
                        {a === "weworkremotely" && <span className="faint"> (or empty for full-stack, “all” for everything)</span>}
                      </>
                    )}
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

/** One table of sources (company boards or aggregators), with health, counts and actions. */
function SourceTable(props: { rows: Source[]; open: Record<string, number>; aggregators?: boolean }) {
  return (
    <div className="md:overflow-x-auto">
      <table className="table table-stack max-md:block md:min-w-[720px]">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th>Source</th>
            {/* An aggregator's type is its name: no column for it. */}
            {!props.aggregators && <th className="w-40">Type</th>}
            <th className="w-20 text-right">Open</th>
            <th className="w-28">Checked</th>
            <th className="w-64" />
          </tr>
        </thead>
        <tbody>
          {props.rows.map((s, i) => (
            <tr key={s.id} className={s.enabled ? "" : "opacity-55"}>
              <td className="mono faint text-[12px] max-md:hidden">{pad2(i + 1)}</td>
              <td className="max-md:w-full">
                <div className="flex flex-wrap items-center gap-2">
                  <Dot
                    tone={!s.enabled ? "muted" : s.last_error ? "bad" : s.last_checked_at ? "ok" : "warn"}
                    title={
                      !s.enabled
                        ? "Paused"
                        : s.last_error
                          ? "Last fetch failed"
                          : s.last_checked_at
                            ? "Last fetch succeeded"
                            : "Not checked yet: fetched with the next daily run"
                    }
                  />
                  <a href={ATS_BOARD_URL[s.ats](s.slug)} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                    {s.company_name}
                  </a>
                  {s.watchlist && <Pill tone="accent">Watchlist</Pill>}
                  {s.enabled && s.last_error && <Pill tone="bad">Failing</Pill>}
                </div>
                {(!ATS_INFO[s.ats]?.aggregator || (!ATS_INFO[s.ats]?.fixedSlug && s.ats !== "jobtech")) && (
                  <div className="mono faint mt-0.5 pl-3.5 text-[11px]">
                    {s.slug}
                    {s.country && ` · ${s.country.toUpperCase()} only`}
                  </div>
                )}
                {s.last_error && (
                  <div className="mt-1 max-w-[520px] min-w-0 pl-3.5 text-[12px]">
                    <ErrorDetails error={s.last_error} />
                  </div>
                )}
              </td>
              {!props.aggregators && (
                <td>
                  <Pill tone={ATS_INFO[s.ats]?.aggregator ? "warn" : "muted"}>{(ATS_INFO[s.ats]?.label ?? s.ats).replace(" (aggregator)", "")}</Pill>
                </td>
              )}
              <td className="mono text-right" data-label="Open">{props.open[s.id]}</td>
              <td className="mono muted text-[12px]" data-label="Checked">{s.last_checked_at ? agoText(s.last_checked_at) : "never"}</td>
              <td className="max-md:w-full">
                <div className="flex flex-wrap gap-1.5 md:justify-end">
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
