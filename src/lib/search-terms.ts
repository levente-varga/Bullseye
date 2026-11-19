/**
 * The searches a searchable aggregator (Platsbanken, Himalayas, Jobindex, jobs.ch) runs:
 * its followers' target roles, so nobody configures queries and each search serves
 * everyone who wants it. Searches match the whole posting, so they fetch a superset;
 * each follower's own filters still decide what they see.
 *
 *  1. Every follower's roles, lowercased and trimmed.
 *  2. Spellings of one role ("front end", "front-end", "frontend") become one search: the
 *     joined spelling if someone typed it, else the first. (Local filters still check
 *     every spelling a person entered.)
 *  3. A role that contains another as whole words is dropped: searching "developer"
 *     already returns everything "game developer" would.
 *  4. At most `max` searches per run. Beyond that the terms take turns (`turn` advances
 *     daily), so each is still searched every few days.
 */
export function searchTerms(rolesPerFollower: string[][], max = 15, turn = dayNumber()): string[] {
  const spellings = new Map<string, string[]>();
  for (const role of rolesPerFollower.flat()) {
    const term = role.toLowerCase().replace(/\s+/g, " ").trim();
    if (term.length < 2) continue;
    const key = term.replace(/[\s-]+/g, "");
    spellings.set(key, [...(spellings.get(key) ?? []), term]);
  }
  const all = [...spellings.values()].map((s) => s.find((t) => !/[\s-]/.test(t)) ?? s[0]);
  const kept = [...new Set(all)].filter((t) => !all.some((other) => other !== t && containsWords(t, other))).sort();
  if (kept.length <= max) return kept;
  const start = turn % kept.length;
  return Array.from({ length: max }, (_, i) => kept[(start + i) % kept.length]);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `term` contains `part` as whole words ("game developer" contains "developer"). */
function containsWords(term: string, part: string): boolean {
  return new RegExp(`(^|\\W)${escape(part)}($|\\W)`).test(term);
}

const dayNumber = () => Math.floor(Date.now() / 86_400_000);
