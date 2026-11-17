import { createClient } from "@/lib/supabase/server";
import { Dot, Empty, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { agoText, pad2 } from "@/lib/time";
import type { Profile } from "@/lib/types";
import { deleteAnswer, deleteCv, saveAnswer, saveCvText, saveProfile, uploadCv } from "../actions";

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: p, error }, { data: answers }] = await Promise.all([
    supabase.from("profile").select("*").eq("id", 1).single(),
    supabase.from("answers").select("*").order("question"),
  ]);
  if (error) throw new Error(error.message);
  const profile = p as Profile;
  const cvWords = profile.cv_text.trim() ? profile.cv_text.trim().split(/\s+/).length : 0;
  // Short-lived link to the private PDF (the bucket has no public URLs).
  const signed = profile.cv_file_path
    ? (await supabase.storage.from("cv").createSignedUrl(profile.cv_file_path, 600)).data?.signedUrl
    : null;
  const cvNotice =
    sp.cv === "uploaded"
      ? { tone: "ok" as const, text: "CV uploaded. The text below was extracted from it. Check it reads correctly; two-column layouts sometimes come out jumbled." }
      : sp.cv === "no_text"
        ? { tone: "warn" as const, text: "CV uploaded, but it has no text layer (probably a scan). Paste the text below so the scorer can read it." }
        : typeof sp.cv_error === "string"
          ? { tone: "bad" as const, text: sp.cv_error }
          : null;

  return (
    <>
      <PageHeader
        title="Profile"
        meta="Stored only in your database and private storage, never in the repo. The scorer judges listings against your headline, location and CV."
      />

      <div className="space-y-10">
        <form action={saveProfile} className="space-y-6">
          <Panel title="Details">
            <div className="grid gap-3 p-3 sm:grid-cols-2">
              <Field name="full_name" label="Full name" value={profile.full_name} />
              <Field name="email" label="Contact email" value={profile.email} type="email" />
              <Field name="phone" label="Phone" value={profile.phone} />
              <Field name="location" label="Based in" value={profile.location} placeholder="Budapest, Hungary" />
            </div>
            <div className="border-t border-[var(--border)] p-3">
              <Field name="headline" label="Headline" value={profile.headline} placeholder="Frontend developer, 3 years React/TypeScript" />
            </div>
          </Panel>

          <Panel title="Links">
            <div className="grid gap-3 p-3 sm:grid-cols-3">
              <Field name="linkedin_url" label="LinkedIn" value={profile.linkedin_url} placeholder="linkedin.com/in/…" mono />
              <Field name="github_url" label="GitHub" value={profile.github_url} placeholder="github.com/…" mono />
              <Field name="website_url" label="Portfolio / website" value={profile.website_url} placeholder="leventevarga.com" mono />
            </div>
            <div className="border-t border-[var(--border)] p-3">
              <label className="space-y-1">
                <span className="label">Other links</span>
                <textarea name="links" defaultValue={profile.links.join("\n")} rows={2} className="input mono" placeholder="One per line" />
                <span className="hint">Kept separate so application forms can be pre-filled field by field later.</span>
              </label>
            </div>
          </Panel>

          <button className="btn-primary">Save details & links</button>
        </form>

        <section id="cv" className="scroll-mt-6">
          <SectionHeader title="CV" actions={<span className="faint">{cvWords ? `${cvWords} words for the scorer` : "not added yet"}</span>} />
          {cvNotice && (
            <div
              className="mb-3 flex items-start gap-2 border border-[var(--border)] px-3 py-2 text-[13px]"
              style={{ background: `var(--${cvNotice.tone}-tint)` }}
            >
              <span className="pt-1.5"><Dot tone={cvNotice.tone} /></span> {cvNotice.text}
            </div>
          )}
          <div className="space-y-6">
            <Panel title="PDF" aside="private · 5 MB max">
              {profile.cv_file_path && (
                <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-3 py-2.5 text-[13px]">
                  <span className="mono">{profile.cv_file_name}</span>
                  <span className="faint text-[12px]">uploaded {agoText(profile.cv_uploaded_at)}</span>
                  <span className="ml-auto flex gap-1.5">
                    {signed && (
                      <a href={signed} target="_blank" rel="noreferrer" className="btn">
                        Open
                      </a>
                    )}
                    <form action={deleteCv}>
                      <button className="btn btn-danger">Remove file</button>
                    </form>
                  </span>
                </div>
              )}
              <form action={uploadCv} className="flex flex-wrap items-center gap-3 p-3">
                <input
                  name="cv"
                  type="file"
                  accept="application/pdf,.pdf"
                  required
                  className="text-[13px] file:mr-3 file:cursor-pointer file:border file:border-[var(--border-strong)] file:bg-[var(--surface)] file:px-2.5 file:py-1 file:text-[13px] file:text-[var(--fg)]"
                />
                <button className="btn-primary ml-auto">{profile.cv_file_path ? "Replace PDF" : "Upload PDF"}</button>
                <p className="hint w-full">Uploading extracts the text into the box below, replacing what&apos;s there.</p>
              </form>
            </Panel>

            <form action={saveCvText}>
              <Panel title="Text the scorer reads">
                <div className="p-3">
                  <textarea
                    name="cv_text"
                    defaultValue={profile.cv_text}
                    rows={16}
                    className="input mono text-[12px] leading-relaxed"
                    placeholder="Upload a PDF above, or paste your CV text here."
                  />
                </div>
                <div className="border-t border-[var(--border)] px-3 py-2.5">
                  <button className="btn-primary">Save CV text</button>
                </div>
              </Panel>
            </form>
          </div>
        </section>

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

function Field(props: { name: string; label: string; value: string; type?: string; placeholder?: string; mono?: boolean }) {
  return (
    <label className="space-y-1">
      <span className="label">{props.label}</span>
      <input
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.value}
        placeholder={props.placeholder}
        className={`input ${props.mono ? "mono" : ""}`}
      />
    </label>
  );
}
