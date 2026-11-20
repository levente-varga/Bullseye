import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ErrorDetailsText } from "@/components/ErrorDetails";
import { IconChevronDown, IconMinus, IconPause, IconPlay, IconPlus, IconStar } from "@/components/icons";
import { AddBoardForm } from "@/components/AddBoardForm";
import { Notice } from "@/components/Notice";
import { SourceName } from "@/components/SourceName";
import { SubmitButton } from "@/components/SubmitButton";
import { ATS_BOARD_URL } from "@/lib/ats";
import { Dot, Empty, PageHeader, Panel, Pill, SectionHeader } from "@/components/ui";
import { agoText, pad2 } from "@/lib/time";
import { ATS_INFO, FETCH_MODES, type Ats, type Source, type SourceSuggestion } from "@/lib/types";
import { acceptSuggestion, addSource, deleteSource, dismissSuggestion, updateSource } from "../actions";

/** The company job systems auto-detect recognises, A to Z (listed under the add form). */
const COMPANY_SYSTEM_NAMES = (Object.keys(ATS_INFO) as Ats[])
  .filter((a) => !ATS_INFO[a].aggregator)
  .map((a) => ATS_INFO[a].label)
  .sort((a, b) => a.localeCompare(b));

export default async function SourcesPage({ searchParams }: PageProps<"/sources">) {
  const sp = await searchParams;
  const sort = parseSort(sp.sort, sp.dir);
  const addError = typeof sp.error === "string" ? sp.error : null;
  const supabase = await createClient();
  const [{ data, error }, { data: sugg }, { data: settings }] = await Promise.all([
    supabase.from("my_sources").select("*").order("company_name"),
    supabase.from("source_suggestions").select("*").eq("status", "new").order("job_count", { ascending: false }),
    supabase.from("settings").select("watch_interval_minutes").single(),
  ]);
  const watchEvery = (settings?.watch_interval_minutes as number | undefined) ?? 0;
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

      {/* The add form sits beside the tables (sticky), so its result is in view without scrolling. */}
      <div className="split split-narrow">
      <div className="space-y-10">
        <section>
          <SectionHeader title="Company boards" count={boards.length} />
          <Panel>
            {boards.length === 0 ? (
              <Empty>No company boards yet. Paste a careers page into Add a board, or pick from the suggestions.</Empty>
            ) : (
              <SourceTable rows={boards} open={open} sort={sort} watchEvery={watchEvery} />
            )}
          </Panel>
        </section>

        <section id="aggregators" className="scroll-mt-6">
          <SectionHeader title="Aggregators" count={aggregators.length} />
          {typeof sp.followed === "string" && (
            <Notice key={crypto.randomUUID()} tone="ok" params={["followed"]}>
              Following {sp.followed}. Its listings arrive with the next daily run.
            </Notice>
          )}
          {addError && (
            <Notice key={crypto.randomUUID()} tone="bad" params={["error"]}>
              {addError}
            </Notice>
          )}
          <Panel>
            {aggregators.length === 0 ? (
              <Empty>No aggregators yet.</Empty>
            ) : (
              <SourceTable rows={aggregators} open={open} sort={sort} watchEvery={watchEvery} aggregators />
            )}
          </Panel>
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
                      <form action={addSource} title="Follow">
                        <input type="hidden" name="ats" value={a} />
                        <input type="hidden" name="slug" value="" />
                        <SubmitButton className="btn btn-icon" aria-label={`Follow ${ATS_INFO[a].defaultName}`}>
                          <IconPlus />
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
        {/* Full height, so the panel can stay in view while the page scrolls. The invisible
            heading lines the panel up with the top of the Company boards table. */}
        <aside className="max-xl:order-first xl:self-stretch">
          <div aria-hidden className="invisible max-xl:hidden">
            <SectionHeader title="Company boards" />
          </div>
          <div className="xl:sticky xl:top-6">
            {/* Auto-detect finds the job system and board from any careers page or posting link. */}
            <AddBoardForm systems={COMPANY_SYSTEM_NAMES} />
          </div>
        </aside>
      </div>
    </>
  );
}

