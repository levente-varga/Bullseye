import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getNavCounts } from "@/lib/nav-counts";
import { agoText } from "@/lib/time";
import { SidebarNav } from "./NavLinks";
import { Dot } from "./ui";

/** Sidebar contents that need data: nav counts, watchlist, last-run status. */
export async function SidebarData() {
  const supabase = await createClient();
  const [counts, sources, run, member] = await Promise.all([
    getNavCounts(supabase),
    supabase.from("my_sources").select("id, company_name, watchlist, enabled, last_error").order("company_name"),
    supabase.from("runs").select("kind, started_at, finished_at, error").order("started_at", { ascending: false }).limit(1),
    supabase.rpc("is_admin"),
  ]);

  const list = sources.data ?? [];
  const watch = list.filter((s) => s.watchlist);
  const enabled = list.filter((s) => s.enabled).length;
  const last = run.data?.[0];
  const failing = list.filter((s) => s.enabled && s.last_error).length;

  return (
    <>
      <SidebarNav counts={counts} admin={member.data === true} />

      <div className="rule mt-5 pt-4">
        <div className="eyebrow mb-2 flex items-center justify-between px-2">
          <span>Watchlist</span>
          <span className="mono">{watch.length}</span>
        </div>
        {watch.length === 0 ? (
          <Link href="/sources" className="muted block px-2 text-center text-[12px] hover:text-[var(--fg)]">
            Click Watch on a source to check it hourly
          </Link>
        ) : (
          <ul className="space-y-px">
            {watch.map((s) => (
              <li key={s.id} className="flex items-center gap-2.5 px-2 py-1 text-[13px]">
                <Dot tone={s.last_error ? "bad" : s.enabled ? "ok" : "muted"} />
                <span className="muted flex-1 truncate">{s.company_name}</span>
                {!s.enabled && <span className="faint text-[11px]">paused</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-auto space-y-1 px-2 pt-6 text-[12px]">
        <div className="flex items-center gap-2">
          <Dot tone={!last ? "muted" : last.error ? "bad" : last.finished_at ? "ok" : "warn"} />
          <span className="muted">
            {!last ? "No runs yet" : `Last ${last.kind} run ${agoText(last.started_at)}`}
          </span>
        </div>
        <div className="faint">
          {enabled} {enabled === 1 ? "source" : "sources"}
          {failing > 0 && <span className="text-[var(--bad)]"> · {failing} failing</span>}
        </div>
      </div>
    </>
  );
}

export function SidebarFallback() {
  return (
    <>
      <SidebarNav />
      <div className="mt-auto" />
    </>
  );
}
