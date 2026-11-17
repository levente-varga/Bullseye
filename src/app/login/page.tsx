import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function signIn(form: FormData) {
  "use server";
  const supabase = await createClient();
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
    <main className="flex flex-1 items-center justify-center p-4">
      <form action={signIn} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">Headshot</h1>
          <p className="muted text-sm">Sign in to your job search.</p>
        </div>
        <label className="block space-y-1">
          <span className="label">Email</span>
          <input name="email" type="email" required autoComplete="email" className="input" />
        </label>
        <label className="block space-y-1">
          <span className="label">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="input" />
        </label>
        {error && <p className="text-sm text-red-600">Wrong email or password.</p>}
        <button className="btn-primary w-full">Sign in</button>
      </form>
    </main>
  );
}
