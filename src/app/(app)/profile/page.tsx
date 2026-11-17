import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { deleteAnswer, saveAnswer, saveProfile } from "../actions";

export default async function ProfilePage() {
  const supabase = await createClient();
  const [{ data: p, error }, { data: answers }] = await Promise.all([
    supabase.from("profile").select("*").eq("id", 1).single(),
    supabase.from("answers").select("*").order("question"),
  ]);
  if (error) throw new Error(error.message);
  const profile = p as Profile;

  return (
    <div className="space-y-10">
      <form action={saveProfile} className="space-y-5">
        <div>
          <h1 className="h1">Profile</h1>
          <p className="muted text-sm">
            Stored only in your database, never in the repo. The CV and headline are sent to the LLM for scoring.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="full_name" label="Full name" value={profile.full_name} />
          <Field name="email" label="Contact email" value={profile.email} type="email" />
          <Field name="phone" label="Phone" value={profile.phone} />
          <Field name="location" label="Based in" value={profile.location} />
        </div>
        <Field name="headline" label="Headline" value={profile.headline} placeholder="Frontend developer, 3 years React/TypeScript" />
        <label className="block space-y-1">
          <span className="label">Links (portfolio, GitHub, LinkedIn)</span>
          <textarea name="links" defaultValue={profile.links.join("\n")} rows={3} className="input" />
        </label>
        <label className="block space-y-1">
          <span className="label">CV (plain text)</span>
          <textarea name="cv_text" defaultValue={profile.cv_text} rows={14} className="input font-mono text-xs" placeholder="Paste your CV here." />
        </label>
        <button className="btn-primary">Save profile</button>
      </form>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Answer bank</h2>
          <p className="muted text-sm">
            Answers to questions application forms keep asking: work permit, notice period, salary expectation, why this
            company.
          </p>
        </div>
        <ul className="space-y-3">
          {(answers ?? []).map((a) => (
            <li key={a.id} className="card p-4">
              <form action={saveAnswer} className="space-y-2">
                <input type="hidden" name="id" value={a.id} />
                <input name="question" defaultValue={a.question} className="input font-medium" />
                <textarea name="answer" defaultValue={a.answer} rows={3} className="input" />
                <div className="flex gap-2">
                  <button className="btn">Save</button>
                  <button formAction={deleteAnswer} className="btn text-red-600">
                    Delete
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
        <form action={saveAnswer} className="card space-y-2 p-4">
          <input name="question" required className="input" placeholder="Question, e.g. What is your notice period?" />
          <textarea name="answer" required rows={3} className="input" placeholder="Your answer" />
          <button className="btn-primary">Add answer</button>
        </form>
      </section>
    </div>
  );
}

function Field(props: { name: string; label: string; value: string; type?: string; placeholder?: string }) {
  return (
    <label className="block space-y-1">
      <span className="label">{props.label}</span>
      <input name={props.name} type={props.type ?? "text"} defaultValue={props.value} placeholder={props.placeholder} className="input" />
    </label>
  );
}
