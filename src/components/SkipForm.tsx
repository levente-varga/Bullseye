import { skipJob } from "@/app/(app)/actions";
import { SKIP_REASONS } from "@/lib/types";
import { SubmitButton } from "./SubmitButton";

/** "Skip because…" chips + free text, shown in an opened Inbox row. The reasons tune the scorer. */
export function SkipForm({ id }: { id: string }) {
  return (
    <form action={skipJob} className="space-y-2.5">
      <input type="hidden" name="id" value={id} />
      <div className="eyebrow">Skip because</div>
      <div className="flex flex-wrap gap-1.5">
        {SKIP_REASONS.map((r) => (
          <label key={r} className="chip">
            <input type="checkbox" name="reasons" value={r} className="sr-only" />
            {r}
          </label>
        ))}
      </div>
      <input name="other" placeholder="Other reason (optional)" className="input" />
      <SubmitButton className="btn">Skip</SubmitButton>
    </form>
  );
}
