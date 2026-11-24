"use client";

import { useActionState, useRef, useState, type FormEvent, type ReactNode } from "react";
import { careerFromJson, careerFromPdf, saveCareer, type CareerResult } from "@/app/(app)/actions";
import { EMPTY_CAREER, formatCareerDate, type Career, type Education, type Experience, type Project } from "@/lib/career-schema";
import { Menu } from "@/components/Menu";
import { Notice } from "@/components/Notice";
import { Price } from "@/components/Price";
import { SubmitButton } from "@/components/SubmitButton";
import type { Estimate } from "@/lib/estimates";
import Link from "next/link";
import { Empty, Panel, Pill } from "@/components/ui";

const NEW_EXPERIENCE: Experience = { title: "", company: "", location: "", start: "", end: "", kind: "", summary: "", highlights: [], skills: [] };
const NEW_EDUCATION: Education = { degree: "", school: "", location: "", start: "", end: "", details: "" };
const NEW_PROJECT: Project = { name: "", description: "", skills: [], url: "" };

const REPLACE_WARNING = "This replaces your whole career, including anything you edited by hand. Export it first if you want a backup. Continue?";

/**
 * The career on the Profile page: the one description of the person that the scorer
 * reads and drafts are built from. Filled from a CV PDF (read by the writing model; the
 * PDF isn't kept), restored from an exported JSON file, or entered by hand; shown as
 * lists and edited here. Export downloads it as JSON, e.g. as a backup before a PDF import.
 */
