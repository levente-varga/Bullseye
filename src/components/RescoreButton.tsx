"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { rescoreJob, type RescoreResult } from "@/app/(app)/actions";
import { IconRefresh } from "./icons";

/**
 * Re-scores one Inbox job now: filters with today's criteria, then a fresh AI score.
 * Sits in the row's <summary>, so the click mustn't open or close the row.
 */
export function RescoreButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RescoreResult | null>(null);

  useEffect(() => {
    if (result?.tone !== "ok") return;
    const t = setTimeout(() => setResult(null), 5000);
    return () => clearTimeout(t);
  }, [result]);

  return (
    <span className="inline-flex items-center gap-1.5">
      {result && (
        <span
          role="status"
          className={`mono whitespace-nowrap text-[12px] ${result.tone === "ok" ? "muted" : "text-[var(--bad)]"}`}
          title={result.message}
        >
          {result.short}
        </span>
      )}
      <button
        type="button"
        className="btn btn-icon"
        title="Re-score this job now: your current filters, career and preferences"
        disabled={pending}
        onClick={(e) => {
          e.preventDefault(); // a button in a <summary> would toggle the row
          e.stopPropagation();
          setResult(null);
          start(async () => {
            const r = await rescoreJob(id);
            setResult(r);
            router.refresh();
          });
        }}
      >
        <IconRefresh className={pending ? "animate-spin" : undefined} />
        <span className="sr-only">{pending ? "Re-scoring…" : "Re-score this job"}</span>
      </button>
    </span>
  );
}
