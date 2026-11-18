import { NextResponse } from "next/server";
import { getNavCounts } from "@/lib/nav-counts";
import { createClient } from "@/lib/supabase/server";

/**
 * Fresh sidebar counts. The sidebar lives in the layout, which Next.js keeps
 * across navigations, so it re-reads these on every page change instead.
 * Row-level security limits the counts to signed-in, allowed users.
 */
export async function GET() {
  const counts = await getNavCounts(await createClient());
  return NextResponse.json(counts, { headers: { "Cache-Control": "no-store" } });
}
