"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getJobDetails } from "@/app/(app)/actions";
import type { JobDetails } from "@/lib/types";
import { IconChevronDown, IconExternal } from "./icons";
import { ScoreChecks } from "./ScoreChecks";
import { Pill } from "./ui";

/**
 * A job row that opens to show the scorer's reasoning. Only the summary line
 * ships with the page; the reasoning is fetched the first time the row is
 * opened, which keeps long lists light. `side` fills the right column of the
 * opened row (e.g. the Inbox's skip form).
 */
export function ExpandableJobRow(props: {
  id: string;
  url: string;
  summaryClassName: string;
  summary: ReactNode;
  side?: ReactNode;
  /** Left padding of the opened panel on wide screens, to line up with the title column. */
  indent?: string;
  /** A full-width block under the reasoning (e.g. the Pipeline's drafts). Mounted when the row opens. */
  extra?: ReactNode;
  /** Changes when the reasoning does (e.g. scored_at after a re-score): an open row reloads it. */
  version?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ version?: string | null; details: JobDetails | null } | null>(null);
  const details = loaded && loaded.version === props.version ? loaded.details : undefined;

  useEffect(() => {
    if (!open || details !== undefined) return;
    let cancelled = false;
    const version = props.version;
    getJobDetails(props.id).then((d) => {
      if (!cancelled) setLoaded({ version, details: d });
    });
    return () => {
      cancelled = true;
    };
  }, [open, details, props.id, props.version]);

  return (
    <details className="group" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={props.summaryClassName}>{props.summary}</summary>
      {open && (
        <div
          className={`grid gap-5 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-4 ${props.side ? "lg:grid-cols-[1fr_320px]" : ""} ${props.indent ?? "lg:pl-[132px]"}`}
        >
          <div className="space-y-3">
            {details === undefined ? (
              <div aria-busy="true" className="space-y-2">
                <div className="skeleton h-4 w-11/12" />
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-4 w-2/3" />
              </div>
            ) : (
              <>
                {details?.score_checks?.length ? <ScoreChecks checks={details.score_checks} /> : null}
                {details?.score_summary && <p className="text-[13px] leading-relaxed">{details.score_summary}</p>}
                <div className="grid gap-3 text-[13px] sm:grid-cols-2">
                  <ul className="space-y-1">
                    {(details?.score_pros ?? []).map((p) => (
                      <li key={p} className="flex gap-2">
                        <span className="mono text-[var(--ok)]">+</span>
                        <span className="muted">{p}</span>
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-1">
                    {(details?.score_cons ?? []).map((c) => (
                      <li key={c} className="flex gap-2">
                        <span className="mono text-[var(--bad)]">−</span>
                        <span className="muted">{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <a href={props.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-[12px]">
                Open posting <IconExternal />
              </a>
              {/* Aggregator listings: whether the text came from the company's own posting or the aggregator. */}
              {details?.description_source && (
                <Pill tone="muted">
                  {details.description_source === "company" ? "Description from the company's page" : `Description from ${details.aggregator ?? "the aggregator"}`}
                </Pill>
              )}
            </div>
          </div>
          {props.side}
          {props.extra && <div className={`border-t border-[var(--border)] pt-4 ${props.side ? "lg:col-span-2" : ""}`}>{props.extra}</div>}
        </div>
      )}
    </details>
  );
}

/** The open/closed indicator of an expandable row: an arrow (down when closed, up when open), last in the button row. The row's <summary> does the toggling. */
export function ExpandToggle() {
  return (
    <span className="expand-indicator">
      <IconChevronDown className="transition-transform group-open:rotate-180" />
      <span className="sr-only">
        <span className="group-open:hidden">Show details</span>
        <span className="hidden group-open:inline">Hide details</span>
      </span>
    </span>
  );
}
