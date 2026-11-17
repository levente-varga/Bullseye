import { createClient } from "@/lib/supabase/server";
import { ATS_BOARD_URL } from "@/lib/ats";
import { ATS_INFO, type Ats, type Source, type SourceSuggestion } from "@/lib/types";
import { acceptSuggestion, addSource, deleteSource, dismissSuggestion, updateSource } from "../actions";

export default async function SourcesPage() {
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="h1">Sources</h1>
        <p className="muted text-sm">
          Company job boards Headshot checks, plus aggregators that catch everything else. A posting found in two
          places is stored once: the company&apos;s own board wins because it has the full description. Watchlist
          companies are checked hourly and trigger an instant email.
        </p>
      </div>

      <form action={addSource} className="card space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[180px_1fr_1fr]">
          <label className="block space-y-1">
            <span className="label">Type</span>
            <select name="ats" className="input">
              {(Object.keys(ATS_INFO) as Ats[]).map((a) => (
                <option key={a} value={a}>
                  {ATS_INFO[a].label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="label">Board, domain or URL</span>
            <input name="slug" className="input" placeholder="e.g. career.paradoxplaza.com" />
          </label>
          <label className="block space-y-1">
            <span className="label">Company name</span>
            <input name="company_name" className="input" placeholder="Paradox" />
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block space-y-1">
            <span className="label">Country filter</span>
            <input name="country" className="input w-28" placeholder="se" maxLength={2} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="watchlist" /> Watchlist
          </label>
          <button className="btn-primary mb-0.5">Add source</button>
        </div>
        <details className="muted text-xs">
          <summary className="cursor-pointer">What goes in the board field?</summary>
          <ul className="mt-2 space-y-1">
            {(Object.keys(ATS_INFO) as Ats[]).map((a) => (
              <li key={a}>
                <b>{ATS_INFO[a].label}:</b>{" "}
                {ATS_INFO[a].aggregator ? "nothing, leave it empty" : <code>{ATS_INFO[a].slugExample}</code>}
              </li>
            ))}
            <li>The country filter (two letters, e.g. se) only applies to SmartRecruiters, whose boards are often global.</li>
          </ul>
        </details>
      </form>

      {addable.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Suggested direct sources</h2>
          <p className="muted text-sm">
            Seen on an aggregator. Adding them gets full descriptions and faster updates for these companies.
          </p>
          <ul className="card divide-y divide-[var(--border)]">
            {addable.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{s.company_name}</span>
                  <p className="muted text-sm">
                    {ATS_INFO[s.ats as Ats]?.label ?? s.ats} · {s.slug} · {s.job_count} open{" "}
                    {s.job_count === 1 ? "job" : "jobs"}
                  </p>
                </div>
                <form action={acceptSuggestion}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn-primary">Add</button>
                </form>
                <form action={dismissSuggestion}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn">Dismiss</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Your sources</h2>
        {sources.length === 0 ? (
          <p className="muted text-sm">No sources yet.</p>
        ) : (
          <ul className="card divide-y divide-[var(--border)]">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <a
                    href={ATS_BOARD_URL[s.ats](s.slug)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium hover:underline"
                  >
                    {s.company_name}
                  </a>
                  <p className="muted text-sm">
                    {ATS_INFO[s.ats]?.label ?? s.ats}
                    {!ATS_INFO[s.ats]?.aggregator && ` · ${s.slug}`}
                    {s.country && ` · ${s.country.toUpperCase()} only`} ·{" "}
                    {s.last_checked_at ? `checked ${new Date(s.last_checked_at).toLocaleString()}` : "never checked"}
                    {!s.enabled && " · paused"}
                  </p>
                  {s.last_error && <p className="text-sm text-red-600">Last error: {s.last_error}</p>}
                </div>
                <Toggle id={s.id} field="watchlist" on={s.watchlist} onLabel="★ Watchlist" offLabel="☆ Watch" />
                <Toggle id={s.id} field="enabled" on={s.enabled} onLabel="Pause" offLabel="Resume" />
                <form action={deleteSource}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn text-red-600">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {custom.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Covered by the aggregator only</h2>
          <p className="muted text-sm">
            These companies use their own career sites, which Headshot has no adapter for. Their jobs still arrive
            through the aggregator, with descriptions fetched from the original postings where possible.
          </p>
          <p className="muted text-sm">
            {custom.map((s) => `${s.company_name} (${s.job_count})`).join(" · ")}
          </p>
        </section>
      )}
    </div>
  );
}

function Toggle(props: { id: string; field: string; on: boolean; onLabel: string; offLabel: string }) {
  return (
    <form action={updateSource}>
      <input type="hidden" name="id" value={props.id} />
      <input type="hidden" name="field" value={props.field} />
      <input type="hidden" name="value" value={String(!props.on)} />
      <button className="btn">{props.on ? props.onLabel : props.offLabel}</button>
    </form>
  );
}
