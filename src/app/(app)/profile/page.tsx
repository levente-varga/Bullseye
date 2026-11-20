import { createClient } from "@/lib/supabase/server";
import { CareerSection } from "@/components/CareerSection";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { agoText, pad2 } from "@/lib/time";
import type { Profile } from "@/lib/types";
import { deleteAnswer, deleteCv, saveAnswer, saveCvText, saveProfile, uploadCv } from "../actions";

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: p, error }, { data: answers }] = await Promise.all([
    supabase.from("profile").select("*").single(),
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
        meta="Private. The scorer reads your headline, location and CV."
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
              <label className="field">
                <span className="label">Other links</span>
                <textarea name="links" defaultValue={profile.links.join("\n")} rows={2} className="input mono" placeholder="One per line" />
              </label>
            </div>
          </Panel>

          <SubmitButton className="btn-primary" done="Saved">Save details & links</SubmitButton>
        </form>

        <section id="career" className="scroll-mt-6">
          <SectionHeader title="Career" actions={<span className="faint">roles, education and skills: what CV and cover letter drafts use</span>} />
          <CareerSection
            career={profile.career ?? null}
            updatedAt={profile.career_updated_at ?? null}
            hasCv={Boolean(profile.cv_text.trim())}
          />
        </section>

        <section id="cv" className="scroll-mt-6">
          <SectionHeader title="CV" actions={<span className="faint">{cvWords ? `${cvWords} words for the scorer` : "not added yet"}</span>} />
          {cvNotice && (
            // The upload note asks for a check of the extracted text, so it stays a little longer.
            <Notice key={crypto.randomUUID()} tone={cvNotice.tone} params={["cv", "cv_error"]} autoHideMs={cvNotice.tone === "ok" ? 15000 : 0}>
              {cvNotice.text}
            </Notice>
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
                      <SubmitButton className="btn btn-danger">Remove file</SubmitButton>
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
                  className="max-w-full min-w-0 text-[13px] file:mr-3 file:cursor-pointer file:border file:border-[var(--border-strong)] file:bg-[var(--surface)] file:px-2.5 file:py-1 file:text-[13px] file:text-[var(--fg)]"
                />
                <SubmitButton className="btn-primary ml-auto">{profile.cv_file_path ? "Replace PDF" : "Upload PDF"}</SubmitButton>
                <p className="hint w-full">Replaces the text below.</p>
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
                  <SubmitButton className="btn-primary" done="Saved">Save CV text</SubmitButton>
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
              <Empty>No answers yet. Try notice period, salary and work permit.</Empty>
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
                        <SubmitButton className="btn" done="Saved">Save</SubmitButton>
                        <SubmitButton formAction={deleteAnswer} className="btn btn-danger">Delete</SubmitButton>
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
                <SubmitButton className="btn-primary btn-field" done="Added">Add</SubmitButton>
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
    <label className="field">
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
