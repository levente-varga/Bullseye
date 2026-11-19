"use client";

import { useActionState } from "react";
import { addBoard, type AddBoardResult } from "@/app/(app)/actions";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { Panel } from "@/components/ui";

/**
 * Add a company board by link (auto-detect). The result shows under the form, from the
 * action's returned state: no redirect, so the page doesn't navigate or jump.
 */
export function AddBoardForm({ systems }: { systems: string }) {
  const [result, action] = useActionState<AddBoardResult, FormData>(addBoard, null);
  return (
    <div>
      <Panel title="Add a board">
        <form action={action} className="space-y-3 p-3">
          <input type="hidden" name="ats" value="auto" />
          <label className="field">
            <span className="label">Careers page or job posting</span>
            <input name="slug" required className="input mono" placeholder="https://career.paradoxplaza.com" />
          </label>
          <label className="field">
            <span className="label">Company name</span>
            <input name="company_name" className="input" placeholder="Guessed if empty" />
          </label>
          <SubmitButton className="btn-primary btn-field w-full">Add board</SubmitButton>
          <p className="hint">Works with {systems}.</p>
        </form>
      </Panel>
      {result && (
        <Notice key={result.at} tone={result.tone} className="mt-2">
          {result.message}
        </Notice>
      )}
    </div>
  );
}
