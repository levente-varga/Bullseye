"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PendingBar } from "./PendingBar";
import { IconChart, IconInbox, IconPipeline, IconSliders, IconSources, IconUser, IconUsers } from "./icons";

export const NAV = [
  { href: "/", label: "Inbox", Icon: IconInbox, key: "inbox" },
  { href: "/pipeline", label: "Pipeline", Icon: IconPipeline, key: "pipeline" },
  { href: "/criteria", label: "Criteria", Icon: IconSliders, key: "criteria" },
  { href: "/sources", label: "Sources", Icon: IconSources, key: "sources" },
  { href: "/profile", label: "Profile", Icon: IconUser, key: "profile" },
  { href: "/report", label: "Report", Icon: IconChart, key: "report" },
] as const;

/** Admin only: the Members page. */
const ADMIN_NAV = { href: "/admin", label: "Members", Icon: IconUsers, key: "admin" } as const;

export type NavCounts = Partial<Record<(typeof NAV)[number]["key"], string | number>>;

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

/**
 * Vertical nav for the sidebar. `counts` come from the layout, which Next.js
 * doesn't re-render on navigation, so they're re-read on every page change and
 * whenever the server sends new ones (after a save). Otherwise they'd go stale
 * when the worker changes the database.
 */
export function SidebarNav({ counts: initial, admin = false }: { counts?: NavCounts; admin?: boolean }) {
  const path = usePathname();
  const [live, setLive] = useState<NavCounts | null>(null);
  const initialKey = JSON.stringify(initial ?? null);

  useEffect(() => {
    if (!initial) return; // fallback while the sidebar loads
    const ctrl = new AbortController();
    fetch("/api/nav-counts", { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: NavCounts | null) => c && setLive(c))
      .catch(() => {}); // keep the last known counts
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialKey stands in for `initial`
  }, [path, initialKey]);

  const counts = live ?? initial ?? {};
  return (
    <nav className="space-y-px">
      {[...NAV, ...(admin ? [ADMIN_NAV] : [])].map(({ href, label, Icon, key }) => {
        const active = isActive(path, href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 px-2 py-1.5 text-[13px] ${
              active ? "bg-[var(--surface-2)] text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <Icon className={active ? "text-[var(--accent-strong)]" : "text-[var(--faint)]"} />
            <span className="flex-1">{label}</span>
            {key !== "admin" && counts[key] !== undefined && <span className="mono faint text-[11px]">{counts[key]}</span>}
            <PendingBar />
          </Link>
        );
      })}
    </nav>
  );
}

/** Horizontal nav for narrow screens. */
export function TopNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-x-0.5 gap-y-1">
      {NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`px-1.5 py-1 text-[13px] ${
            isActive(path, href) ? "bg-[var(--surface-2)] text-[var(--fg)]" : "text-[var(--muted)]"
          }`}
        >
          {label}
          <PendingBar />
        </Link>
      ))}
    </nav>
  );
}
