import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/SubmitButton";
import { IconBullseye } from "@/components/icons";
import { createClient } from "@/lib/supabase/server";

async function signIn(form: FormData) {
  "use server";
  const supabase = await createClient();
  // Start clean: a non-member's old session would otherwise linger on this page.
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
  });
  if (error) redirect("/login?error=1");
  redirect("/");
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={signIn} className="panel w-full max-w-[360px]">
        <div className="border-b border-[var(--border)] px-5 py-5">
          <div className="flex items-center gap-2">
            <IconBullseye width={18} height={18} className="text-[var(--accent-strong)]" />
            <span className="serif text-[1.5rem] leading-none tracking-tight">bullseye</span>
          </div>
          <p className="faint mt-2 text-[12px]">Sign in to your job search.</p>
        </div>
        <div className="space-y-3 px-5 py-5">
          <label className="field">
            <span className="label">Email</span>
            <input name="email" type="email" required autoComplete="email" className="input" />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input name="password" type="password" required autoComplete="current-password" className="input" />
          </label>
          {error && (
            <p className="text-[12px] text-[var(--bad)]">
              {error === "not_member"
                ? "This account doesn't have access to Bullseye. Ask the admin for an invite."
                : error === "link"
                  ? "That link has expired or was already used. Ask the admin to send a new invite."
                  : "Wrong email or password."}
            </p>
          )}
          <SubmitButton className="btn-primary w-full py-1.5">Sign in</SubmitButton>
        </div>
      </form>
    </main>
  );
}
