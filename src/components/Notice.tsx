"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Dot } from "./ui";

type Tone = "ok" | "warn" | "bad";

/**
 * A one-time result message from a form redirect (e.g. /sources?added=…).
 *
 * On mount it removes its query params from the address bar (without a server
 * round trip), so a reload, Back, or another form on the page can't show it
 * again. Success messages fade after `autoHideMs`; warnings and errors stay
 * until closed, so there's time to read the reason.
 *
 * Render it with a fresh `key` per request: the same message twice in a row
 * should show again, not stay hidden from last time.
 */
export function Notice({
  tone,
  children,
  params,
  autoHideMs = tone === "ok" ? 8000 : 0,
}: {
  tone: Tone;
  children: ReactNode;
  /** Query params that carried this message; stripped from the URL once shown. */
  params: string[];
  autoHideMs?: number;
}) {
  const [state, setState] = useState<"shown" | "fading" | "gone">("shown");

  useEffect(() => {
    const url = new URL(window.location.href);
    const had = params.filter((p) => url.searchParams.has(p));
    if (!had.length) return;
    for (const p of had) url.searchParams.delete(p);
    // Next.js syncs native history calls with its router, without refetching the page.
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    // Runs once per mount; `params` is a literal at each call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoHideMs) return;
    const fade = setTimeout(() => setState("fading"), autoHideMs);
    const gone = setTimeout(() => setState("gone"), autoHideMs + 300);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [autoHideMs]);

  if (state === "gone") return null;
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={`mb-3 flex items-start gap-2 border border-[var(--border)] px-3 py-2 text-[13px] transition-opacity duration-300 ${state === "fading" ? "opacity-0" : ""}`}
      style={{ background: `var(--${tone}-tint)` }}
    >
      <span className="flex h-[1lh] items-center">
        <Dot tone={tone} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={() => setState("gone")}
        aria-label="Dismiss"
        className="faint -my-0.5 -mr-1 cursor-pointer px-1 leading-none hover:text-[var(--fg)]"
      >
        ✕
      </button>
    </div>
  );
}
