export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const tone =
    score >= 85
      ? "bg-emerald-600 text-white"
      : score >= 60
        ? "bg-sky-600 text-white"
        : score >= 40
          ? "bg-amber-500 text-black"
          : "bg-zinc-400 text-black";
  return (
    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold ${tone}`}>
      {score}
    </span>
  );
}
