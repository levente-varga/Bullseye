import { USER_AGENT, fetchBoard, probeHost, workdayTotal } from "./ats";
import { detectAts } from "./dedupe";
import { ATS_INFO, type Ats } from "./types";

/**
 * Turns any careers page or job posting URL into a source: which ATS the
 * company uses and its board. Tries, in order:
 *   1. the URL itself (job-boards.greenhouse.io/x, x.jobs.personio.de, ...)
 *   2. a Teamtailor or Recruitee feed on that domain (career sites on custom domains)
 *   3. links to a known ATS inside the page (careers pages that embed a board)
 * Then fetches the board once to confirm it works.
 */
export type Detected = { ats: Ats; slug: string; companyGuess: string; jobCount: number };

/** ATS links inside a careers page. Each match gives a slug in the sources.slug format. */
const EMBEDDED: { ats: Ats; re: RegExp; slug: (m: RegExpMatchArray) => string }[] = [
  {
    ats: "greenhouse",
    re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i,
    slug: (m) => m[1].toLowerCase(),
  },
  { ats: "lever", re: /jobs\.lever\.co\/([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase() },
  { ats: "ashby", re: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i, slug: (m) => m[1].toLowerCase() },
  { ats: "smartrecruiters", re: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/, slug: (m) => m[1] },
  { ats: "personio", re: /([a-z0-9-]+\.jobs\.personio\.(?:de|com))/i, slug: (m) => m[1].toLowerCase() },
  { ats: "recruitee", re: /([a-z0-9-]+\.recruitee\.com)/i, slug: (m) => m[1].toLowerCase() },
  { ats: "pinpoint", re: /([a-z0-9-]+\.pinpointhq\.com)/i, slug: (m) => m[1].toLowerCase() },
  { ats: "workable", re: /apply\.workable\.com\/(?!j\/|api\/)([a-z0-9-]+)/i, slug: (m) => m[1].toLowerCase() },
  {
    ats: "workday",
    re: /([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/,
    slug: (m) => `${m[1].toLowerCase()}/${m[2]}`,
  },
  // Jobylon: the widget on a careers page (jbl_company_id = 2986), a posting page
  // (company_id = 2986;), or a company/embed link.
  {
    ats: "jobylon",
    re: /(?:\bjbl_company_id\s*=\s*|\bcompany_id = |(?:emp|cdn)\.jobylon\.com\/(?:jobs\/)?companies\/)(\d+)/,
    slug: (m) => m[1],
  },
];

/** "Greenhouse, Lever, …": every company job system (aggregators excluded). */
const SUPPORTED = (Object.keys(ATS_INFO) as Ats[])
  .filter((a) => !ATS_INFO[a].aggregator)
  .map((a) => ATS_INFO[a].label)
  .join(", ");

const IGNORED_SLUGS = /^(embed|v\d|api|www|app|static|assets)$/i;

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
  if (d.ats !== "custom" && d.ats !== "probe?") {
    // Greenhouse embed URLs carry the board in ?for=
    const slug = d.ats === "greenhouse" ? url.searchParams.get("for") ?? d.slug : d.slug;
    if (slug && !IGNORED_SLUGS.test(slug)) candidates.push({ ats: d.ats, slug });
  }

  // 2. A Teamtailor or Recruitee career site on this host.
  if (!candidates.length) {
    const found = await probeHost(url.hostname.toLowerCase());
    if (found) candidates.push({ ats: found, slug: url.hostname.toLowerCase() });
  }

  // 3. ATS links inside the page.
  if (!candidates.length) {
    const html = await fetchText(url.toString());
    if (html) {
      for (const { ats, re, slug } of EMBEDDED) {
        const m = html.match(re);
        if (m && !IGNORED_SLUGS.test(m[1])) candidates.push({ ats, slug: slug(m) });
      }
    }
  }

  if (!candidates.length) {
    return {
      error:
        `Couldn't recognize the job system behind that page. Supported: ${SUPPORTED}. ` +
        "Try a link to one of the company's job postings instead of the careers homepage.",
    };
  }

  // Confirm by fetching the board; first one that works wins.
  const failures: string[] = [];
  for (const c of candidates) {
    try {
      // A big Workday site lists hundreds of jobs 20 at a time: one request for the count is enough.
      if (c.ats === "workday") return { ...c, companyGuess: guessName(c.ats, c.slug), jobCount: await workdayTotal(c.slug) };
      const jobs = await fetchBoard({ ats: c.ats, slug: c.slug, company_name: "", country: null });
      // Jobylon's slug is a number; its listings carry the company's name.
      const companyGuess = c.ats === "jobylon" && jobs[0]?.company ? jobs[0].company : guessName(c.ats, c.slug);
      return { ...c, companyGuess, jobCount: jobs.length };
    } catch (e) {
      // Keep the reason (timeout, 403, bad JSON…) for the message and the logs, then try the next candidate.
      const reason = e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : String(e);
      console.error(`detectSource: ${c.ats} "${c.slug}" failed: ${reason}`);
      failures.push(reason);
    }
  }
  return {
    error: `Found what looks like a ${ATS_INFO[candidates[0].ats].label} board ("${candidates[0].slug}"), but fetching it failed: ${failures[0]}.`,
  };
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** "career.paradoxplaza.com" → "Paradoxplaza", "bunq.recruitee.com" → "Bunq". Editable later. */
function guessName(ats: Ats, slug: string): string {
  const host = slug.split("/")[0];
  const base = ["teamtailor", "personio", "recruitee", "workday", "pinpoint"].includes(ats)
    ? (host.split(".").find((p) => !/^(www|career|careers|jobs|job|apply|work)$/i.test(p)) ?? host)
    : slug;
  const clean = base.replace(/[-_]+/g, " ").replace(/\d+$/, "").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
