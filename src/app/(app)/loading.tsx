export default function Loading() {
  return (
    <div aria-busy="true">
      <div className="skeleton mb-3 h-9 w-48" />
      <div className="skeleton mb-8 h-4 w-96 max-w-full" />
      <div className="panel">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-4 border-b border-[var(--border)] px-3 py-4 last:border-0">
            <div className="skeleton h-4 w-6" />
            <div className="skeleton h-4 w-16" />
            <div className="skeleton h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
