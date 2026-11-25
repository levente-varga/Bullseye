import {
  USER_AGENT,
  appleTotal,
  comeetConfig,
  eightfoldTotal,
  fetchBoard,
  isEightfoldSite,
  isSuccessFactorsPage,
  oracleTotal,
  phenomBase,
  phenomTotal,
  probeHost,
  radancyBase,
  successFactorsTotal,
  taleoTotal,
  workdayTotal,
} from "./ats";
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
  // EU-hosted Lever boards (jobs.eu.lever.co) keep the region in the slug: "eu/<name>".
  { ats: "lever", re: /jobs\.(eu\.)?lever\.co\/([a-z0-9_-]+)/i, slug: (m) => `${m[1] ? "eu/" : ""}${m[2].toLowerCase()}` },
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
  { ats: "hibob", re: /([a-z0-9-]+)\.careers\.hibob\.com/i, slug: (m) => m[1].toLowerCase() },
  { ats: "breezy", re: /([a-z0-9-]+)\.breezy\.hr/i, slug: (m) => m[1].toLowerCase() },
  { ats: "rippling", re: /ats\.rippling\.com\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?([a-z0-9-]+)\/jobs/i, slug: (m) => m[1].toLowerCase() },
  { ats: "bamboohr", re: /([a-z0-9-]+)\.bamboohr\.com\/(?:careers|jobs)/i, slug: (m) => m[1].toLowerCase() },
  { ats: "jobvite", re: /jobs\.jobvite\.com\/([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase() },
  { ats: "join", re: /join\.com\/companies\/([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase() },
  { ats: "gem", re: /jobs\.gem\.com\/([a-z0-9_-]+)/i, slug: (m) => m[1] },
  { ats: "manatal", re: /careers-page\.com\/([a-z0-9_-]+)/i, slug: (m) => m[1].toLowerCase() },
  { ats: "softgarden", re: /([a-z0-9-]+\.softgarden\.io)/i, slug: (m) => m[1].toLowerCase() },
  { ats: "traffit", re: /([a-z0-9-]+\.traffit\.com)/i, slug: (m) => m[1].toLowerCase() },
  { ats: "trakstar", re: /([a-z0-9-]+)\.hire\.trakstar\.com/i, slug: (m) => m[1].toLowerCase() },
  { ats: "homerun", re: /((?!jobs\.|feed\.|www\.)[a-z0-9-]+\.homerun\.co)\b/i, slug: (m) => m[1].toLowerCase() },
  { ats: "jazzhr", re: /([a-z0-9-]+)\.applytojob\.com/i, slug: (m) => m[1].toLowerCase() },
  // Jobylon: the widget on a careers page (jbl_company_id = 2986), a posting page
  // (company_id = 2986;), or a company/embed link.
  {
    ats: "jobylon",
    re: /(?:\bjbl_company_id\s*=\s*|\bcompany_id = |(?:emp|cdn)\.jobylon\.com\/(?:jobs\/)?companies\/)(\d+)/,
    slug: (m) => m[1],
  },
];

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

  // 1b. A Greenhouse board embedded on the company's own site (riotgames.com/…?gh_jid=123):
  // the link names the job, not the board. Guess the board from the domain and confirm
  // the job is on it.
  const ghJob = url.searchParams.get("gh_jid");
  if (!candidates.length && ghJob && /^\d+$/.test(ghJob)) {
    const board = await greenhouseBoardForJob(url.hostname, ghJob);
    if (board) candidates.push({ ats: "greenhouse", slug: board });
  }

  // 1c. An Eightfold careers site (explore.jobs.netflix.net/careers/job/<id>, *.eightfold.ai):
  // confirmed by its jobs API answering.
  if (!candidates.length && (/^\/careers(\/job\/\d+)?\/?$/.test(url.pathname) || url.hostname.endsWith(".eightfold.ai"))) {
    if (await isEightfoldSite(url.hostname)) candidates.push({ ats: "eightfold", slug: url.hostname.toLowerCase() });
  }

  // 2. A Teamtailor or Recruitee career site on this host.
  if (!candidates.length) {
    const found = await probeHost(url.hostname.toLowerCase());
    if (found) candidates.push({ ats: found, slug: url.hostname.toLowerCase() });
  }

  // 3. A Phenom careers site (its pages carry Phenom's page data), or ATS links inside the page.
  if (!candidates.length) {
    const html = await fetchText(url.toString());
    const phenom = html ? phenomBase(url, html) : null;
    if (phenom) candidates.push({ ats: "phenom", slug: phenom });
    // A SAP SuccessFactors career site (Career Site Builder): searched on its own host.
    const sf = !phenom && html && isSuccessFactorsPage(html);
    if (sf) candidates.push({ ats: "successfactors", slug: url.hostname.toLowerCase() });
    // A Radancy (TalentBrew) careers site: read from its sitemap.
    const radancy = !phenom && !sf && html ? radancyBase(url, html) : null;
    if (radancy) candidates.push({ ats: "radancy", slug: radancy });
    // A careers page embedding Comeet (COMEET.init with a public token): read through Comeet's API.
    // A job page shows Comeet (its apply form) without the token, which sits on the careers
    // home: then the home page is the source.
    let comeet = !phenom && !sf && !radancy && html ? comeetConfig(html) : null;
    let comeetSlug = `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
    if (!comeet && !phenom && !sf && !radancy && html && /\bCOMEET\b|comeet-applyform/.test(html)) {
      const home = await fetchText(`${url.origin}/`);
      comeet = home ? comeetConfig(home) : null;
      comeetSlug = url.hostname.toLowerCase();
    }
    if (comeet) candidates.push({ ats: "comeet", slug: comeetSlug });
    if (html && !phenom && !sf && !radancy && !comeet) {
      for (const { ats, re, slug } of EMBEDDED) {
        const m = html.match(re);
        if (m && !IGNORED_SLUGS.test(slug(m).split("/").pop() ?? "")) candidates.push({ ats, slug: slug(m) });
      }
    }
  }

  if (!candidates.length) {
    return {
      error:
        "Couldn't recognize the job system behind that page (the supported ones are listed under the form). " +
        "Try a link to one of the company's job postings instead of the careers homepage.",
    };
  }

  // Confirm by fetching the board; first one that works wins.
  const failures: string[] = [];
  for (const c of candidates) {
    try {
      // A big Workday site lists hundreds of jobs 20 at a time: one request for the count is enough.
      if (c.ats === "workday") return { ...c, companyGuess: guessName(c.ats, c.slug), jobCount: await workdayTotal(c.slug) };
      // Apple's site is read newest first; its total comes from one search page.
      if (c.ats === "apple") return { ...c, companyGuess: "Apple", jobCount: await appleTotal() };
      // Phenom is searched by role; its total comes from one search page.
      if (c.ats === "phenom") return { ...c, companyGuess: guessName(c.ats, c.slug), jobCount: await phenomTotal(c.slug) };
      if (c.ats === "successfactors") return { ...c, companyGuess: guessName(c.ats, c.slug), jobCount: await successFactorsTotal(c.slug) };
      // Eightfold lists 10 a page: its count comes with the first.
      if (c.ats === "eightfold") return { ...c, companyGuess: guessName(c.ats, c.slug), jobCount: await eightfoldTotal(c.slug) };
      // Oracle and Taleo are searched by role: their totals come from one search page.
      if (c.ats === "oracle") return { ...c, companyGuess: guessName(c.ats, c.slug), jobCount: await oracleTotal(c.slug) };
      if (c.ats === "taleo") return { ...c, companyGuess: guessName(c.ats, c.slug), jobCount: await taleoTotal(c.slug) };
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

/**
 * The Greenhouse board a job id belongs to, guessed from the site's domain
 * ("www.riotgames.com" → "riotgames", "careers.acme-games.com" → "acmegames", "acme-games")
 * and confirmed by asking Greenhouse for that job on the board.
 */
async function greenhouseBoardForJob(host: string, jobId: string): Promise<string | null> {
  const labels = host.toLowerCase().split(".").slice(0, -1).filter((l) => !/^(www|careers?|jobs?|work|apply)$/.test(l));
  const guesses = [...new Set(labels.flatMap((l) => [l.replace(/-/g, ""), l]))].slice(0, 4);
  for (const slug of guesses) {
    try {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return slug;
    } catch {
      // try the next guess
    }
  }
  return null;
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
  if (ats === "lever") slug = slug.replace(/^eu\//, "");
  const host = slug.split("/")[0];
  if (ats === "inrecruiting") slug = slug.split("/")[1] ?? slug; // the company segment
  const base = ["teamtailor", "personio", "recruitee", "workday", "pinpoint", "avature", "phenom", "successfactors", "eightfold", "radancy", "taleo", "traffit", "softgarden", "homerun", "oracle", "cornerstone", "comeet"].includes(ats)
    ? (host.split(".").find((p) => !/^(www|career|careers|jobs|job|apply|work|join|explore)$/i.test(p)) ?? host)
    : slug;
  // "disneycareers" → "disney"; a Rippling board "kinetic-games-careers" → "kinetic-games"
  const clean = base.replace(/-(careers?|jobs)$/i, "").replace(/(?<=.)(careers?|jobs)$/i, "").replace(/[-_]+/g, " ").replace(/\d+$/, "").trim();
  // Short names are usually initials: "ea" → "EA".
  return clean.length <= 3 ? clean.toUpperCase() : clean.charAt(0).toUpperCase() + clean.slice(1);
}
