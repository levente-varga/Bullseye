/** An error message: one truncated red line (the message, if it's a JSON error), the full text on click. */
export function ErrorDetails({ error }: { error: string }) {
  let message = error;
  try {
    const parsed = JSON.parse(error);
    if (parsed && typeof parsed.message === "string") message = parsed.message;
  } catch {}
  const headline = message.split("\n")[0];
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[var(--bad)] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate">{headline}</span>
        <span className="faint shrink-0 group-open:hidden">Details</span>
        <span className="faint hidden shrink-0 group-open:inline">Hide</span>
      </summary>
      <pre className="mono muted mt-2 max-h-64 overflow-auto border border-[var(--border)] bg-[var(--bg)] p-2 text-[11px] break-all whitespace-pre-wrap">
        {error}
      </pre>
    </details>
  );
}
