"use client";

import { useState, type ReactNode } from "react";
import { Price } from "@/components/Price";
import { SubmitButton } from "@/components/SubmitButton";
import type { Estimate } from "@/lib/estimates";

/**
 * The Re-evaluate panel's choice and button. Applying the criteria is free; re-scoring
 * the scored listings costs AI credit, so its estimate shows on the button only while
 * that box is ticked. `children` sits between the two (e.g. a paused-scoring warning).
 */
export function ReevaluateControls(props: { scoredCount: number; estimate: Estimate; children?: ReactNode }) {
  const [rescore, setRescore] = useState(false);
  return (
    <>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="rescore" className="mt-0.5" checked={rescore} onChange={(e) => setRescore(e.target.checked)} />
        <span className="muted">
          Re-score the <span className="mono text-[var(--fg)]">{props.scoredCount}</span> scored ones too. They keep their current
          score until the new one arrives.
        </span>
      </label>
      {props.children}
      <SubmitButton className="btn inline-flex items-center gap-2" done="Done">
        Re-evaluate
        {rescore && props.scoredCount > 0 && <Price estimate={props.estimate} />}
      </SubmitButton>
    </>
  );
}
