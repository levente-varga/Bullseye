import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ErrorDetails } from "@/components/ErrorDetails";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { ATS_BOARD_URL } from "@/lib/ats";
import { Dot, Empty, PageHeader, Panel, Pill, SectionHeader } from "@/components/ui";
import { agoText, pad2 } from "@/lib/time";
import { ATS_INFO, type Ats, type Source, type SourceSuggestion } from "@/lib/types";
import { acceptSuggestion, addSource, deleteSource, dismissSuggestion, updateSource } from "../actions";

/** "Greenhouse, Lever, … and Jobylon": the company job systems auto-detect recognises. */
const COMPANY_SYSTEM_NAMES = (() => {
  const names = (Object.keys(ATS_INFO) as Ats[]).filter((a) => !ATS_INFO[a].aggregator).map((a) => ATS_INFO[a].label);
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
})();
/** "Platsbanken, Himalayas, Jobindex and jobs.ch" */
const SEARCHABLE_NAMES = (() => {
  const names = (Object.keys(ATS_INFO) as Ats[]).filter((a) => ATS_INFO[a].searchable).map((a) => ATS_INFO[a].defaultName ?? a);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
})();

export default async function SourcesPage({ searchParams }: PageProps<"/sources">) {
  const sp = await searchParams;
  const sort = parseSort(sp.sort, sp.dir);
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
  const sorted = sortSources(sources, sort, open);
  const boards = sorted.filter((s) => !ATS_INFO[s.ats]?.aggregator);
  const aggregators = sorted.filter((s) => ATS_INFO[s.ats]?.aggregator);
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
              <Empty>No company boards yet. Paste a careers page below, or pick from the suggestions.</Empty>
            ) : (
              <SourceTable rows={boards} open={open} sort={sort} />
            )}
          </Panel>
          <div id="add" className="scroll-mt-6">
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
          </div>
          {/* Auto-detect finds the job system and board from any careers page or posting link. */}
          <form action={addSource} className="panel mt-3 flex flex-wrap items-end gap-3 p-3">
            <input type="hidden" name="ats" value="auto" />
            <label className="field min-w-[240px] flex-[3]">
              <span className="label">Add a careers page or job posting</span>
              <input name="slug" required className="input mono" placeholder="https://career.paradoxplaza.com" />
            </label>
            <label className="field min-w-[160px] flex-1">
              <span className="label">Company name</span>
              <input name="company_name" className="input" placeholder="Guessed if empty" />
            </label>
            <SubmitButton className="btn-primary btn-field">Add board</SubmitButton>
            <p className="hint w-full">Works with {COMPANY_SYSTEM_NAMES}.</p>
          </form>
        </section>

        <section id="aggregators" className="scroll-mt-6">
          <SectionHeader title="Aggregators" count={aggregators.length} />
          {typeof sp.followed === "string" && (
            <Notice key={crypto.randomUUID()} tone="ok" params={["followed"]}>
              Following {sp.followed}. Its listings arrive with the next daily run.
            </Notice>
          )}
          <Panel>
            {aggregators.length === 0 ? (
              <Empty>No aggregators yet.</Empty>
            ) : (
              <SourceTable rows={aggregators} open={open} sort={sort} aggregators />
            )}
          </Panel>
          <p className="faint mt-2 text-[12px]">
            {SEARCHABLE_NAMES} are searched for your target roles; the others are read whole.
          </p>
          {missingAggregators.length > 0 && (
            <details className="group mt-4" open={aggregators.length === 0}>
              <summary className="link mb-2 cursor-pointer list-none text-[13px] [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Browse {missingAggregators.length} more aggregators</span>
                <span className="hidden group-open:inline">Hide the catalog</span>
              </summary>
              <Panel>
                <ul className="divide">
                  {missingAggregators.map((a) => (
                    <li key={a} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-[13px]">
                      <div className="min-w-0 flex-1">
                        <a href={ATS_BOARD_URL[a]("")} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                          {ATS_INFO[a].defaultName}
                        </a>
                        <span className="muted"> · {ATS_INFO[a].blurb}</span>
                        {ATS_INFO[a].searchable && <span className="faint"> · searched for your target roles</span>}
                      </div>
                      <form action={addSource}>
                        <input type="hidden" name="ats" value={a} />
                        <input type="hidden" name="slug" value="" />
                        <SubmitButton className="btn" done="Following">
                          Follow
                        </SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              </Panel>
            </details>
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

      </div>
    </>
  );
}

/** One table of sources (company boards or aggregators), with health, counts and actions. */
function SourceTable(props: { rows: Source[]; open: Record<string, number>; sort: Sort; aggregators?: boolean }) {
  return (
    <div className="md:overflow-x-auto">
      <table className="table table-stack max-md:block md:min-w-[720px]">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <SortHeader sort={props.sort} by="name">Source</SortHeader>
            {/* An aggregator's type is its name: no column for it. */}
            {!props.aggregators && (
              <SortHeader sort={props.sort} by="type" className="w-40">
                Type
              </SortHeader>
            )}
            <SortHeader sort={props.sort} by="open" className="w-20" right>
              Open
            </SortHeader>
            <SortHeader sort={props.sort} by="checked" className="w-28">
              Checked
            </SortHeader>
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
                    <SubmitButton className="btn">Unfollow</SubmitButton>
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

// --- Sorting -----------------------------------------------------------------
// Click a column header to sort both tables by it; click again to reverse. Kept in the
// URL (?sort=open&dir=desc), so it survives reloads and needs no client code.

type SortKey = "name" | "type" | "open" | "checked";
type Sort = { by: SortKey; dir: "asc" | "desc" };
const SORT_KEYS: SortKey[] = ["name", "type", "open", "checked"];
/** Numbers and dates read best largest/newest first; names A to Z. */
const FIRST_DIR: Record<SortKey, Sort["dir"]> = { name: "asc", type: "asc", open: "desc", checked: "desc" };

function parseSort(by: unknown, dir: unknown): Sort {
  const key = SORT_KEYS.includes(by as SortKey) ? (by as SortKey) : "open"; // most open listings first
  return { by: key, dir: dir === "asc" || dir === "desc" ? dir : FIRST_DIR[key] };
}

function sortSources(rows: Source[], sort: Sort, open: Record<string, number>): Source[] {
  const value = (s: Source): string | number => {
    switch (sort.by) {
      case "name":
        return s.company_name.toLowerCase();
      case "type":
        return (ATS_INFO[s.ats]?.label ?? s.ats).toLowerCase();
      case "open":
        return open[s.id] ?? 0;
      case "checked":
        return s.last_checked_at ? Date.parse(s.last_checked_at) : 0; // never checked sorts as oldest
    }
  };
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    // Ties keep a stable, readable order: by name.
    return c * sign || a.company_name.localeCompare(b.company_name);
  });
}

/** A column header that sorts by its column; the active one shows an arrow. */
function SortHeader(props: { sort: Sort; by: SortKey; className?: string; right?: boolean; children: string }) {
  const active = props.sort.by === props.by;
  const dir = active ? (props.sort.dir === "asc" ? "desc" : "asc") : FIRST_DIR[props.by];
  const href = `/sources?${new URLSearchParams({ sort: props.by, dir })}`;
  return (
    <th
      className={`${props.className ?? ""} ${props.right ? "text-right" : ""}`}
      aria-sort={active ? (props.sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <Link href={href} scroll={false} className={`inline-flex items-center gap-1 hover:text-[var(--fg)] ${active ? "text-[var(--fg)]" : ""}`}>
        {props.children}
        <span aria-hidden className={active ? "" : "invisible"}>
          {props.sort.dir === "asc" ? "↑" : "↓"}
        </span>
      </Link>
    </th>
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
