"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  className: string;
  children: ReactNode;
  /** Shown briefly after the form saves, e.g. "Saved". Omit when the result is visible anyway (a row moves or disappears). */
  done?: string;
};

const DONE_MS = 2500;

/**
 * A form's submit button with feedback: while the form submits it's dimmed and
 * disabled with a progress bar (and reads "Saving…" when `done` is set); once
 * the form saves it reads "✓ <done>" for a moment. A failed save throws to the
 * error page instead, so "done" only appears on success.
 */
export function SubmitButton({ className, children, done, ...rest }: Props) {
  const { pending } = useFormStatus();
  const [justDone, setJustDone] = useState(false);
  const wasPending = useRef(false);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the form's status
      setJustDone(false);
      return;
    }
    if (!wasPending.current || !done) return;
    wasPending.current = false;
    setJustDone(true);
  }, [pending, done]);

  // Own effect, so re-running the one above can't cancel the reset.
  useEffect(() => {
    if (!justDone) return;
    const t = setTimeout(() => setJustDone(false), DONE_MS);
    return () => clearTimeout(t);
  }, [justDone]);

  const label = pending && done ? "Saving…" : justDone ? `✓ ${done}` : children;
  return (
    <button
      {...rest}
      className={`${className} ${pending ? "opacity-60" : ""}`}
      disabled={pending || rest.disabled}
      aria-busy={pending}
    >
      <span aria-live="polite">{label}</span>
      {pending && <span className="pending-bar" aria-hidden />}
    </button>
  );
}
