"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getJobDetails, skipJob } from "@/app/(app)/actions";
import { SKIP_REASONS, type JobDetails } from "@/lib/types";
import { IconExternal } from "./icons";
import { SubmitButton } from "./SubmitButton";

/**
 * An Inbox row. Only the summary line ships with the page; the scorer's
 * reasoning and the skip form are fetched and rendered the first time the row
 * is opened. Keeps "All scored" light no matter how many rows it has.
 */
export function ExpandableJobRow(props: { id: string; url: string; summaryClassName: string; summary: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<JobDetails | null | undefined>(undefined);

  useEffect(() => {
    if (!open || details !== undefined) return;
    let cancelled = false;
    getJobDetails(props.id).then((d) => {
      if (!cancelled) setDetails(d);
    });
    return () => {
      cancelled = true;
    };
  }, [open, details, props.id]);

  return (
    <details className="group" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={props.summaryClassName}>{props.summary}</summary>
      {open && (
        <div className="grid gap-5 border-t border-[var(--border)] bg-[var(--bg)] px-3 py-4 lg:grid-cols-[1fr_320px] lg:pl-[132px]">
          <div className="space-y-3">
            {details === undefined ? (
              <div aria-busy="true" className="space-y-2">
                <div className="skeleton h-4 w-11/12" />
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-4 w-2/3" />
              </div>
            ) : (
              <>
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
            <a href={props.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-[12px]">
              Open posting <IconExternal />
            </a>
          </div>

          <form action={skipJob} className="space-y-2.5">
            <input type="hidden" name="id" value={props.id} />
            <div className="eyebrow">Skip because</div>
            <div className="flex flex-wrap gap-1.5">
              {SKIP_REASONS.map((r) => (
                <label key={r} className="chip">
                  <input type="checkbox" name="reasons" value={r} className="sr-only" />
                  {r}
                </label>
              ))}
            </div>
            <input name="other" placeholder="Other reason (optional)" className="input" />
            <SubmitButton className="btn">Skip</SubmitButton>
          </form>
        </div>
      )}
    </details>
  );
}
