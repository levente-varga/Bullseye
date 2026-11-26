import { formatEstimate, type Estimate } from "@/lib/estimates";

/**
 * An estimated cost inside (or beside) the button that spends it: "~$0.02" from the
 * person's own recent tasks at this model and thinking level, "~$0.02*" when it's a guess
 * (borrowed, scaled or typical; see estimates.ts). Quiet, so the label leads.
 */
export function Price({ estimate }: { estimate: Estimate }) {
  return (
    <span
      className="mono text-[11px] font-normal opacity-70"
      title="Estimated AI cost"
    >
      {formatEstimate(estimate)}
    </span>
  );
}
