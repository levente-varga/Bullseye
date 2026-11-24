"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/**
 * Searches the Inbox on the server (the lists are paged and carry no descriptions):
 * each word must appear in the title, company, location or description. Typing updates
 * ?q= after a short pause, keeping the tab; "/" focuses it, Esc clears it.
 */
export function InboxSearch({ matches }: { matches: number | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = (q: string, wait: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params);
      next.delete("n"); // a new search starts from the first page
      if (q.trim()) next.set("q", q.trim());
      else next.delete("q");
      const qs = next.toString();
      start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    }, wait);
  };

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

  const searching = Boolean(params.get("q"));
  return (
    <div className="mb-3 flex items-center gap-3">
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          go(e.target.value, 350);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            go("", 0);
          } else if (e.key === "Enter") go(value, 0);
        }}
        placeholder="Search title, company, location or description  ( / )"
        aria-label="Search the Inbox"
        className="input min-w-0 flex-1"
      />
      {(pending || (searching && matches !== null)) && (
        <span className={`mono shrink-0 text-[12px] ${pending || matches ? "faint" : "text-[var(--bad)]"}`} role="status">
          {pending ? "searching…" : matches ? `${matches} match${matches === 1 ? "" : "es"}` : "no matches"}
        </span>
      )}
    </div>
  );
}
