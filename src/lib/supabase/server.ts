import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

/** Supabase client for Server Components and Server Actions, authenticated as the signed-in user (RLS applies). */
export async function createClient() {
  // Everything that reads the database renders per request, so reading the clock
  // afterwards (relative times like "3h ago") is intended, not a prerender bug.
  await connection();
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: cookies are read-only there; the proxy refreshes them.
          }
        },
      },
    },
  );
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * The signed-in person: their user id, and whether they're the admin. Rows are already
 * limited to them by RLS; the id is for writes that need a filter (updates) and paths.
 * Sends anyone without a session, or who isn't a member, to the login page.
 */
export async function currentUser(supabase: ServerClient): Promise<{ id: string; isAdmin: boolean }> {
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (!id) redirect("/login");
  const { data: member } = await supabase.from("members").select("is_admin").eq("user_id", id).maybeSingle();
  if (!member) redirect("/login?error=not_member");
  return { id, isAdmin: Boolean(member.is_admin) };
}
