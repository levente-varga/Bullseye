"use client";

import { useState } from "react";
import { renameSource } from "@/app/(app)/actions";
import { IconPencil } from "@/components/icons";

/**
 * A source's name, linking to its board, with a pencil (shown on row hover, always on
 * touch screens) that turns it into a field: Enter saves, Esc or leaving the field cancels.
 * The row needs the `group` class.
 */
export function SourceName({ id, name, href }: { id: string; name: string; href: string }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <form
        action={async (form) => {
          setEditing(false);
          await renameSource(form);
        }}
        className="inline-flex"
      >
        <input type="hidden" name="id" value={id} />
        <input
          name="name"
          defaultValue={name}
          autoFocus
          required
          maxLength={120}
          aria-label="Source name"
          className="input py-0.5 font-medium"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          onBlur={(e) => {
            // Leaving the field cancels, unless it's to submit.
            if (!e.currentTarget.form?.contains(e.relatedTarget as Node | null)) setEditing(false);
          }}
        />
      </form>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {/* Long names wrap anywhere instead of widening the table. */}
      <a href={href} target="_blank" rel="noreferrer" className="min-w-0 font-medium [overflow-wrap:anywhere] hover:underline">
        {name}
      </a>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Rename"
        className="faint shrink-0 p-0.5 hover:text-[var(--fg)] focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
      >
        <IconPencil width={13} height={13} />
        <span className="sr-only">Rename {name}</span>
      </button>
    </span>
  );
}
