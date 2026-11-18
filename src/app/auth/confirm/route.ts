import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where invite and password-reset emails link to: exchanges the one-time token for a
 * session (set as cookies), then asks for a password.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && (type === "invite" || type === "recovery")) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL("/set-password", request.url));
  }
  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
