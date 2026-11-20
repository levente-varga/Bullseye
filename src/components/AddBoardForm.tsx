"use client";

import { useActionState } from "react";
import { addBoard, type AddBoardResult } from "@/app/(app)/actions";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { IconChevronDown } from "@/components/icons";
import { Panel } from "@/components/ui";

/**
 * Add a company board by link (auto-detect). The result shows under the form, from the
 * action's returned state: no redirect, so the page doesn't navigate or jump.
 */
export function AddBoardForm({ systems }: { systems: string[] }) {
  const [result, action] = useActionState<AddBoardResult, FormData>(addBoard, null);
  return (
    <div>
      <Panel title="Add a board">
        {/* One row above the tables (below xl), stacked in the side column (xl). */}
        <form action={action} className="grid items-end gap-3 p-3 sm:grid-cols-[2fr_1fr_auto] xl:grid-cols-1">
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
          <details className="group hint sm:col-span-3 xl:col-span-1">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <span className="link">Supported sites</span>{" "}
              <IconChevronDown width={10} height={10} className="inline transition-transform group-open:rotate-180" />
            </summary>
            {/* A bulleted list, in columns where there's room: a sentence of 20+ names was unreadable. */}
            <ul className="mt-1.5 list-disc columns-2 gap-x-6 pl-4 sm:columns-3 xl:columns-2">
              {systems.map((s) => (
                <li key={s} className="break-inside-avoid">
                  {s}
                </li>
              ))}
            </ul>
          </details>
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
