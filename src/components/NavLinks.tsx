"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PendingBar } from "./PendingBar";
import { IconChart, IconInbox, IconPipeline, IconSliders, IconSources, IconUser } from "./icons";

export const NAV = [
  { href: "/", label: "Inbox", Icon: IconInbox, key: "inbox" },
  { href: "/pipeline", label: "Pipeline", Icon: IconPipeline, key: "pipeline" },
  { href: "/criteria", label: "Criteria", Icon: IconSliders, key: "criteria" },
  { href: "/sources", label: "Sources", Icon: IconSources, key: "sources" },
  { href: "/profile", label: "Profile", Icon: IconUser, key: "profile" },
  { href: "/report", label: "Report", Icon: IconChart, key: "report" },
] as const;

export type NavCounts = Partial<Record<(typeof NAV)[number]["key"], string | number>>;

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

/** Vertical nav for the sidebar. */
export function SidebarNav({ counts = {} }: { counts?: NavCounts }) {
  const path = usePathname();
  return (
    <nav className="space-y-px">
      {NAV.map(({ href, label, Icon, key }) => {
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
            {counts[key] !== undefined && <span className="mono faint text-[11px]">{counts[key]}</span>}
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
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4">
      {NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`shrink-0 px-2 py-1 text-[13px] ${
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
