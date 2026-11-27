export default function Loading() {
  return (
    <div aria-busy="true">
      <div className="skeleton mb-3 h-9 w-48" />
      <div className="skeleton mb-8 h-4 w-96 max-w-full" />
      <div className="panel">
        {Array.from({ length: 6 }, (_, i) => (
          // Shaped like a job row: score, title over company, location, the open button.
          <div key={i} className="flex items-start gap-4 border-b border-[var(--border)] px-3 py-3 last:border-0">
            <div className="skeleton mt-1 h-2 w-9 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-3 w-1/3" />
            </div>
            <div className="skeleton hidden h-3 w-[200px] shrink-0 lg:block" />
            <div className="skeleton h-[29.5px] w-[29.5px] shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
