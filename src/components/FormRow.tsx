import type { ReactNode } from "react";

/**
 * A label (and hint) beside its value when the row has room (28rem, by its own width:
 * a main column narrows when a side panel shows), above it otherwise. The value is a
 * container too, so what's inside can lay itself out by its width.
 */
export function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid gap-2 px-3 py-3 @md:grid-cols-[180px_1fr] @md:gap-4">
        <div>
          <div className="text-[13px]">{props.label}</div>
          {props.hint && <div className="hint mt-0.5">{props.hint}</div>}
        </div>
        <div className="@container min-w-0">{props.children}</div>
      </div>
    </div>
  );
}

/** A dollar amount field (spend caps). */
export function Money(props: { name: string; label: string; value: number }) {
  return (
    <label className="field">
      <span className="hint">{props.label}</span>
      <span className="flex items-center gap-1.5">
        <span className="faint mono">$</span>
        <input name={props.name} type="number" min={0} step={0.01} defaultValue={props.value} className="input mono w-24" />
      </span>
    </label>
  );
}
