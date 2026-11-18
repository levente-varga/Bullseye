import type { createClient } from "@/lib/supabase/server";
import { PIPELINE_STATUSES } from "@/lib/types";

type Db = Awaited<ReturnType<typeof createClient>>;

export type NavCountValues = { inbox: number; pipeline: number; sources: string | number };

/** The numbers next to Inbox, Pipeline and Sources in the sidebar. */
export async function getNavCounts(supabase: Db): Promise<NavCountValues> {
  const { data: criteria } = await supabase.from("criteria").select("score_threshold").single();
  const threshold = criteria?.score_threshold ?? 60;
  const [inbox, pipeline, suggestions, enabled] = await Promise.all([
    supabase.from("my_jobs").select("id", { count: "exact", head: true }).eq("status", "scored").gte("score", threshold),
    supabase.from("my_jobs").select("id", { count: "exact", head: true }).in("status", PIPELINE_STATUSES.filter((s) => s !== "rejected")),
    supabase.from("source_suggestions").select("id", { count: "exact", head: true }).eq("status", "new").neq("ats", "custom"),
    supabase.from("my_sources").select("id", { count: "exact", head: true }).eq("enabled", true),
  ]);
  const sources = enabled.count ?? 0;
  return {
    inbox: inbox.count ?? 0,
    pipeline: pipeline.count ?? 0,
    sources: suggestions.count ? `${sources} +${suggestions.count}` : sources,
  };
}
