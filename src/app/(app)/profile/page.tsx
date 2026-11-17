import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { pad2 } from "@/lib/time";
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
  const cvWords = profile.cv_text.trim() ? profile.cv_text.trim().split(/\s+/).length : 0;

  return (
    <>
      <PageHeader
        title="Profile"
        meta="Stored only in your database, never in the repo. Your headline, location and CV are what the scorer judges listings against."
      />

      <div className="space-y-10">
        <form action={saveProfile} className="space-y-6">
          <Panel title="Contact">
            <div className="grid gap-3 p-3 sm:grid-cols-2">
              <Field name="full_name" label="Full name" value={profile.full_name} />
              <Field name="email" label="Contact email" value={profile.email} type="email" />
              <Field name="phone" label="Phone" value={profile.phone} />
              <Field name="location" label="Based in" value={profile.location} />
            </div>
            <div className="border-t border-[var(--border)] p-3">
              <label className="space-y-1">
                <span className="label">Links</span>
                <textarea name="links" defaultValue={profile.links.join("\n")} rows={3} className="input mono" placeholder={"https://github.com/…\nhttps://linkedin.com/in/…"} />
                <span className="hint">One per line: portfolio, GitHub, LinkedIn.</span>
              </label>
            </div>
          </Panel>

          <Panel title="For the scorer" aside={cvWords ? `${cvWords} words` : "no CV yet"}>
            <div className="space-y-3 p-3">
              <Field name="headline" label="Headline" value={profile.headline} placeholder="Frontend developer, 3 years React/TypeScript" />
              <label className="space-y-1">
                <span className="label">CV (plain text)</span>
                <textarea name="cv_text" defaultValue={profile.cv_text} rows={16} className="input mono text-[12px] leading-relaxed" placeholder="Paste your CV here." />
              </label>
            </div>
          </Panel>

          <button className="btn-primary">Save profile</button>
        </form>

        <section>
          <SectionHeader
            title="Answer bank"
            count={answers?.length ?? 0}
            actions={<span className="faint">answers to questions application forms keep asking</span>}
          />
          <Panel>
            {(answers ?? []).length === 0 ? (
              <Empty>No answers yet. Start with notice period, salary expectation and work permit.</Empty>
            ) : (
              <ol className="divide">
                {(answers ?? []).map((a, i) => (
                  <li key={a.id}>
                    <form action={saveAnswer} className="grid gap-2 p-3 sm:grid-cols-[28px_1fr_auto]">
                      <span className="mono faint pt-1.5 text-[12px]">{pad2(i + 1)}</span>
                      <div className="space-y-1.5">
                        <input type="hidden" name="id" value={a.id} />
                        <input name="question" defaultValue={a.question} className="input font-medium" />
                        <textarea name="answer" defaultValue={a.answer} rows={2} className="input" />
                      </div>
                      <div className="flex gap-1.5 sm:flex-col">
                        <button className="btn">Save</button>
                        <button formAction={deleteAnswer} className="btn btn-danger">Delete</button>
                      </div>
                    </form>
                  </li>
                ))}
              </ol>
            )}
            <form action={saveAnswer} className="grid gap-2 border-t border-[var(--border)] bg-[var(--bg)] p-3 sm:grid-cols-[28px_1fr_auto]">
              <span className="mono faint pt-1.5 text-[12px]">+</span>
              <div className="space-y-1.5">
                <input name="question" required className="input" placeholder="Question, e.g. What is your notice period?" />
                <textarea name="answer" required rows={2} className="input" placeholder="Your answer" />
              </div>
              <div>
                <button className="btn-primary">Add</button>
              </div>
            </form>
          </Panel>
        </section>
      </div>
    </>
  );
}

function Field(props: { name: string; label: string; value: string; type?: string; placeholder?: string; children?: ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="label">{props.label}</span>
      <input name={props.name} type={props.type ?? "text"} defaultValue={props.value} placeholder={props.placeholder} className="input" />
    </label>
  );
}
