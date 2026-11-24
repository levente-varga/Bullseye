"use client";

import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";
import { draftCv, draftLetter, getDrafts, saveDraft, type DraftResult } from "@/app/(app)/actions";
import { Notice } from "@/components/Notice";
import { formatCareerDate } from "@/lib/career-schema";
import type { CvDraft, DraftRow, LetterDraft, LetterQA } from "@/lib/draft-types";
import { DRAFT_LANGUAGES } from "@/lib/types";

/**
 * CV and cover letter drafts for one Pipeline job, inside its opened row. Drafts load when
 * the row opens. Each card: make or remake the draft, download the PDF, and edit the text.
 * A cover letter may first ask 1-2 questions (Profile → Drafts), answered right here.
 */
export function DraftPanel({ jobId }: { jobId: string }) {
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [result, setResult] = useState<DraftResult>(null);
  const [busy, setBusy] = useState<"cv" | "cover_letter" | null>(null);
  const [, startTransition] = useTransition();

  const reload = useCallback(() => getDrafts(jobId).then(setDrafts), [jobId]);
  useEffect(() => {
    let cancelled = false;
    getDrafts(jobId).then((d) => !cancelled && setDrafts(d));
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const run = (kind: "cv" | "cover_letter", task: () => Promise<DraftResult>) => {
    setBusy(kind);
    setResult(null);
    startTransition(async () => {
      const r = await task();
      await reload();
      setBusy(null);
      if (r?.message) setResult(r);
    });
  };

  const cv = drafts?.find((d) => d.kind === "cv");
  const letter = drafts?.find((d) => d.kind === "cover_letter");

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="label">Drafts</h3>
        <span className="faint text-[12px]">Built from your career only. Settings on the Profile page.</span>
      </div>
      {result && (
        <Notice key={result.at} tone={result.tone} autoHideMs={result.tone === "ok" ? 8000 : 0}>
          {result.message}
        </Notice>
      )}
      {drafts === null ? (
        <div aria-busy="true" className="skeleton h-24 w-full" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card
            title="CV"
            draft={cv}
            busy={busy === "cv"}
            actions={
              <button type="button" className={cv?.content ? "btn" : "btn-primary"} disabled={!!busy} onClick={() => run("cv", () => draftCv(jobId))}>
                {busy === "cv" ? "Writing…" : cv?.content ? "Rewrite" : "Draft CV"}
              </button>
            }
          >
            {cv?.content && <CvEditor key={cv.updated_at} draft={cv} />}
          </Card>
          <Card
            title="Cover letter"
            draft={letter}
            busy={busy === "cover_letter"}
            actions={
              (!letter || letter.content) && (
                <button
                  type="button"
                  className={letter?.content ? "btn" : "btn-primary"}
                  disabled={!!busy}
                  onClick={() => run("cover_letter", () => draftLetter(jobId))}
                >
                  {busy === "cover_letter" ? "Writing…" : letter?.content ? "Rewrite" : "Draft cover letter"}
                </button>
              )
            }
          >
            {letter && !letter.content && letter.answers && (
              <Questions
                key={letter.updated_at}
                answers={letter.answers}
                busy={busy === "cover_letter"}
                onWrite={(qa) => run("cover_letter", () => draftLetter(jobId, qa))}
              />
            )}
            {letter?.content && (
              <>
                <LetterEditor key={letter.updated_at} draft={letter} />
                {letter.answers && letter.answers.length > 0 && (
                  <details className="text-[12px]">
                    <summary className="link cursor-pointer">Your answers ({letter.answers.filter((a) => a.answer.trim()).length})</summary>
                    <div className="mt-2">
                      <Questions
                        answers={letter.answers}
                        busy={busy === "cover_letter"}
                        submitLabel="Rewrite with these"
                        onWrite={(qa) => run("cover_letter", () => draftLetter(jobId, qa))}
                      />
                    </div>
                  </details>
                )}
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Card(props: { title: string; draft?: DraftRow; busy: boolean; actions: ReactNode; children?: ReactNode }) {
  const d = props.draft;
  const lang = DRAFT_LANGUAGES.find((l) => l.id === d?.language)?.label;
  return (
    <section className="border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="font-medium">{props.title}</span>
        {d?.content && (
          <span className="mono faint text-[11px]">
            {lang} · ${Number(d.cost_usd).toFixed(3)}
          </span>
        )}
        <span className="ml-auto flex gap-1.5">
          {d?.content && (
            <a className="btn" href={`/api/drafts/${d.id}/pdf`} target="_blank" rel="noreferrer">
              PDF
            </a>
          )}
          {props.actions}
        </span>
      </header>
      <div className={`space-y-3 p-3 ${props.busy ? "opacity-60" : ""}`}>
        {props.children ?? <p className="faint text-[12px]">Not drafted yet.</p>}
      </div>
    </section>
  );
}

/** The cover letter's questions: answer what you like, then write. Empty answers are fine. */
function Questions(props: { answers: LetterQA[]; busy: boolean; submitLabel?: string; onWrite: (qa: LetterQA[]) => void }) {
  const [qa, setQa] = useState(props.answers);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        props.onWrite(qa);
      }}
    >
      {!props.submitLabel && <p className="muted text-[12px]">A line or two from you makes the letter sound like you. Skip any you like.</p>}
      {qa.map((a, i) => (
        <label key={i} className="field">
          <span className="text-[13px]">{a.question}</span>
          <textarea
            rows={2}
            className={GROW}
            value={a.answer}
            onChange={(e) => setQa(qa.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
          />
        </label>
      ))}
      <div className="flex gap-1.5">
        <button type="submit" className="btn-primary" disabled={props.busy}>
          {props.busy ? "Writing…" : (props.submitLabel ?? "Write letter")}
        </button>
        {!props.submitLabel && (
          <button type="button" className="btn" disabled={props.busy} onClick={() => props.onWrite(qa.map((x) => ({ ...x, answer: "" })))}>
            Skip questions
          </button>
        )}
      </div>
    </form>
  );
}

/** Save button with a short "Saved" confirmation. */
function useSave(id: string) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const save = async (content: CvDraft | LetterDraft) => {
    setState("saving");
    await saveDraft(id, content);
    setState("saved");
    setTimeout(() => setState("idle"), 2000);
  };
  const label = state === "saving" ? "Saving…" : state === "saved" ? "✓ Saved" : "Save edits";
  return { save, label, saving: state === "saving" };
}

/** Text boxes grow with their text (field-sizing), so nothing hides behind a scrollbar. */
const GROW = "input resize-none [field-sizing:content]";

/** One box per bullet, so a long, wrapped bullet can't be mistaken for two. Empty ones are dropped on save. */
function BulletsField(props: { label: ReactNode; items: string[]; onChange: (items: string[]) => void }) {
  return (
    <fieldset className="field">
      <legend className="label mb-1 normal-case">{props.label}</legend>
      <div className="space-y-1">
        {props.items.map((b, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="faint pt-1.5" aria-hidden="true">
              •
            </span>
            <textarea
              rows={1}
              className={`${GROW} min-w-0 flex-1`}
              value={b}
              aria-label={`Bullet ${i + 1}`}
              onChange={(e) => props.onChange(props.items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              className="btn btn-icon"
              title="Remove this line"
              onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}
            >
              ×<span className="sr-only">Remove this line</span>
            </button>
          </div>
        ))}
        <button type="button" className="link text-[12px]" onClick={() => props.onChange([...props.items, ""])}>
          + Add a line
        </button>
      </div>
    </fieldset>
  );
}

/** The CV as saved: no empty bullets or skills. */
const tidyCv = (cv: CvDraft): CvDraft => ({
  ...cv,
  experiences: cv.experiences.map((e) => ({ ...e, highlights: e.highlights.map((h) => h.trim()).filter(Boolean) })),
  skills: cv.skills.map((s) => s.trim()).filter(Boolean),
});

function CvEditor({ draft }: { draft: DraftRow }) {
  const [cv, setCv] = useState(draft.content as CvDraft);
  const { save, label, saving } = useSave(draft.id);
  const backed = cv.coverage.filter((c) => c.evidence.length).length;
  return (
    <>
      {cv.coverage.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer">
            <span className="mono">{backed}</span>
            <span className="muted"> of </span>
            <span className="mono">{cv.coverage.length}</span>
            <span className="muted"> requirements backed by your career</span>
          </summary>
          <ul className="mt-1.5 space-y-0.5">
            {cv.coverage.map((c) => (
              <li key={c.requirement} className="flex gap-2">
                <span className={`mono ${c.evidence.length ? "text-[var(--ok)]" : "text-[var(--warn)]"}`}>{c.evidence.length ? "✓" : "–"}</span>
                <span>
                  {c.requirement}
                  <span className="faint"> {c.evidence.length ? `· ${c.evidence.join(", ")}` : "· gap"}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Removed items={cv.removed} />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const tidy = tidyCv(cv);
          setCv(tidy);
          void save(tidy);
        }}
      >
        <label className="field">
          <span className="label">Headline</span>
          <input className="input" value={cv.headline} onChange={(e) => setCv({ ...cv, headline: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Summary</span>
          <textarea rows={3} className={GROW} value={cv.summary} onChange={(e) => setCv({ ...cv, summary: e.target.value })} />
        </label>
        {cv.experiences.map((r, i) => (
          <BulletsField
            key={`${r.company}-${i}`}
            label={
              <>
                {r.title} · {r.company}{" "}
                <span className="mono faint whitespace-nowrap">
                  {[formatCareerDate(r.start), formatCareerDate(r.end)].filter(Boolean).join(" – ")}
                </span>
              </>
            }
            items={r.highlights}
            onChange={(highlights) => setCv({ ...cv, experiences: cv.experiences.map((x, j) => (j === i ? { ...x, highlights } : x)) })}
          />
        ))}
        {cv.projects.map((p, i) => (
          <label key={`${p.name}-${i}`} className="field">
            <span className="label normal-case">Project · {p.name}</span>
            <textarea
              rows={2}
              className={GROW}
              value={p.description}
              onChange={(e) => setCv({ ...cv, projects: cv.projects.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })}
            />
          </label>
        ))}
        <label className="field">
          <span className="label">Skills</span>
          <textarea
            rows={2}
            className={GROW}
            value={cv.skills.join(", ")}
            onChange={(e) => setCv({ ...cv, skills: e.target.value.split(",").map((s) => s.trimStart()) })}
          />
        </label>
        <p className="faint text-[12px]">Titles, companies and dates come from your career. Skills: comma-separated.</p>
        <button type="submit" className="btn" disabled={saving}>
          {label}
        </button>
      </form>
    </>
  );
}

function LetterEditor({ draft }: { draft: DraftRow }) {
  const [letter, setLetter] = useState(draft.content as LetterDraft);
  const { save, label, saving } = useSave(draft.id);
  return (
    <>
      <Removed items={letter.flagged} title="flagged by the fact check" />
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(letter);
        }}
      >
        <input className="input" value={letter.greeting} onChange={(e) => setLetter({ ...letter, greeting: e.target.value })} aria-label="Greeting" />
        {letter.paragraphs.map((p, i) => (
          <textarea
            key={i}
            rows={4}
            className={GROW}
            value={p}
            aria-label={`Paragraph ${i + 1}`}
            onChange={(e) => setLetter({ ...letter, paragraphs: letter.paragraphs.map((x, j) => (j === i ? e.target.value : x)) })}
          />
        ))}
        <input className="input" value={letter.closing} onChange={(e) => setLetter({ ...letter, closing: e.target.value })} aria-label="Closing" />
        <p className="faint text-[12px]">
          <span className="mono">{letter.paragraphs.join(" ").split(/\s+/).filter(Boolean).length}</span> words. Your name is added under the closing.
        </p>
        <button type="submit" className="btn" disabled={saving}>
          {label}
        </button>
      </form>
    </>
  );
}

function Removed({ items, title = "removed by the fact check" }: { items: string[]; title?: string }) {
  if (!items.length) return null;
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer text-[var(--warn)]">
        <span className="mono">{items.length}</span> {items.length === 1 ? "line" : "lines"} {title}
      </summary>
      <ul className="muted mt-1.5 list-disc space-y-0.5 pl-4">
        {items.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </details>
  );
}