export function CareerSection(props: { career: Career | null; updatedAt: string | null; importEstimate: Estimate; isAdmin: boolean }) {
  const career = props.career;
  const [editing, setEditing] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [draft, setDraft] = useState<Career>(career ?? EMPTY_CAREER);
  const [pdfResult, pdfAction] = useActionState<CareerResult, FormData>(careerFromPdf, null);
  const [jsonResult, jsonAction] = useActionState<CareerResult, FormData>(careerFromJson, null);
  const jsonForm = useRef<HTMLFormElement>(null);
  const jsonField = useRef<HTMLInputElement>(null);
  const jsonFile = useRef<HTMLInputElement>(null);
  const result = [pdfResult, jsonResult].filter(Boolean).sort((a, b) => b!.at - a!.at)[0] ?? null;

  const confirmReplace = (e: FormEvent) => {
    if (career && !window.confirm(REPLACE_WARNING)) e.preventDefault();
  };

  /** Reads the chosen JSON file and submits its text to the import action. */
  async function importJson(file: File | undefined) {
    if (!file || !jsonForm.current || !jsonField.current) return;
    if (career && !window.confirm(REPLACE_WARNING)) return;
    jsonField.current.value = await file.text();
    jsonForm.current.requestSubmit();
  }

  function exportJson() {
    if (!career) return;
    const blob = new Blob([JSON.stringify({ bullseye_career: 1, exported_at: new Date().toISOString(), career }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `career-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

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

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {career ? (
        <button type="button" className="btn" onClick={() => (setDraft(career), setEditing(true))}>
          Edit
        </button>
      ) : (
        <button type="button" className="btn-primary" onClick={() => (setDraft(EMPTY_CAREER), setEditing(true))}>
          Fill in by hand
        </button>
      )}
      <Menu
        label="Import"
        items={[
          { label: "From a CV PDF…", onSelect: () => setPdfOpen(true) },
          { label: "From a JSON export…", onSelect: () => jsonFile.current?.click() },
        ]}
      />
      {career && <Menu label="Export" items={[{ label: "As JSON", onSelect: exportJson }]} />}
      {career && props.updatedAt && (
        // A fixed locale and timezone: the server and the browser must render the same text.
        <span className="hint">
          updated {new Date(props.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
        </span>
      )}
      {/* JSON import: the file is read here and its text posted to the action. */}
      <input ref={jsonFile} type="file" accept="application/json,.json" className="hidden" onChange={(e) => (importJson(e.target.files?.[0]), (e.target.value = ""))} />
      <form ref={jsonForm} action={jsonAction} className="hidden">
        <input ref={jsonField} type="hidden" name="json" />
      </form>
    </div>
  );

  const pdfPanel = pdfOpen && (
    <Panel
      title="Import from a CV PDF"
      aside={
        <button type="button" onClick={() => setPdfOpen(false)} className="link cursor-pointer font-sans text-[12px] normal-case tracking-normal">
          Cancel
        </button>
      }
    >
      <form action={pdfAction} onSubmit={confirmReplace} className="flex flex-wrap items-center gap-3 p-3">
        <input
          name="cv"
          type="file"
          accept="application/pdf,.pdf"
          required
          className="max-w-full min-w-0 text-[13px] file:mr-3 file:cursor-pointer file:border file:border-[var(--border-strong)] file:bg-[var(--surface)] file:px-2.5 file:py-1 file:text-[13px] file:text-[var(--fg)]"
        />
        <SubmitButton className="btn-primary inline-flex items-center gap-2">
          Read PDF <Price estimate={props.importEstimate} />
        </SubmitButton>
        <p className="hint w-full">
          Read by the{" "}
          {props.isAdmin ? (
            <Link href="/settings" className="link">
              writing model
            </Link>
          ) : (
            "writing model (set by the admin)"
          )}
          , using only what the CV says. The PDF isn&apos;t kept.{career ? " Replaces the career below." : ""}
        </p>
      </form>
    </Panel>
  );

  const notice = result && (
    <Notice key={result.at} tone={result.tone} className="" autoHideMs={result.tone === "ok" ? 15000 : 0}>
      {result.message}
    </Notice>
  );

  if (!career) {
    return (
      <div className="space-y-4">
        <Panel title="Your career">
          <p className="muted p-3 text-[13px] leading-relaxed">
            Your roles, education, projects and skills: what the scorer reads, and what CV and cover letter drafts will be built
            from. Import them from your CV, restore an export, or fill them in yourself. Until there&apos;s a career, nothing is scored.
          </p>
        </Panel>
        {toolbar}
        {pdfPanel}
        {notice}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {toolbar}
        {pdfPanel}
        {notice}
      </div>

      {career.summary && (
        <Panel title="Summary">
          <p className="p-3 text-[13px] leading-relaxed">{career.summary}</p>
        </Panel>
      )}

      <Panel title="Experience" aside={career.experiences.length}>
        {career.experiences.length === 0 ? (
          <Empty>No roles yet.</Empty>
        ) : (
          <ol className="divide">
            {career.experiences.map((e, i) => (
              <li key={i} className="space-y-1.5 p-3 text-[13px]">
                <Heading title={e.title} sub={e.company} start={e.start} end={e.end} />
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
          <Empty>No education yet.</Empty>
        ) : (
          <ol className="divide">
            {career.education.map((e, i) => (
              <li key={i} className="space-y-1 p-3 text-[13px]">
                <Heading title={e.degree} sub={e.school} start={e.start} end={e.end} />
                <Meta items={[e.location]} />
                {e.details && <p className="leading-relaxed">{e.details}</p>}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {career.projects.length > 0 && (
        <Panel title="Projects" aside={career.projects.length}>
          <ol className="divide">
            {career.projects.map((p, i) => (
              <li key={i} className="space-y-1.5 p-3 text-[13px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{p.name}</span>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer" className="link mono text-[12px]">
                      {p.url.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </div>
                {p.description && <p className="leading-relaxed">{p.description}</p>}
                {p.skills.length > 0 && <Chips items={p.skills} />}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Skills">
          {career.skills.length === 0 ? (
            <Empty>No skills yet.</Empty>
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
          {career.certifications.length > 0 && (
            <Panel title="Certifications">
              <ul className="divide text-[13px]">
                {career.certifications.map((c, i) => (
                  <li key={i} className="flex justify-between gap-3 px-3 py-2">
                    <span>
                      {c.name}
                      {c.issuer && <span className="muted"> · {c.issuer}</span>}
                    </span>
                    <span className="mono faint text-[12px]">{formatCareerDate(c.date)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
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

      {career.other && (
        <Panel title="Other">
          <p className="p-3 text-[13px] leading-relaxed whitespace-pre-line">{career.other}</p>
        </Panel>
      )}
    </div>
  );
}

function Heading({ title, sub, start, end }: { title: string; sub: string; start: string; end: string }) {
  const dates = [formatCareerDate(start), formatCareerDate(end)].filter(Boolean).join(" – ");
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span>
        <span className="font-medium">{title}</span>
        {sub && <span className="muted"> · {sub}</span>}
      </span>
      {dates && <span className="mono faint shrink-0 text-[12px]">{dates}</span>}
    </div>
  );
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
  projects: c.projects.map((p) => ({ ...p, skills: clean(p.skills) })).filter((p) => p.name.trim() || p.description.trim()),
  skills: c.skills.map((g) => ({ ...g, items: clean(g.items) })).filter((g) => g.group.trim() || g.items.length),
  languages: c.languages.filter((l) => l.language.trim()),
  certifications: c.certifications.filter((x) => x.name.trim()),
  awards: c.awards.filter((a) => a.title.trim()),
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
  const tools = <T,>(key: "experiences" | "education" | "projects", list: T[], i: number) => (
    <EntryTools
      onUp={i > 0 ? () => set({ [key]: move(list, i, -1) }) : undefined}
      onDown={i < list.length - 1 ? () => set({ [key]: move(list, i, 1) }) : undefined}
      onRemove={() => set({ [key]: list.filter((_, j) => j !== i) })}
    />
  );

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
              {tools("experiences", d.experiences, i)}
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
              {tools("education", d.education, i)}
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

      <Panel title="Projects" aside={<AddButton onClick={() => set({ projects: [NEW_PROJECT, ...d.projects] })}>Add project</AddButton>}>
        <ol className="divide">
          {d.projects.map((p, i) => (
            <li key={i} className="space-y-2 p-3">
              {tools("projects", d.projects, i)}
              <Grid>
                <Text label="Name" value={p.name} onChange={(v) => set({ projects: setAt(d.projects, i, { name: v }) })} />
                <Text label="Link" value={p.url} placeholder="https://…" mono onChange={(v) => set({ projects: setAt(d.projects, i, { url: v }) })} />
              </Grid>
              <Area label="What it is, and your part" value={p.description} rows={2} onChange={(v) => set({ projects: setAt(d.projects, i, { description: v }) })} />
              <Text label="Skills (comma-separated)" value={p.skills.join(", ")} onChange={(v) => set({ projects: setAt(d.projects, i, { skills: commas(v) }) })} />
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
              <RemoveButton onClick={() => set({ skills: d.skills.filter((_, j) => j !== i) })} />
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
              <RemoveButton onClick={() => set({ languages: d.languages.filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ol>
      </Panel>

      <Panel
        title="Certifications"
        aside={<AddButton onClick={() => set({ certifications: [...d.certifications, { name: "", issuer: "", date: "" }] })}>Add certification</AddButton>}
      >
        <ol className="divide">
          {d.certifications.map((x, i) => (
            <li key={i} className="grid gap-2 p-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
              <Text label="Name" value={x.name} onChange={(v) => set({ certifications: setAt(d.certifications, i, { name: v }) })} />
              <Text label="Issuer" value={x.issuer} onChange={(v) => set({ certifications: setAt(d.certifications, i, { issuer: v }) })} />
              <Text label="Date" value={x.date} placeholder="2024-05" mono onChange={(v) => set({ certifications: setAt(d.certifications, i, { date: v }) })} />
              <RemoveButton onClick={() => set({ certifications: d.certifications.filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Awards" aside={<AddButton onClick={() => set({ awards: [...d.awards, { title: "", issuer: "", date: "", details: "" }] })}>Add award</AddButton>}>
        <ol className="divide">
          {d.awards.map((a, i) => (
            <li key={i} className="space-y-2 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
                <Text label="Title" value={a.title} onChange={(v) => set({ awards: setAt(d.awards, i, { title: v }) })} />
                <Text label="Issuer" value={a.issuer} onChange={(v) => set({ awards: setAt(d.awards, i, { issuer: v }) })} />
                <Text label="Date" value={a.date} placeholder="2023" mono onChange={(v) => set({ awards: setAt(d.awards, i, { date: v }) })} />
                <RemoveButton onClick={() => set({ awards: d.awards.filter((_, j) => j !== i) })} />
              </div>
              <Text label="Details" value={a.details} onChange={(v) => set({ awards: setAt(d.awards, i, { details: v }) })} />
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Other">
        <div className="p-3">
          <textarea
            className="input"
            rows={3}
            value={d.other}
            onChange={(e) => set({ other: e.target.value })}
            placeholder="Anything else worth knowing: publications, volunteering, interests…"
          />
        </div>
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

function RemoveButton(props: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn-field" onClick={props.onClick}>
      Remove
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