/** One table of sources (company boards or aggregators), with health, counts and actions. */
function SourceTable(props: { rows: Source[]; open: Record<string, number>; sort: Sort; watchEvery: number; aggregators?: boolean }) {
  return (
    // No horizontal scroll: every cell wraps (names, slugs) or is fixed and small, and the
    // error opens as a popover, which a scrolling wrapper would clip.
    <div className="@container">
      <table className="table table-compact table-stack-lg @max-[30rem]:block">
        <thead>
          <tr>
            <SortHeader sort={props.sort} by="name" className="min-w-[6.5rem]">
              Source
            </SortHeader>
            {/* An aggregator's type is its name: no Type column for it. */}
            {!props.aggregators && (
              <SortHeader sort={props.sort} by="type" className="@max-[44rem]:hidden">
                Type
              </SortHeader>
            )}
            <SortHeader sort={props.sort} by="requests">
              Fetch
            </SortHeader>
            <SortHeader sort={props.sort} by="open" right>
              Open
            </SortHeader>
            <SortHeader sort={props.sort} by="checked">
              Checked
            </SortHeader>
            <th className="w-px" />
          </tr>
        </thead>
        <tbody>
          {props.rows.map((s) => (
            <tr key={s.id} className={`group ${s.enabled ? "" : "opacity-55"}`}>
              <td className="@max-[30rem]:w-full">
                {/* The dot stays beside the name; the name wraps between words (at least 7rem wide). */}
                <div className="flex min-w-[7rem] items-start gap-2">
                  <span className="flex h-[1lh] shrink-0 items-center">
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
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 [overflow-wrap:break-word]">
                      <SourceName id={s.id} name={s.company_name} href={ATS_BOARD_URL[s.ats](s.slug)} />
                      {s.enabled && s.last_error && <FailingBadge error={s.last_error} />}
                    </div>
                    {/* One line, cut with "…" (full text on hover). A fixed slug (aggregators, Apple)
                        says nothing, so only configured boards show theirs. When the Type column is
                        hidden (narrow table), the type leads this line. */}
                    {/* w-0 + min-w-full: fills the column without widening it (a one-line text
                        would otherwise count its full length toward the table's width). */}
                    <div className="mono faint mt-0.5 w-0 min-w-full truncate text-[11px]" title={ATS_INFO[s.ats]?.fixedSlug ? undefined : s.slug}>
                      {!props.aggregators && <span className="@min-[44rem]:hidden">{ATS_INFO[s.ats]?.label ?? s.ats}{!ATS_INFO[s.ats]?.fixedSlug && " · "}</span>}
                      {!ATS_INFO[s.ats]?.fixedSlug && s.slug}
                      {s.country && ` · ${s.country.toUpperCase()} only`}
                    </div>
                  </div>
                </div>
              </td>
              {!props.aggregators && (
                <td data-label="Type" className="@max-[44rem]:hidden">
                  <Pill tone="muted">{ATS_INFO[s.ats]?.label ?? s.ats}</Pill>
                </td>
              )}
              <td data-label="Fetch">
                <FetchCell source={s} />
              </td>
              <td className="mono text-right" data-label="Open">{props.open[s.id]}</td>
              <td className="mono muted text-[12px] whitespace-nowrap" data-label="Checked">{s.last_checked_at ? agoText(s.last_checked_at) : "never"}</td>
              {/* As narrow as its buttons, on one line: a long error under the name mustn't squeeze them. */}
              <td className="@max-[30rem]:w-full @min-[30rem]:w-px @min-[30rem]:whitespace-nowrap">
                <div className="flex flex-wrap gap-1 @min-[30rem]:flex-nowrap @min-[30rem]:justify-end">
                  <WatchToggle source={s} watchEvery={props.watchEvery} />
                  <Toggle
                    id={s.id}
                    field="enabled"
                    on={!s.enabled}
                    value={!s.enabled}
                    label={s.enabled ? "Pause" : "Resume"}
                    title={s.enabled ? "Pause: skip this source on fetches" : "Paused: click to resume"}
                    icon={s.enabled ? <IconPause /> : <IconPlay />}
                  />
                  <form action={deleteSource} title="Unfollow">
                    <input type="hidden" name="id" value={s.id} />
                    <SubmitButton className="btn btn-icon" aria-label={`Unfollow ${s.company_name}`}>
                      <IconMinus />
                    </SubmitButton>
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

type SortKey = "name" | "type" | "requests" | "open" | "checked";
type Sort = { by: SortKey; dir: "asc" | "desc" };
const SORT_KEYS: SortKey[] = ["name", "type", "requests", "open", "checked"];
/** Numbers and dates read best largest/newest first; names A to Z. */
const FIRST_DIR: Record<SortKey, Sort["dir"]> = { name: "asc", type: "asc", requests: "desc", open: "desc", checked: "desc" };

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
      case "requests":
        return s.last_request_count ?? -1; // not measured yet sorts as cheapest
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
        {/* Only the sorted column shows (and takes room for) its arrow. */}
        {active && <span aria-hidden>{props.sort.dir === "asc" ? "↑" : "↓"}</span>}
      </Link>
    </th>
  );
}

/**
 * An icon button that sets one subscription field. Its icon shows the state (a filled
 * star, a play icon); `on` is that state for screen readers, `value` what a click saves.
 * The label is for screen readers, the title for hover.
 */
function Toggle(props: { id: string; field: string; on: boolean; value: boolean; label: string; title: string; icon: ReactNode }) {
  return (
    <form action={updateSource} title={props.title}>
      <input type="hidden" name="id" value={props.id} />
      <input type="hidden" name="field" value={props.field} />
      <input type="hidden" name="value" value={String(props.value)} />
      <SubmitButton
        className="btn btn-icon"
        aria-label={props.label}
        aria-pressed={props.on}
      >
        {props.icon}
      </SubmitButton>
    </form>
  );
}

/**
 * The Failing badge; click it for the error. The error opens as a popover over the
 * table, so a long message never widens the Source column.
 */
function FailingBadge({ error }: { error: string }) {
  return (
    <details className="group relative">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden" title="Show the error">
        <Pill tone="bad">
          <span className="inline-flex items-center gap-0.5">
            Failing
            <IconChevronDown width={10} height={10} className="transition-transform group-open:rotate-180" />
          </span>
        </Pill>
      </summary>
      <div className="panel absolute top-full left-0 z-20 mt-1 w-[min(32rem,80vw)] p-2 shadow-lg">
        <ErrorDetailsText error={error} />
      </div>
    </details>
  );
}

/** How a source fetches, and how many requests its last fetch took. */
function FetchCell({ source }: { source: Source }) {
  const mode = FETCH_MODES[ATS_INFO[source.ats]?.fetch ?? "board"];
  const n = source.last_request_count;
  return (
    // One line in the card layout ("Paged · 275 requests"), two in the table.
    <div className="inline-flex gap-x-1.5 text-[12px] whitespace-nowrap @min-[30rem]:block" title={mode.how}>
      <div>{mode.label}</div>
      <div className="mono faint" title={n == null ? "Measured on its next fetch" : undefined}>
        {n == null ? "–" : `${n} ${n === 1 ? "request" : "requests"}`}
      </div>
    </div>
  );
}

/**
 * Watch, with what it costs at the watchlist interval. Paged and search sources can't be
 * watched (a few hundred requests every check); one watched before keeps its Unwatch.
 */
function WatchToggle({ source, watchEvery }: { source: Source; watchEvery: number }) {
  const mode = FETCH_MODES[ATS_INFO[source.ats]?.fetch ?? "board"];
  if (!mode.watchable && !source.watchlist) {
    return (
      <span title={`${mode.label} sources take too many requests to check at the watchlist interval.`}>
        <button type="button" className="btn btn-icon" disabled aria-label="Watch (not available)">
          <IconStar />
        </button>
      </span>
    );
  }
  const perDay = watchEvery > 0 && source.last_request_count != null ? Math.round((source.last_request_count * 1440) / watchEvery) : null;
  const title = source.watchlist
    ? "Watching: checked at the watchlist interval, strong matches emailed. Click to stop."
    : watchEvery === 0
      ? "Watch (the watchlist check is off in Criteria)"
      : `Watch: check at the watchlist interval and email strong matches${perDay != null ? ` (about ${perDay} requests a day)` : ""}`;
  return (
    <Toggle
      id={source.id}
      field="watchlist"
      on={source.watchlist}
      value={!source.watchlist}
      label={source.watchlist ? "Unwatch" : "Watch"}
      title={title}
      icon={<IconStar filled={source.watchlist} className={source.watchlist ? "text-[var(--accent-strong)]" : undefined} />}
    />
  );
}
