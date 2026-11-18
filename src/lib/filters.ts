import type { Criteria, FetchedJob } from "./types";

const has = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.trim().toLowerCase());

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive match, so "staff" doesn't hit "staffing". */
const hasWord = (haystack: string, word: string) =>
  new RegExp(`(^|\\W)${escapeRe(word.trim())}($|\\W)`, "i").test(haystack);

/**
 * Cheap, deterministic filters that run before any LLM call.
 * Returns null if the job passes, or the reason it was filtered out.
 */
export function hardFilter(
  job: FetchedJob,
  c: Criteria,
  /**
   * skipKeywordCheck: no description yet, so must-have keywords can't be judged.
   * locationPending: the real location comes with the description (Workday), so don't judge it yet.
   */
  opts: { skipKeywordCheck?: boolean; locationPending?: boolean } = {},
): string | null {
  // Title only: descriptions mention almost everything in passing.
  const excluded = c.exclude_keywords.find((k) => k.trim() && hasWord(job.title, k));
  if (excluded) return `Excluded keyword: "${excluded}"`;

  if (c.roles.length && !c.roles.some((r) => r.trim() && has(job.title, r))) {
    return "Title matches none of the target roles";
  }

  if (opts.locationPending) {
    // checked again once the description (and real location) is in
  } else if (c.locations.length) {
    const locationOk = c.locations.some((l) => l.trim() && has(job.location, l));
    if (!locationOk && !(c.remote_ok && job.remote)) {
      return `Location "${job.location || "unknown"}" not in target locations`;
    }
  } else if (!c.remote_ok && job.remote && !job.location) {
    return "Remote-only and remote is turned off";
  }

  // Without a description (not fetched yet, or none available) the keyword check would wrongly reject.
  if (!opts.skipKeywordCheck && job.description && c.include_keywords.length && !c.include_keywords.some((k) => k.trim() && has(`${job.title}\n${job.description}`, k))) {
    return "Description contains none of the required keywords";
  }

  return null;
}
