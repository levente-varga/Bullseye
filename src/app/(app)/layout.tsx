import Link from "next/link";
import { Suspense } from "react";
import { IconBullseye } from "@/components/icons";
import { TopNav } from "@/components/NavLinks";
import { SidebarData, SidebarFallback } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { signOut } from "./actions";

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <IconBullseye width={18} height={18} className="text-[var(--accent-strong)]" />
      <span className="serif text-[1.35rem] leading-none tracking-tight">bullseye</span>
    </Link>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop). Fixed rather than sticky: Safari re-positions sticky elements while
          scrolling and rounds the inner scroll area separately, so parts of it jittered by a pixel. */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-[232px] flex-col border-r border-[var(--border)] bg-[var(--bg)] px-3 py-5 md:flex">
        <div className="mb-6 px-2">
          <Wordmark />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Suspense fallback={<SidebarFallback />}>
            <SidebarData />
          </Suspense>
        </div>
        <div className="mt-4 flex items-center justify-between px-2">
          <ThemeToggle />
          <form action={signOut}>
            <button className="btn-ghost text-[12px]">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1 md:pl-[232px]">
        {/* Top bar (mobile) */}
        <header className="border-b border-[var(--border)] px-4 pt-3 pb-2 md:hidden">
          <div className="mb-2 flex items-center justify-between">
            <Wordmark />
            <ThemeToggle />
          </div>
          <TopNav />
        </header>
        <main className="mx-auto w-full max-w-[1120px] px-4 py-6 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  );
}
