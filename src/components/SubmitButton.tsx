"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A form's submit button that shows progress (top bar + dimmed, disabled) while its form submits. */
export function SubmitButton({ className, children }: { className: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className={`${className} ${pending ? "cursor-wait opacity-60" : ""}`} disabled={pending} aria-busy={pending}>
      {children}
      {pending && <span className="pending-bar" aria-hidden />}
    </button>
  );
}
