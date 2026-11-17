import { USER_AGENT, fetchBoard } from "./ats";
import { detectAts } from "./dedupe";
import type { Ats } from "./types";

/**
 * Turns any careers page or job posting URL into a source: which ATS the
 * company uses and its board. Tries, in order:
 *   1. the URL itself (job-boards.greenhouse.io/x, jobs.lever.co/x, ...)
 *   2. a Teamtailor RSS feed on that domain (career sites on custom domains)
 *   3. links to a known ATS inside the page (careers pages that embed a board)
 * Then fetches the board once to confirm it works.
 */
export type Detected = { ats: Ats; slug: string; companyGuess: string; jobCount: number };

const EMBEDDED: { ats: Ats; re: RegExp }[] = [
  { ats: "greenhouse", re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { ats: "lever", re: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { ats: "ashby", re: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i },
  { ats: "smartrecruiters", re: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/ },
];

export async function detectSource(input: string): Promise<Detected | { error: string }> {
  const raw = input.trim();
  if (!raw) return { error: "Paste a careers page or job posting URL." };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: `"${raw}" doesn't look like a URL.` };
  }

  const candidates: { ats: Ats; slug: string }[] = [];

  // 1. The URL itself.
  const d = detectAts(url.toString());
  if (d.ats === "greenhouse" || d.ats === "lever" || d.ats === "ashby" || d.ats === "smartrecruiters") {
    // Greenhouse embed URLs carry the board in ?for=
    const slug = d.ats === "greenhouse" ? url.searchParams.get("for") ?? d.slug : d.slug;
    if (slug && slug !== "embed") candidates.push({ ats: d.ats, slug });
  }

  // 2. Teamtailor feed on this host.
  if (!candidates.length && (await hasTeamtailorFeed(url.hostname))) {
    candidates.push({ ats: "teamtailor", slug: url.hostname.toLowerCase() });
  }

  // 3. ATS links inside the page.
  if (!candidates.length) {
    const html = await fetchText(url.toString());
    if (html) {
      for (const { ats, re } of EMBEDDED) {
        const m = html.match(re);
        if (m && !/^(embed|v\d|api)$/i.test(m[1])) candidates.push({ ats, slug: ats === "smartrecruiters" ? m[1] : m[1].toLowerCase() });
      }
    }
  }

  if (!candidates.length) {
    return {
      error:
        "Couldn't recognize the job system behind that page. Supported: Greenhouse, Lever, Ashby, Teamtailor, SmartRecruiters. " +
        "Try a link to one of the company's job postings instead of the careers homepage.",
    };
  }

  // Confirm by fetching the board; first one that works wins.
  for (const c of candidates) {
    try {
      const jobs = await fetchBoard({ ats: c.ats, slug: c.slug, company_name: "", country: null });
      return { ...c, companyGuess: guessName(c.ats, c.slug), jobCount: jobs.length };
    } catch {
      // try the next candidate
    }
  }
  return { error: `Found what looks like a ${candidates[0].ats} board ("${candidates[0].slug}"), but it didn't respond.` };
}

async function hasTeamtailorFeed(host: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}/jobs.rss`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok && (res.headers.get("content-type") ?? "").includes("xml");
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** "career.paradoxplaza.com" → "Paradoxplaza", "avalanchestudios" → "Avalanchestudios". Editable later. */
function guessName(ats: Ats, slug: string): string {
  const base =
    ats === "teamtailor"
      ? slug.split(".").find((p) => !/^(www|career|careers|jobs|job|apply|work)$/i.test(p)) ?? slug
      : slug;
  const clean = base.replace(/[-_]+/g, " ").replace(/\d+$/, "").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
