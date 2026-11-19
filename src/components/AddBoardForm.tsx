"use client";

import { useActionState } from "react";
import { addBoard, type AddBoardResult } from "@/app/(app)/actions";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Add a company board by link (auto-detect). The result shows under the form, from the
 * action's returned state: no redirect, so the page doesn't navigate or jump.
 */
export function AddBoardForm({ systems }: { systems: string }) {
  const [result, action] = useActionState<AddBoardResult, FormData>(addBoard, null);
  return (
    <div className="mt-3">
      <form action={action} className="panel flex flex-wrap items-end gap-3 p-3">
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
        <p className="hint w-full">Works with {systems}.</p>
      </form>
      {result && (
        <Notice key={result.at} tone={result.tone} className="mt-2">
          {result.message}
        </Notice>
      )}
    </div>
  );
}
