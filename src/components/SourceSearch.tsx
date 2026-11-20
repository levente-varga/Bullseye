"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Filters the Sources page's rows as you type: every row with a data-search attribute
 * (company, address, type) inside #sources-list is hidden unless it contains each word.
 * Client-side only, so it's instant and the tables stay server-rendered. Esc clears it.
 */
export function SourceSearch() {
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<{ shown: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const search = (value: string) => {
    setQuery(value);
    const words = value.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = document.querySelectorAll<HTMLElement>("#sources-list [data-search]");
    let shown = 0;
    rows.forEach((row) => {
      const hit = words.every((w) => (row.dataset.search ?? "").includes(w));
      row.hidden = !hit;
      if (hit) shown++;
    });
    setCounts(words.length ? { shown, total: rows.length } : null);
  };

  // "/" focuses the search, as on many dev tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !t?.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex items-center gap-3">
      <input
        ref={input}
        type="search"
        value={query}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && search("")}
        placeholder="Search sources by company, address or type  ( / )"
        aria-label="Search sources"
        className="input min-w-0 flex-1"
      />
      {counts && (
        <span className={`mono shrink-0 text-[12px] ${counts.shown ? "faint" : "text-[var(--bad)]"}`}>
          {counts.shown ? `${counts.shown} of ${counts.total}` : "no matches"}
        </span>
      )}
    </div>
  );
}
