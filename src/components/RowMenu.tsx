"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IconMore } from "./icons";

export interface RowMenuItem {
  label: string;
  /** A server action taking the row's form fields. */
  action: (form: FormData) => Promise<void>;
  /** Hidden fields sent with it, e.g. { id, status }. */
  fields: Record<string, string>;
}

/**
 * A row's secondary actions behind a ⋮ button (Pipeline rows: Drop, Back to Inbox,
 * Rejected…), so a row shows only its main button. It sits in the row's <summary>, so
 * its clicks mustn't open or close the row. Closes on choosing, clicking outside or Esc.
 */
export function RowMenu({ items, label = "More actions" }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A click in a <summary> toggles the row: keep the menu's clicks to itself.
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn btn-icon"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={(e) => {
          stop(e);
          setOpen((v) => !v);
        }}
      >
        <IconMore />
      </button>
      {open && (
        <div role="menu" className="panel absolute top-full right-0 z-20 mt-1 min-w-[11rem] py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={(e) => {
                stop(e);
                setOpen(false);
                const form = new FormData();
                for (const [k, v] of Object.entries(item.fields)) form.set(k, v);
                start(() => item.action(form));
              }}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-[13px] hover:bg-[var(--surface-2)]"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
