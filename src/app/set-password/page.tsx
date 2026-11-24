import { redirect } from "next/navigation";
import { IconBullseye } from "@/components/icons";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";

async function setPassword(form: FormData) {
  "use server";
  const password = String(form.get("password") ?? "");
  if (password.length < 10) redirect("/set-password?error=short");
  if (password !== String(form.get("confirm") ?? "")) redirect("/set-password?error=mismatch");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`/set-password?error=${encodeURIComponent(error.message)}`);
  redirect("/");
}

const MESSAGES: Record<string, string> = {
  short: "Use at least 10 characters.",
  mismatch: "The two passwords don't match.",
};

/** Reached from an invite or password-reset link (already signed in by /auth/confirm). */
export default async function SetPasswordPage({ searchParams }: PageProps<"/set-password">) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login?error=link");
  const email = String(data.claims.email ?? "");
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={setPassword} className="panel w-full max-w-[360px]">
        <div className="border-b border-[var(--border)] px-5 py-5">
          <div className="flex items-center gap-2">
            <IconBullseye width={18} height={18} className="text-[var(--accent-strong)]" />
            <span className="serif text-[1.5rem] leading-none tracking-tight">Bullseye</span>
          </div>
          <p className="faint mt-2 text-[12px]">Set a password for {email || "your account"}.</p>
        </div>
        <div className="space-y-3 px-5 py-5">
          <label className="field">
            <span className="label">New password</span>
            <input name="password" type="password" required minLength={10} autoComplete="new-password" className="input" />
          </label>
          <label className="field">
            <span className="label">Repeat it</span>
            <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className="input" />
          </label>
          {typeof error === "string" && <p className="text-[12px] text-[var(--bad)]">{MESSAGES[error] ?? error}</p>}
          <SubmitButton className="btn-primary w-full py-1.5">Set password and continue</SubmitButton>
        </div>
      </form>
    </main>
  );
}
