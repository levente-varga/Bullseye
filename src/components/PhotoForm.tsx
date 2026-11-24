"use client";

import { useActionState } from "react";
import { removePhoto, uploadPhoto, type PhotoResult } from "@/app/(app)/actions";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";

/** Profile photo for CVs: preview, upload (JPEG/PNG, up to 2 MB) and remove. */
export function PhotoForm({ photoUrl }: { photoUrl: string | null }) {
  const [result, action] = useActionState<PhotoResult, FormData>(uploadPhoto, null);
  return (
    <div className="flex flex-wrap items-center gap-4 p-3">
      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--bg)]">
        {photoUrl ? (
          // A signed, short-lived URL from the private bucket: next/image can't cache it usefully.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="Your photo" className="size-full object-cover" />
        ) : (
          <span className="faint text-[11px]">No photo</span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input
            name="photo"
            type="file"
            accept="image/jpeg,image/png"
            required
            className="max-w-full min-w-0 text-[13px] file:mr-3 file:cursor-pointer file:border file:border-[var(--border-strong)] file:bg-[var(--surface)] file:px-2.5 file:py-1 file:text-[13px] file:text-[var(--fg)]"
          />
          <SubmitButton className="btn-primary">{photoUrl ? "Replace" : "Upload"}</SubmitButton>
          {photoUrl && (
            <SubmitButton formAction={removePhoto} formNoValidate className="btn btn-danger">
              Remove
            </SubmitButton>
          )}
        </form>
        <p className="faint text-[12px]">JPEG or PNG, up to 2 MB. Square works best. Only used on CVs, and only if you turn it on below.</p>
        {result && (
          <Notice key={result.at} tone={result.tone} autoHideMs={result.tone === "ok" ? 6000 : 0}>
            {result.message}
          </Notice>
        )}
      </div>
    </div>
  );
}
