import { formatEstimate, type Estimate } from "@/lib/estimates";

/**
 * An estimated cost inside (or beside) the button that spends it: "~$0.02" from the
 * person's own last tasks, "≈$0.02" when it's borrowed or typical. Quiet, so the label leads.
 */
export function Price({ estimate }: { estimate: Estimate }) {
  return (
    <span
      className="mono text-[11px] font-normal opacity-70"
      title={
        estimate.guessed
          ? "Estimated AI cost: a typical task of this kind, priced at the current model"
          : "Estimated AI cost: the average of your last 5 such tasks, priced at the current model"
      }
    >
      {formatEstimate(estimate)}
    </span>
  );
}
