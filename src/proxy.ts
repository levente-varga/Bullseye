import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refreshes the Supabase session cookie and sends signed-out visitors to /login. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const onLogin = request.nextUrl.pathname.startsWith("/login");
  // Invite and password-reset links arrive signed out; /auth/confirm signs them in.
  const onAuth = request.nextUrl.pathname.startsWith("/auth/");

  if (!signedIn && !onLogin && !onAuth) return NextResponse.redirect(new URL("/login", request.url));
  // A signed-in visitor on /login goes to the app, unless the app sent them there with an error
  // (e.g. an account that isn't a member), which would otherwise loop.
  if (signedIn && onLogin && !request.nextUrl.searchParams.has("error")) return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
