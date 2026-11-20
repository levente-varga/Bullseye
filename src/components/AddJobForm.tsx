"use client";

import { useActionState, useEffect, useState } from "react";
import { addManualJob, type AddJobResult } from "@/app/(app)/actions";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { Panel } from "@/components/ui";

/**
 * Pipeline → Add a job: a posting typed in by hand, for sites no source can read (or a job
 * a friend sent). Nothing is fetched or scored; it goes straight into the Pipeline.
 */
export function AddJobForm() {
  const [open, setOpen] = useState(false);
  const [result, action] = useActionState<AddJobResult, FormData>(addManualJob, null);

  // Close after a successful add; an error keeps the form (and what was typed) open.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the action's result
    if (result?.tone === "ok") setOpen(false);
  }, [result]);

  return (
    <div className="space-y-3">
      {!open && (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          + Add a job by hand
        </button>
      )}
      {open && (
        <Panel
          title="Add a job by hand"
          aside={
            <button type="button" onClick={() => setOpen(false)} className="link cursor-pointer font-sans text-[12px] normal-case tracking-normal">
              Cancel
            </button>
          }
        >
          <form action={action} className="grid gap-3 p-3 sm:grid-cols-2">
            <label className="field sm:col-span-2">
              <span className="label">Link to the posting</span>
              <input name="url" required className="input mono" placeholder="https://www.valvesoftware.com/en/jobs?job_id=51" />
            </label>
            <label className="field">
              <span className="label">Title</span>
              <input name="title" required className="input" placeholder="Gameplay Programmer" />
            </label>
            <label className="field">
              <span className="label">Company</span>
              <input name="company" required className="input" placeholder="Valve" />
            </label>
            <label className="field">
              <span className="label">Location</span>
              <input name="location" className="input" placeholder="Bellevue, United States" />
            </label>
            <label className="flex items-center gap-2 self-end pb-1.5 text-[13px]">
              <input type="checkbox" name="remote" />
              <span className="muted">Remote possible</span>
            </label>
            <label className="field sm:col-span-2">
              <span className="label">Description (optional)</span>
              <textarea
                name="description"
                rows={4}
                className="input"
                placeholder="Paste the job's text: it's kept with the job, for you and for CV and cover letter drafts."
              />
            </label>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <SubmitButton className="btn-primary">Add to Pipeline</SubmitButton>
              <span className="hint">Nothing is fetched or scored: it goes straight into your Pipeline.</span>
            </div>
          </form>
        </Panel>
      )}
      {result && (
        <Notice key={result.at} tone={result.tone} className="">
          {result.message}
        </Notice>
      )}
    </div>
  );
}
