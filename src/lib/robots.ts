import { USER_AGENT } from "./ats";

/**
 * robots.txt checks for pages we haven't reviewed by hand (companies' own job pages that
 * aggregators link to). Rules are fetched once per site per process and follow the usual
 * reading (RFC 9309): the group for our bot (BullseyeBot) or else "*"; the longest
 * matching rule wins, Allow on a tie; "*" and "$" wildcards. No robots.txt (404) means
 * allowed; a site that can't answer (5xx, timeout) is treated as disallowing everything.
 */

const BOT = "bullseyebot";
type Rule = { allow: boolean; pattern: RegExp; length: number };
const cache = new Map<string, Promise<Rule[]>>();

const DISALLOW_ALL: Rule[] = [{ allow: false, pattern: /^\//, length: 1 }];

function toRegex(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

/** The rules that apply to us: the BullseyeBot group(s) if any, else the "*" group(s). */
export function parseRobots(text: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (key !== "allow" && key !== "disallow")) continue;
    if (key === "disallow" && value === "") continue; // "Disallow:" with nothing allows everything
    current.rules.push({ allow: key === "allow", pattern: toRegex(value), length: value.length });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && BOT.includes(a.replace(/\/.*$/, ""))));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

export function allowedBy(rules: Rule[], pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!r.pattern.test(pathAndQuery)) continue;
    if (!best || r.length > best.length || (r.length === best.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

async function rulesFor(origin: string): Promise<Rule[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 400 && res.status < 500) return []; // no robots.txt: everything allowed
    if (!res.ok) return DISALLOW_ALL;
    return parseRobots(await res.text());
  } catch {
    return DISALLOW_ALL;
  }
}

/** Whether robots.txt lets BullseyeBot fetch this URL. */
export async function robotsAllows(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!cache.has(u.origin)) cache.set(u.origin, rulesFor(u.origin));
  return allowedBy(await cache.get(u.origin)!, u.pathname + u.search);
}
