export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded bg-[var(--border)]" />
      <div className="h-24 animate-pulse rounded-lg bg-[var(--border)]" />
      <div className="h-24 animate-pulse rounded-lg bg-[var(--border)]" />
    </div>
  );
}
