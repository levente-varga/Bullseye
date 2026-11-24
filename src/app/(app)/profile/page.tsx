import { createClient } from "@/lib/supabase/server";
import { CareerSection } from "@/components/CareerSection";
import { PhotoForm } from "@/components/PhotoForm";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { withDefaults } from "@/lib/career-schema";
import { pad2 } from "@/lib/time";
import { DRAFT_LANGUAGES, SCORING_MODELS, type Profile } from "@/lib/types";
import { deleteAnswer, saveAnswer, saveDraftSettings, saveProfile } from "../actions";

export default async function ProfilePage() {
  const supabase = await createClient();
  const [{ data: p, error }, { data: answers }, { data: st }] = await Promise.all([
    supabase.from("profile").select("*").single(),
    supabase.from("answers").select("*").order("question"),
    supabase.from("settings").select("writing_model").single(),
  ]);
  // The writing model (Settings) reads CV PDFs into the career; named in the import hint.
  const writingModel = SCORING_MODELS.find((m) => m.id === st?.writing_model) ?? SCORING_MODELS[0];
  if (error) throw new Error(error.message);
  const profile = p as Profile;
  // Careers saved before projects/certifications/other existed get them empty.
  const career = withDefaults(profile.career);
  // The photo is private: a signed link for this page view.
  const photoUrl = profile.photo_path
    ? ((await supabase.storage.from("photos").createSignedUrl(profile.photo_path, 3600)).data?.signedUrl ?? null)
    : null;

  return (
    <>
      <PageHeader
        title="Profile"
        meta="Private. The scorer reads your headline, location and career."
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

        <section id="drafts" className="scroll-mt-6">
          <SectionHeader title="Drafts" actions={<span className="faint">how CV and cover letter drafts come out</span>} />
          {/* min-w-0: grid items otherwise grow to their widest content (the file picker) on phones. */}
          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel title="Photo">
              <PhotoForm photoUrl={photoUrl} />
            </Panel>
            <Panel title="Draft settings">
              <form action={saveDraftSettings} className="space-y-3 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="field">
                    <span className="label">Language</span>
                    <select name="draft_language" defaultValue={profile.draft_language} className="input">
                      {DRAFT_LANGUAGES.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="label">CV length</span>
                    <select name="cv_length" defaultValue={profile.cv_length} className="input">
                      <option value="one_page">One page</option>
                      <option value="two_pages">Up to two pages</option>
                    </select>
                  </label>
                </div>
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" name="cv_photo" defaultChecked={profile.cv_photo} className="mt-0.5" />
                  <span className="muted">
                    Photo on CVs{!photoUrl && <span className="faint"> (upload one first)</span>}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" name="letter_questions" defaultChecked={profile.letter_questions} className="mt-0.5" />
                  <span className="muted">Ask me 1–2 questions about the job before writing a cover letter</span>
                </label>
                <SubmitButton className="btn-primary" done="Saved">Save draft settings</SubmitButton>
              </form>
            </Panel>
          </div>
        </section>

        <section id="career" className="scroll-mt-6">
          <SectionHeader title="Career" actions={<span className="faint">what the scorer reads, and what drafts are built from</span>} />
          <CareerSection
            career={career}
            updatedAt={profile.career_updated_at ?? null}
            modelLabel={writingModel.label}
          />
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
