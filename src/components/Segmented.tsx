import Link from "next/link";
import { PendingBar } from "./PendingBar";

/** A row of joined toggle links (e.g. Inbox "Above threshold | All scored"). Each option is a URL, so it works without JS. */
export function Segmented(props: { options: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="inline-flex border border-[var(--border-strong)] text-[12px]">
      {props.options.map((o, i) => (
        <Link
          key={o.href}
          href={o.href}
          scroll={false}
          className={`px-2.5 py-1 ${i > 0 ? "border-l border-[var(--border-strong)]" : ""} ${o.active ? "bg-[var(--surface-2)]" : "muted"}`}
        >
          {o.label}
          <PendingBar />
        </Link>
      ))}
    </div>
  );
}
