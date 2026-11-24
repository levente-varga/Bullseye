"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { rescoreJob, type RescoreResult } from "@/app/(app)/actions";
import { IconRefresh } from "./icons";

/**
 * Re-scores one Inbox job now (in its opened row): filters with today's criteria, then a
 * fresh AI score. The row's reasoning reloads once the new score is in.
 */
export function RescoreButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RescoreResult | null>(null);

  return (
    <div className="space-y-2">
      <div className="eyebrow">Score out of date?</div>
      <button
        type="button"
        className="btn inline-flex items-center gap-1.5"
        disabled={pending}
        onClick={() => {
          setResult(null);
          start(async () => {
            const r = await rescoreJob(id);
            setResult(r);
            router.refresh();
          });
        }}
      >
        <IconRefresh className={pending ? "animate-spin" : undefined} />
        {pending ? "Re-scoring…" : "Re-score now"}
      </button>
      {result ? (
        <p role="status" className={`text-[12px] ${result.tone === "ok" ? "muted" : "text-[var(--bad)]"}`}>
          {result.message}
        </p>
      ) : (
        <p className="faint text-[12px]">Filters and scores this job again with your current criteria, career and past decisions.</p>
      )}
    </div>
  );
}
