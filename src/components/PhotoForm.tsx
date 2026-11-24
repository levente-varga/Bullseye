"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { removePhoto, uploadPhoto, type PhotoResult } from "@/app/(app)/actions";
import { IconTrash } from "@/components/icons";
import { SubmitButton } from "@/components/SubmitButton";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png"];
const HINT = "JPEG or PNG, up to 2 MB. Square works best. Only used on CVs, and only if you turn it on.";

/**
 * Profile photo for CVs: preview, upload (JPEG/PNG, up to 2 MB) and remove. The file is
 * checked here before it's sent: a file over the server's request limit would otherwise
 * fail the whole request. Messages replace the hint line, so the panel keeps its height.
 */
export function PhotoForm({ photoUrl }: { photoUrl: string | null }) {
  const [result, action] = useActionState<PhotoResult, FormData>(uploadPhoto, null);
  // A problem with the chosen file, found before upload; cleared by the next choice or upload.
  const [fileError, setFileError] = useState<string | null>(null);

  return (
    <div className="flex items-start gap-4 p-3">
      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--bg)]">
        {photoUrl ? (
          // A signed, short-lived URL from the private bucket: next/image can't cache it usefully.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="Your photo" className="size-full object-cover" />
        ) : (
          <span className="faint text-[11px]">No photo</span>
        )}
      </div>
      <form
        action={action}
        onSubmit={(e) => {
          if (fileError) e.preventDefault();
        }}
        className="min-w-0 flex-1 space-y-2"
      >
        <input
          name="photo"
          type="file"
          accept={TYPES.join(",")}
          required
          onChange={(e) => {
            const f = e.target.files?.[0];
            setFileError(
              !f
                ? null
                : !TYPES.includes(f.type)
                  ? "Only JPEG and PNG images are supported."
                  : f.size > MAX_BYTES
                    ? `That image is ${(f.size / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB.`
                    : null,
            );
          }}
          className="block max-w-full min-w-0 text-[13px] file:mr-3 file:cursor-pointer file:border file:border-[var(--border-strong)] file:bg-[var(--surface)] file:px-2.5 file:py-1 file:text-[13px] file:text-[var(--fg)]"
        />
        <div className="flex flex-wrap gap-2">
          <SubmitButton className="btn-primary" disabled={Boolean(fileError)}>
            {photoUrl ? "Replace" : "Upload"}
          </SubmitButton>
          {/* Always there (disabled without a photo), so uploading doesn't reflow the row. */}
          <SubmitButton
            formAction={removePhoto}
            formNoValidate
            disabled={!photoUrl}
            className="btn btn-icon btn-danger"
            title="Remove the photo"
            aria-label="Remove the photo"
          >
            <IconTrash />
          </SubmitButton>
        </div>
        <Status fileError={fileError} result={result} />
      </form>
    </div>
  );
}

/** One line under the buttons: the file problem, "Uploading…", the result, or the hint. Two lines' height, always. */
function Status({ fileError, result }: { fileError: string | null; result: PhotoResult }) {
  const { pending } = useFormStatus();
  // A success goes back to the hint after a few seconds; an error stays until the next try.
  const [doneAt, setDoneAt] = useState<number | null>(null);
  useEffect(() => {
    if (result?.tone !== "ok") return;
    const t = setTimeout(() => setDoneAt(result.at), 5000);
    return () => clearTimeout(t);
  }, [result]);
  const fresh = result && result.at !== doneAt;
  const [text, tone] = fileError
    ? [fileError, "bad"]
    : pending
      ? ["Uploading…", "muted"]
      : result && fresh
        ? [result.message, result.tone === "ok" ? "ok" : "bad"]
        : [HINT, "faint"];
  const color = tone === "bad" ? "text-[var(--bad)]" : tone === "ok" ? "text-[var(--ok)]" : tone;
  return (
    <p role="status" className={`min-h-[2lh] text-[12px] ${color}`}>
      {text}
    </p>
  );
}
