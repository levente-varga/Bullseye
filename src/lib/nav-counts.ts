import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

export type NavCountValues = { inbox: number; pipeline: number; sources: string | number };

/**
 * The numbers next to Inbox, Pipeline and Sources in the sidebar: one database call
 * (my_nav_counts counts the caller's matches and subscriptions directly).
 */
export async function getNavCounts(supabase: Db): Promise<NavCountValues> {
  const { data } = await supabase.rpc("my_nav_counts");
  const c = (data ?? {}) as { inbox?: number; pipeline?: number; sources?: number; suggestions?: number };
  const sources = c.sources ?? 0;
  return {
    inbox: c.inbox ?? 0,
    pipeline: c.pipeline ?? 0,
    sources: c.suggestions ? `${sources} +${c.suggestions}` : sources,
  };
}
