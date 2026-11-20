"use client";

import { useOptimistic, useState, useTransition, type FormEvent } from "react";
import { renameSource } from "@/app/(app)/actions";
import { IconCheck, IconClose, IconPencil } from "@/components/icons";

/**
 * A source's name, linking to its board, with a pencil (shown on row hover, always on
 * touch screens) that turns it into a field with save (✓) and cancel (✕) buttons:
 * Enter or ✓ saves, Esc, ✕ or leaving the field cancels. The row needs the `group` class.
 *
 * Saving closes the field at once and shows the new name, faded until the server has
 * it: the field's own state change runs in the submit event, not in a form action
 * (React holds an action's state updates until the action finishes).
 */
export function SourceName({ id, name, href }: { id: string; name: string; href: string }) {
  const [editing, setEditing] = useState(false);
  const [saving, startSaving] = useTransition();
  const [shown, setShown] = useOptimistic(name);

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = String(form.get("name") ?? "").trim();
    setEditing(false);
    if (!next || next === name) return;
    startSaving(async () => {
      setShown(next);
      await renameSource(form);
    });
  }

  if (editing) {
    return (
      <form
        onSubmit={save}
        className="inline-flex items-center gap-1"
        onBlur={(e) => {
          // Leaving the field (and its buttons) cancels.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(false);
        }}
      >
        <input type="hidden" name="id" value={id} />
        <input
          name="name"
          defaultValue={shown}
          autoFocus
          required
          maxLength={120}
          aria-label="Source name"
          className="input w-36 py-0.5 font-medium"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        />
        <button type="submit" className="btn btn-icon shrink-0" title="Save" aria-label="Save name">
          <IconCheck width={14} height={14} />
        </button>
        <button type="button" className="btn btn-icon shrink-0" title="Cancel" aria-label="Cancel" onClick={() => setEditing(false)}>
          <IconClose width={14} height={14} />
        </button>
      </form>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {/* Long names wrap anywhere instead of widening the table. Faded while a rename saves. */}
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`min-w-0 font-medium [overflow-wrap:anywhere] hover:underline ${saving ? "opacity-50" : ""}`}
        title={saving ? "Saving…" : undefined}
        aria-busy={saving}
      >
        {shown}
      </a>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Rename"
        disabled={saving}
        className="faint shrink-0 p-0.5 hover:text-[var(--fg)] focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
      >
        <IconPencil width={13} height={13} />
        <span className="sr-only">Rename {shown}</span>
      </button>
    </span>
  );
}
