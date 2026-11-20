"use client";

import { useActionState, useState, type ReactNode } from "react";
import { extractCareerAction, saveCareer, type CareerResult } from "@/app/(app)/actions";
import { EMPTY_CAREER, formatCareerDate, type Career, type Education, type Experience } from "@/lib/career-schema";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Panel, Pill } from "@/components/ui";

const NEW_EXPERIENCE: Experience = { title: "", company: "", location: "", start: "", end: "", kind: "", summary: "", highlights: [], skills: [] };
const NEW_EDUCATION: Education = { degree: "", school: "", location: "", start: "", end: "", details: "" };

/**
 * The structured career on the Profile page: built from the CV text by the model, or
 * filled in by hand; shown as lists and edited here (Edit → change, add, remove,
 * reorder → Save).
 */
export function CareerSection(props: { career: Career | null; updatedAt: string | null; hasCv: boolean; modelLabel: string }) {
  const [editing, setEditing] = useState(false);
  const [rebuild, setRebuild] = useState(false);
  const [draft, setDraft] = useState<Career>(props.career ?? EMPTY_CAREER);
  const [result, extract] = useActionState<CareerResult>(extractCareerAction, null);
  const career = props.career;

  const extractForm = (
    <form action={extract} className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className="btn-primary" disabled={!props.hasCv}>
          {career ? "Rebuild from CV" : "Build from CV"}
        </SubmitButton>
        <span className="hint">
          {props.hasCv
            ? `${props.modelLabel} reads your CV and lists only what it says${props.modelLabel.includes("Haiku") ? "; under a cent" : ""}.${career ? " Replaces the career below." : ""}`
            : "Add your CV below first (PDF or text)."}
        </span>
      </div>
      {result && (
        <Notice key={result.at} tone={result.tone} className="" autoHideMs={result.tone === "ok" ? 15000 : 0}>
          {result.message}
        </Notice>
      )}
    </form>
  );

  if (editing) {
    return (
      <CareerEditor
        draft={draft}
        setDraft={setDraft}
        onCancel={() => {
          setDraft(career ?? EMPTY_CAREER);
          setEditing(false);
        }}
        onSaved={() => setEditing(false)}
      />
    );
  }

  if (!career) {
    return (
      <Panel title="Build your career">
        <p className="muted px-3 pt-3 text-[13px]">
          Your roles, education and skills as lists: easier to check here, and what CV and cover letter drafts will be built
          from. Build them from your CV, or fill them in yourself.
        </p>
        {extractForm}
        <div className="border-t border-[var(--border)] px-3 py-2.5">
          <button type="button" className="btn" onClick={() => (setDraft(EMPTY_CAREER), setEditing(true))}>
            Fill in by hand
          </button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => (setDraft(career), setEditing(true))}>
          Edit
        </button>
        <button type="button" className="btn" onClick={() => setRebuild((v) => !v)} aria-expanded={rebuild}>
          Rebuild…
        </button>
        {props.updatedAt && <span className="hint">updated {new Date(props.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>}
      </div>
      {(rebuild || result) && <Panel title="Rebuild from CV">{extractForm}</Panel>}

      {career.summary && (
        <Panel title="Summary">
          <p className="p-3 text-[13px] leading-relaxed">{career.summary}</p>
        </Panel>
      )}

      <Panel title="Experience" aside={career.experiences.length}>
        {career.experiences.length === 0 ? (
          <Empty>No roles found.</Empty>
        ) : (
          <ol className="divide">
            {career.experiences.map((e, i) => (
              <li key={i} className="space-y-1.5 p-3 text-[13px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span>
                    <span className="font-medium">{e.title}</span>
                    <span className="muted"> · {e.company}</span>
                  </span>
                  <Dates start={e.start} end={e.end} />
                </div>
                <Meta items={[e.location, e.kind]} />
                {e.summary && <p className="leading-relaxed">{e.summary}</p>}
                {e.highlights.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5">
                    {e.highlights.map((h, j) => (
                      <li key={j}>{h}</li>
                    ))}
                  </ul>
                )}
                {e.skills.length > 0 && <Chips items={e.skills} />}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Education" aside={career.education.length}>
        {career.education.length === 0 ? (
          <Empty>No education found.</Empty>
        ) : (
          <ol className="divide">
            {career.education.map((e, i) => (
              <li key={i} className="space-y-1 p-3 text-[13px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span>
                    <span className="font-medium">{e.degree}</span>
                    <span className="muted"> · {e.school}</span>
                  </span>
                  <Dates start={e.start} end={e.end} />
                </div>
                <Meta items={[e.location]} />
                {e.details && <p className="leading-relaxed">{e.details}</p>}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Skills">
          {career.skills.length === 0 ? (
            <Empty>No skills found.</Empty>
          ) : (
            <div className="space-y-3 p-3 text-[13px]">
              {career.skills.map((g, i) => (
                <div key={i}>
                  <div className="label mb-1">{g.group}</div>
                  <Chips items={g.items} />
                </div>
              ))}
            </div>
          )}
        </Panel>
        <div className="space-y-6">
          <Panel title="Languages">
            {career.languages.length === 0 ? (
              <Empty>None listed.</Empty>
            ) : (
              <ul className="divide text-[13px]">
                {career.languages.map((l, i) => (
                  <li key={i} className="flex justify-between px-3 py-2">
                    <span>{l.language}</span>
                    <span className="muted">{l.level}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {career.awards.length > 0 && (
            <Panel title="Awards">
              <ul className="divide text-[13px]">
                {career.awards.map((a, i) => (
                  <li key={i} className="space-y-0.5 px-3 py-2">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{a.title}</span>
                      <span className="mono faint text-[12px]">{formatCareerDate(a.date)}</span>
                    </div>
                    {(a.issuer || a.details) && <div className="muted">{[a.issuer, a.details].filter(Boolean).join(" · ")}</div>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Dates({ start, end }: { start: string; end: string }) {
  const text = [formatCareerDate(start), formatCareerDate(end)].filter(Boolean).join(" – ");
  return text ? <span className="mono faint shrink-0 text-[12px]">{text}</span> : null;
}

function Meta({ items }: { items: string[] }) {
  const shown = items.filter(Boolean);
  return shown.length ? <div className="faint text-[12px]">{shown.join(" · ")}</div> : null;
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((s, i) => (
        <Pill key={i}>{s}</Pill>
      ))}
    </div>
  );
}

// --- Editing ----------------------------------------------------------------------------

// While typing, lists keep their raw pieces (so Enter and ", " work); tidy() cleans them on save.
const lines = (v: string) => v.split("\n");
const commas = (v: string) => v.split(",").map((s) => s.trimStart());
const clean = (xs: string[]) => xs.map((s) => s.trim()).filter(Boolean);
const tidy = (c: Career): Career => ({
  ...c,
  experiences: c.experiences.map((e) => ({ ...e, highlights: clean(e.highlights), skills: clean(e.skills) })),
  skills: c.skills.map((g) => ({ ...g, items: clean(g.items) })).filter((g) => g.group.trim() || g.items.length),
  languages: c.languages.filter((l) => l.language.trim()),
});

/** Everything editable at once; Save posts the whole career as JSON (validated server-side). */
function CareerEditor(props: { draft: Career; setDraft: (c: Career) => void; onCancel: () => void; onSaved: () => void }) {
  const { draft: d, setDraft } = props;
  const set = (patch: Partial<Career>) => setDraft({ ...d, ...patch });
  const setAt = <T,>(list: T[], i: number, patch: Partial<T>) => list.map((x, j) => (j === i ? { ...x, ...patch } : x));
  const move = <T,>(list: T[], i: number, by: number) => {
    const out = [...list];
    const [x] = out.splice(i, 1);
    out.splice(Math.max(0, Math.min(out.length, i + by)), 0, x);
    return out;
  };

  return (
    <form
      action={async (form) => {
        await saveCareer(form);
        props.onSaved();
      }}
      className="space-y-6"
    >
      <input type="hidden" name="career" value={JSON.stringify(tidy(d))} />

      <Panel title="Summary">
        <div className="p-3">
          <textarea className="input" rows={3} value={d.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="Optional" />
        </div>
      </Panel>

      <Panel title="Experience" aside={<AddButton onClick={() => set({ experiences: [NEW_EXPERIENCE, ...d.experiences] })}>Add role</AddButton>}>
        <ol className="divide">
          {d.experiences.map((e, i) => (
            <li key={i} className="space-y-2 p-3">
              <EntryTools
                onUp={i > 0 ? () => set({ experiences: move(d.experiences, i, -1) }) : undefined}
                onDown={i < d.experiences.length - 1 ? () => set({ experiences: move(d.experiences, i, 1) }) : undefined}
                onRemove={() => set({ experiences: d.experiences.filter((_, j) => j !== i) })}
              />
              <Grid>
                <Text label="Title" value={e.title} onChange={(v) => set({ experiences: setAt(d.experiences, i, { title: v }) })} />
                <Text label="Company" value={e.company} onChange={(v) => set({ experiences: setAt(d.experiences, i, { company: v }) })} />
                <Text label="Location" value={e.location} onChange={(v) => set({ experiences: setAt(d.experiences, i, { location: v }) })} />
                <Text label="Type" value={e.kind} placeholder="full-time, contract…" onChange={(v) => set({ experiences: setAt(d.experiences, i, { kind: v }) })} />
                <Text label="Start" value={e.start} placeholder="2023-06" mono onChange={(v) => set({ experiences: setAt(d.experiences, i, { start: v }) })} />
                <Text label="End" value={e.end} placeholder="2024-01 or present" mono onChange={(v) => set({ experiences: setAt(d.experiences, i, { end: v }) })} />
              </Grid>
              <Area label="Summary" value={e.summary} rows={2} onChange={(v) => set({ experiences: setAt(d.experiences, i, { summary: v }) })} />
              <Area
                label="Highlights (one per line)"
                value={e.highlights.join("\n")}
                rows={3}
                onChange={(v) => set({ experiences: setAt(d.experiences, i, { highlights: lines(v) }) })}
              />
              <Text label="Skills (comma-separated)" value={e.skills.join(", ")} onChange={(v) => set({ experiences: setAt(d.experiences, i, { skills: commas(v) }) })} />
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Education" aside={<AddButton onClick={() => set({ education: [NEW_EDUCATION, ...d.education] })}>Add degree</AddButton>}>
        <ol className="divide">
          {d.education.map((e, i) => (
            <li key={i} className="space-y-2 p-3">
              <EntryTools
                onUp={i > 0 ? () => set({ education: move(d.education, i, -1) }) : undefined}
                onDown={i < d.education.length - 1 ? () => set({ education: move(d.education, i, 1) }) : undefined}
                onRemove={() => set({ education: d.education.filter((_, j) => j !== i) })}
              />
              <Grid>
                <Text label="Degree" value={e.degree} onChange={(v) => set({ education: setAt(d.education, i, { degree: v }) })} />
                <Text label="School" value={e.school} onChange={(v) => set({ education: setAt(d.education, i, { school: v }) })} />
                <Text label="Location" value={e.location} onChange={(v) => set({ education: setAt(d.education, i, { location: v }) })} />
                <span />
                <Text label="Start" value={e.start} placeholder="2018-09" mono onChange={(v) => set({ education: setAt(d.education, i, { start: v }) })} />
                <Text label="End" value={e.end} placeholder="2022-01" mono onChange={(v) => set({ education: setAt(d.education, i, { end: v }) })} />
              </Grid>
              <Area label="Details" value={e.details} rows={2} onChange={(v) => set({ education: setAt(d.education, i, { details: v }) })} />
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Skills" aside={<AddButton onClick={() => set({ skills: [...d.skills, { group: "", items: [] }] })}>Add group</AddButton>}>
        <ol className="divide">
          {d.skills.map((g, i) => (
            <li key={i} className="grid gap-2 p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
              <Text label="Group" value={g.group} onChange={(v) => set({ skills: setAt(d.skills, i, { group: v }) })} />
              <Text label="Skills (comma-separated)" value={g.items.join(", ")} onChange={(v) => set({ skills: setAt(d.skills, i, { items: commas(v) }) })} />
              <button type="button" className="btn btn-field" onClick={() => set({ skills: d.skills.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Languages" aside={<AddButton onClick={() => set({ languages: [...d.languages, { language: "", level: "" }] })}>Add language</AddButton>}>
        <ol className="divide">
          {d.languages.map((l, i) => (
            <li key={i} className="grid gap-2 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Text label="Language" value={l.language} onChange={(v) => set({ languages: setAt(d.languages, i, { language: v }) })} />
              <Text label="Level" value={l.level} placeholder="native, C1, fluent…" onChange={(v) => set({ languages: setAt(d.languages, i, { level: v }) })} />
              <button type="button" className="btn btn-field" onClick={() => set({ languages: d.languages.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      </Panel>

      <div className="flex gap-2">
        <SubmitButton className="btn-primary">Save career</SubmitButton>
        <button type="button" className="btn" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddButton(props: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={props.onClick} className="link cursor-pointer font-sans text-[12px] normal-case tracking-normal">
      + {props.children}
    </button>
  );
}

function EntryTools(props: { onUp?: () => void; onDown?: () => void; onRemove: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <button type="button" className="btn btn-icon" disabled={!props.onUp} onClick={props.onUp} title="Move up" aria-label="Move up">
        ↑
      </button>
      <button type="button" className="btn btn-icon" disabled={!props.onDown} onClick={props.onDown} title="Move down" aria-label="Move down">
        ↓
      </button>
      <button type="button" className="btn" onClick={props.onRemove}>
        Remove
      </button>
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2">{children}</div>;
}

function Text(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <label className="field">
      <span className="label">{props.label}</span>
      <input className={`input ${props.mono ? "mono" : ""}`} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function Area(props: { label: string; value: string; rows: number; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="label">{props.label}</span>
      <textarea className="input" rows={props.rows} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}
