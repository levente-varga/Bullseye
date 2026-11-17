import Link from "next/link";
import { signOut } from "./actions";

const NAV = [
  { href: "/", label: "Inbox" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/criteria", label: "Criteria" },
  { href: "/sources", label: "Sources" },
  { href: "/profile", label: "Profile" },
  { href: "/report", label: "Report" },
];

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Headshot
          </Link>
          <nav className="flex flex-1 flex-wrap gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="muted hover:text-[var(--foreground)]">
                {n.label}
              </Link>
            ))}
          </nav>
          <form action={signOut}>
            <button className="muted text-sm hover:text-[var(--foreground)]">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
