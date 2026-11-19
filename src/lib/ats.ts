import { AsyncLocalStorage } from "node:async_hooks";
import type { Ats, FetchedJob, Source } from "./types";

/**
 * Adapters for job sources. The ATS ones (Greenhouse, Lever, Ashby,
 * Teamtailor, SmartRecruiters, Personio, Recruitee, Workable, Workday, Pinpoint) are
 * public endpoints companies publish for exactly this purpose. Sweden Game Jobs is an aggregator read from its page
 * data; it only gives titles and links, so descriptions are fetched later.
 */

export const USER_AGENT = "BullseyeBot/1.0 (+https://github.com/levente-varga/Bullseye)";

const MAX_DESCRIPTION = 12_000;

export function htmlToText(html: string): string {
  return decodeEntities(
    decodeEntities(html) // Greenhouse double-encodes its HTML
      .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  bull: "•", middot: "·", euro: "€", pound: "£",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&(mdash|ndash|hellip|rsquo|lsquo|rdquo|ldquo|bull|middot|euro|pound);/g, (_, n: string) => NAMED_ENTITIES[n])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

const clip = (s: string) => s.slice(0, MAX_DESCRIPTION);

/**
 * Searchable aggregators run one search per term (built from their followers' target
 * roles, see search-terms.ts), or one newest-first fetch when there are no terms.
 * Results are merged by external id.
 */
async function perTerm(terms: string[] | undefined, search: (term: string | null) => Promise<FetchedJob[]>): Promise<FetchedJob[]> {
  const out = new Map<string, FetchedJob>();
  for (const term of terms?.length ? terms : [null]) {
    for (const j of await search(term)) if (!out.has(j.external_id)) out.set(j.external_id, j);
  }
  return [...out.values()];
}
const looksRemote = (s: string) => /\bremote\b/i.test(s);

/**
 * GET with one retry after a few seconds when the server hiccups (5xx, timeout, dropped
 * connection): Lever's API returns the odd 502 for big boards. 4xx answers aren't retried.
 */
async function get(url: string, accept: string, timeoutMs = 20_000): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    countRequest();
    try {
      res = await fetch(url, {
        headers: { Accept: accept, "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (attempt < 2) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw e;
    }
    if (res.ok) return res;
    if (res.status >= 500 && attempt < 2) {
      await res.body?.cancel();
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
}

const RETRY_DELAY_MS = 5_000;

/** Counts the HTTP requests of one fetchBoardCounted() call (retries included). */
const requestCount = new AsyncLocalStorage<{ n: number }>();
const countRequest = () => {
  const c = requestCount.getStore();
  if (c) c.n++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, timeoutMs?: number): Promise<T> {
  return (await (await get(url, "application/json", timeoutMs)).json()) as T;
}

// --- Greenhouse -------------------------------------------------------------

interface GreenhouseJob {
  id: number | string;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  first_published?: string | null;
  updated_at?: string;
  metadata?: { name: string; value: unknown }[] | null;
}

async function fetchGreenhouse(slug: string, company: string): Promise<FetchedJob[]> {
  const data = await getJson<{ jobs: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
  );
  return data.jobs.map((j) => {
    const location = j.location?.name ?? "";
    const locationType = j.metadata?.find((m) => /location type|workplace/i.test(m.name))?.value;
    return {
      external_id: String(j.id),
      title: j.title.trim(),
      company,
      location,
      remote: looksRemote(location) || looksRemote(String(locationType ?? "")),
      url: j.absolute_url,
      description: clip(htmlToText(j.content ?? "")),
      compensation: null,
      posted_at: j.first_published ?? j.updated_at ?? null,
    };
  });
}

// --- Lever ------------------------------------------------------------------

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  workplaceType?: string;
  categories?: { location?: string; commitment?: string; team?: string };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

async function fetchLever(slug: string, company: string): Promise<FetchedJob[]> {
  // Lever returns every posting with its full description in one response (800KB for
  // ~70 jobs), and it has taken anywhere from 2s to 15s+; 20s cut off real boards.
  // EU-hosted boards (jobs.eu.lever.co) have the slug "eu/<name>" and their own API host.
  const eu = slug.startsWith("eu/");
  const name = eu ? slug.slice(3) : slug;
  const data = await getJson<LeverJob[]>(
    `https://api${eu ? ".eu" : ""}.lever.co/v0/postings/${encodeURIComponent(name)}?mode=json`,
    60_000,
  );
  return data.map((j) => {
    const location = j.categories?.location ?? "";
    const lists = (j.lists ?? [])
      .map((l) => `${l.text}\n${htmlToText(l.content)}`)
      .join("\n\n");
    const s = j.salaryRange;
    return {
      external_id: j.id,
      title: j.text.trim(),
      company,
      location,
      remote: j.workplaceType === "remote" || looksRemote(location),
      url: j.hostedUrl,
      description: clip(
        [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join("\n\n"),
      ),
      compensation:
        s && (s.min || s.max)
          ? `${s.min ?? "?"}–${s.max ?? "?"} ${s.currency ?? ""} ${s.interval ?? ""}`.trim()
          : null,
      posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    };
  });
}

// --- Ashby ------------------------------------------------------------------

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location: string }[];
  isRemote?: boolean;
  isListed?: boolean;
  workplaceType?: string;
  jobUrl: string;
  descriptionPlain?: string;
  publishedAt?: string;
  compensation?: { compensationTierSummary?: string | null };
}

async function fetchAshby(slug: string, company: string): Promise<FetchedJob[]> {
  const data = await getJson<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
  );
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const location = [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)]
        .filter(Boolean)
        .join(" | ");
      return {
        external_id: j.id,
        title: j.title.trim(),
        company,
        location,
        remote: Boolean(j.isRemote) || j.workplaceType === "Remote" || looksRemote(location),
        url: j.jobUrl,
        description: clip(j.descriptionPlain ?? ""),
        compensation: j.compensation?.compensationTierSummary ?? null,
        posted_at: j.publishedAt ?? null,
      };
    });
}

// --- Teamtailor (RSS) --------------------------------------------------------

function xmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  return m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
}

async function fetchTeamtailor(host: string, company: string): Promise<FetchedJob[]> {
  const xml = await (await get(`https://${host}/jobs.rss`, "application/rss+xml")).text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.map((item) => {
    const link = xmlTag(item, "link");
    const locations = [...item.matchAll(/<tt:name>([\s\S]*?)<\/tt:name>/g)].map((m) => decodeEntities(m[1].trim()));
    const remoteStatus = xmlTag(item, "remoteStatus");
    const pub = xmlTag(item, "pubDate");
    return {
      external_id: xmlTag(item, "guid") || link,
      title: decodeEntities(xmlTag(item, "title")),
      company,
      location: locations.join(" | "),
      remote: remoteStatus === "fully" || remoteStatus === "hybrid",
      url: link,
      description: clip(htmlToText(xmlTag(item, "description"))),
      compensation: null,
      posted_at: pub ? new Date(pub).toISOString() : null,
    };
  });
}

// --- SmartRecruiters ----------------------------------------------------------

interface SrPosting {
  id: string;
  name: string;
  releasedDate?: string;
  company?: { identifier: string; name: string };
  location?: { fullLocation?: string; city?: string; country?: string; remote?: boolean; hybrid?: boolean };
}

async function fetchSmartRecruiters(company: string, name: string, country: string | null): Promise<FetchedJob[]> {
  const out: FetchedJob[] = [];
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings`;
  for (let offset = 0; offset < 2000; offset += 100) {
    const q = new URLSearchParams({ limit: "100", offset: String(offset) });
    if (country) q.set("country", country.toLowerCase());
    const page = await getJson<{ content: SrPosting[]; totalFound: number }>(`${base}?${q}`);
    for (const j of page.content) {
      out.push({
        external_id: j.id,
        title: j.name.trim(),
        company: name,
        location: j.location?.fullLocation ?? [j.location?.city, j.location?.country].filter(Boolean).join(", "),
        remote: Boolean(j.location?.remote || j.location?.hybrid),
        url: `https://jobs.smartrecruiters.com/${company}/${j.id}`,
        description: "", // the list API has no description; fetched for new postings only
        compensation: null,
        posted_at: j.releasedDate ?? null,
      });
    }
    if (offset + 100 >= page.totalFound) break;
  }
  return out;
}

/** Description for one SmartRecruiters posting (detail API). */
export async function fetchSmartRecruitersDescription(company: string, id: string): Promise<string> {
  const d = await getJson<{ jobAd?: { sections?: Record<string, { title?: string; text?: string }> } }>(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`,
  );
  const s = d.jobAd?.sections ?? {};
  return clip(
    ["jobDescription", "qualifications", "additionalInformation", "companyDescription"]
      .map((k) => s[k])
      .filter((x) => x?.text)
      .map((x) => `${x!.title ?? ""}\n${htmlToText(x!.text!)}`)
      .join("\n\n"),
  );
}

// --- Personio (XML feed) ------------------------------------------------------
// Slug: the career site host, e.g. "personio.jobs.personio.de" (also .com).

async function fetchPersonio(host: string, company: string): Promise<FetchedJob[]> {
  let xml: string;
  try {
    xml = await (await get(`https://${host}/xml?language=en`, "application/xml")).text();
  } catch (e) {
    // A company can switch the XML feed off (404): read its careers page instead.
    if (e instanceof Error && e.message.startsWith("404 ")) return fetchPersonioPage(host, company);
    throw e;
  }
  const positions = xml.match(/<position>[\s\S]*?<\/position>/g) ?? [];
  return positions.map((p) => {
    const id = xmlTag(p, "id");
    // <office> appears once at the top, and again inside <additionalOffices>.
    const offices = [...new Set([...p.matchAll(/<office>([\s\S]*?)<\/office>/g)].map((m) => decodeEntities(m[1].trim())))];
    const sections = [...p.matchAll(/<jobDescription>([\s\S]*?)<\/jobDescription>/g)].map((m) => {
      const name = decodeEntities(xmlTag(m[1], "name"));
      return `${name}\n${htmlToText(xmlTag(m[1], "value"))}`;
    });
    const created = xmlTag(p, "createdAt");
    const location = offices.join(" | ");
    return {
      external_id: id,
      title: decodeEntities(xmlTag(p, "name")),
      company,
      location,
      remote: looksRemote(location),
      url: `https://${host}/job/${id}?language=en`,
      description: clip(sections.join("\n\n")),
      compensation: null,
      posted_at: created ? new Date(created).toISOString() : null,
    };
  });
}

/**
 * A Personio careers page, for companies with the XML feed switched off: each job is a
 * link with its title and first location (matched on Personio's stable class names, not
 * the generated ones). Descriptions come from the job pages' structured data later.
 */
async function fetchPersonioPage(host: string, company: string): Promise<FetchedJob[]> {
  const html = await (await get(`https://${host}/?language=en`, "text/html")).text();
  const out = new Map<string, FetchedJob>();
  for (const card of html.split(/<a [^>]*class="[^"]*\bjob-box\b/).slice(1)) {
    const id = card.match(/^[^>]*href="\/job\/(\d+)/)?.[1];
    const title = card.match(/class="[^"]*\bjb-title\b[^"]*"[^>]*>([\s\S]*?)<\/h3>/)?.[1];
    if (!id || !title || out.has(id)) continue;
    const location = decodeEntities(card.match(/class="[^"]*jobMetaText[^"]*"[^>]*>([\s\S]*?)</)?.[1] ?? "").trim();
    out.set(id, {
      external_id: id,
      title: decodeEntities(title.replace(/<[^>]+>/g, "")).trim(),
      company,
      location,
      remote: looksRemote(location),
      url: `https://${host}/job/${id}?language=en`,
      description: "",
      compensation: null,
      posted_at: null,
    });
  }
  if (!out.size && !/jobs-group|job-box/.test(html)) throw new Error("Personio: no XML feed and no jobs found on the careers page");
  return [...out.values()];
}

// --- HiBob (careers site API) ---------------------------------------------------------
// Slug: the company's careers subdomain, "<company>" in <company>.careers.hibob.com.
// One request returns every job ad with its full text; the API wants the company in a header.

interface HiBobJobAd {
  id: string;
  title: string;
  site?: string | null;
  country?: string | null;
  description?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  benefits?: string | null;
  publishedAt?: string | null;
  workspaceType?: string | null;
  postingLocations?: { name?: string; city?: string; country?: string }[] | null;
  hideLocationInformation?: boolean | null;
}

async function fetchHiBob(company: string, name: string): Promise<FetchedJob[]> {
  countRequest();
  const res = await fetch(`https://${company}.careers.hibob.com/api/job-ad`, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT, companyIdentifier: company },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for https://${company}.careers.hibob.com/api/job-ad`);
  const data = (await res.json()) as { jobAdDetails?: HiBobJobAd[] };
  return (data.jobAdDetails ?? []).map((j) => {
    const places = (j.postingLocations ?? []).map((l) => [l.city || l.name, l.country].filter(Boolean).join(", ")).filter(Boolean);
    // "site" is the office ("United Kingdom - Sumo Digital"); the country is the useful part.
    const remote = /remote/i.test(j.workspaceType ?? "");
    const location = [...new Set(places.length ? places : [j.country ?? ""].filter(Boolean)), remote ? "Remote" : ""].filter(Boolean).join(" | ");
    const section = (title: string, html?: string | null) => (html ? `${title}\n${htmlToText(html)}` : "");
    return {
      external_id: j.id,
      title: j.title.trim(),
      company: name,
      location,
      remote,
      url: `https://${company}.careers.hibob.com/jobs/${j.id}`,
      description: clip(
        [section("About the role", j.description), section("Responsibilities", j.responsibilities), section("Requirements", j.requirements), section("Benefits", j.benefits)]
          .filter(Boolean)
          .join("\n\n"),
      ),
      compensation: null,
      posted_at: j.publishedAt ?? null,
    };
  });
}

// --- Breezy HR (JSON list) ---------------------------------------------------------------
// Slug: the company's subdomain, "<company>" in <company>.breezy.hr. The list has no
// descriptions; the posting pages' structured data has them.

interface BreezyPosition {
  id: string;
  name: string;
  url: string;
  published_date?: string;
  location?: { city?: string; country?: { name?: string }; is_remote?: boolean; name?: string };
  locations?: { city?: string; country?: { name?: string }; is_remote?: boolean }[];
  salary?: string;
}

async function fetchBreezy(company: string, name: string): Promise<FetchedJob[]> {
  const positions = await getJson<BreezyPosition[]>(`https://${company}.breezy.hr/json`);
  return positions.map((p) => {
    const locs = p.locations?.length ? p.locations : p.location ? [p.location] : [];
    const places = locs.map((l) => [l.city, l.country?.name].filter(Boolean).join(", ")).filter(Boolean);
    const remote = locs.some((l) => l.is_remote);
    return {
      external_id: p.id,
      title: p.name.trim(),
      company: name,
      location: [...new Set(places), remote ? "Remote" : ""].filter(Boolean).join(" | "),
      remote,
      url: p.url,
      description: "", // from the posting page
      compensation: p.salary?.trim() || null,
      posted_at: p.published_date ?? null,
    };
  });
}

// --- BambooHR (careers JSON) ----------------------------------------------------------
// Slug: the company's subdomain, "<company>" in <company>.bamboohr.com. The list gives
// city and region; each job's detail adds the country, description and pay.

interface BambooListing {
  id: string;
  jobOpeningName: string;
  location?: { city?: string | null; state?: string | null };
  atsLocation?: { city?: string | null; state?: string | null; country?: string | null };
  isRemote?: boolean | null;
  /** "0" on-site, "1" remote, "2" hybrid. */
  locationType?: string | null;
}

async function fetchBambooHR(company: string, name: string): Promise<FetchedJob[]> {
  const data = await getJson<{ result?: BambooListing[] }>(`https://${company}.bamboohr.com/careers/list`);
  return (data.result ?? []).map((j) => {
    const remote = Boolean(j.isRemote) || j.locationType === "1";
    const place = [j.atsLocation?.city || j.location?.city, j.atsLocation?.country || j.atsLocation?.state || j.location?.state]
      .filter(Boolean)
      .join(", ");
    return {
      external_id: String(j.id),
      title: j.jobOpeningName.trim(),
      company: name,
      location: [place, remote ? "Remote" : ""].filter(Boolean).join(" | "),
      remote,
      url: `https://${company}.bamboohr.com/careers/${j.id}`,
      description: "", // from the job's detail
      compensation: null,
      posted_at: null,
    };
  });
}

/** A BambooHR job link: <company>.bamboohr.com/careers/<id>. */
export const isBambooPosting = (url: string) => /^https:\/\/[a-z0-9-]+\.bamboohr\.com\/careers\/\d+/i.test(url);

/** A BambooHR job's description and full location ("Glasgow, United Kingdom"). */
export async function fetchBambooDescription(url: string): Promise<{ text: string; location?: string }> {
  const m = url.match(/^https:\/\/([a-z0-9-]+)\.bamboohr\.com\/careers\/(\d+)/i);
  if (!m) throw new Error(`Not a BambooHR job link: ${url}`);
  const data = await getJson<{
    result?: { jobOpening?: { description?: string; compensation?: string | null; location?: { city?: string; addressCountry?: string } } };
  }>(`https://${m[1]}.bamboohr.com/careers/${m[2]}/detail`);
  const j = data.result?.jobOpening;
  if (!j?.description) throw new Error("BambooHR: no description in the job's detail");
  const location = [j.location?.city, j.location?.addressCountry].filter(Boolean).join(", ");
  const pay = j.compensation?.trim() ? `\n\nCompensation: ${j.compensation.trim()}` : "";
  return { text: clip(htmlToText(j.description) + pay), location: location || undefined };
}

// --- Phenom (careers sites of Disney and other large employers) ----------------------------
// Slug: the site's base, "<host>/<region>/<lang>", e.g. "join.disneycareers.com/global/en".
// Its search results page embeds the results as data (10 a page). Searched for the
// followers' target roles, a few pages each (its search does narrow by role); the job
// pages' structured data has the description.

const PHENOM_PAGE = 10;
const PHENOM_MAX_PAGES = 5;
const PHENOM_SPACING_MS = 1_000;

interface PhenomJob {
  jobId: string;
  title: string;
  location?: string;
  multi_location?: string[];
  postedDate?: string;
  locationType?: string;
}

/** The JSON object after `"<key>":` in a page, scanned string-aware (descriptions hold braces). */
function embeddedObject(html: string, key: string): unknown {
  const at = html.indexOf(`"${key}"`);
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  return null;
}

async function fetchPhenom(base: string, company: string, terms?: string[]): Promise<FetchedJob[]> {
  let first = true;
  return perTerm(terms, async (term) => {
    const out: FetchedJob[] = [];
    for (let page = 0; page < PHENOM_MAX_PAGES; page++) {
      if (!first) await sleep(PHENOM_SPACING_MS);
      first = false;
      const params = new URLSearchParams(term ? { keywords: term } : {});
      if (page) params.set("from", String(page * PHENOM_PAGE));
      const html = await (await get(`https://${base}/search-results?${params}`, "text/html")).text();
      const search = embeddedObject(html, "eagerLoadRefineSearch") as { totalHits?: number; data?: { jobs?: PhenomJob[] } } | null;
      if (!search) throw new Error("Phenom: search results not found on the page (site layout changed?)");
      const jobs = search.data?.jobs ?? [];
      for (const j of jobs) {
        const places = [...new Set((j.multi_location?.length ? j.multi_location : [j.location ?? ""]).filter(Boolean))];
        const remote = places.some(looksRemote) || /remote/i.test(j.locationType ?? "");
        out.push({
          external_id: String(j.jobId),
          title: j.title.trim(),
          company,
          location: places.join(" | "),
          remote,
          url: `https://${base}/job/${j.jobId}`,
          description: "", // from the job page's structured data
          compensation: null,
          posted_at: j.postedDate ?? null,
        });
      }
      if (jobs.length < PHENOM_PAGE || (page + 1) * PHENOM_PAGE >= (search.totalHits ?? 0)) break;
    }
    return out;
  });
}

/** Number of jobs on a Phenom careers site, from one search page (Add board shows it). */
export async function phenomTotal(base: string): Promise<number> {
  const html = await (await get(`https://${base}/search-results`, "text/html")).text();
  return (embeddedObject(html, "eagerLoadRefineSearch") as { totalHits?: number } | null)?.totalHits ?? 0;
}

/** Whether a page is a Phenom careers site; its base ("<host>/<region>/<lang>") if so. */
export function phenomBase(url: URL, html: string): string | null {
  if (!/phApp\.ddo|eagerLoadRefineSearch|phenompeople/i.test(html)) return null;
  const m = url.pathname.match(/^\/([a-z-]+)\/([a-z]{2}(?:-[a-z]{2})?)\//i);
  return m ? `${url.hostname.toLowerCase()}/${m[1]}/${m[2]}` : null;
}

// --- Rippling (public job board API) -----------------------------------------------------
// Slug: the board name, "<board>" in ats.rippling.com/[<locale>/]<board>/jobs/<uuid>.
// One request lists every job with its location; each job's detail has the description.

const RIPPLING_API = "https://api.rippling.com/platform/api/ats/v1/board";

interface RipplingJob {
  uuid: string;
  name: string;
  url: string;
  workLocation?: { label?: string };
}

async function fetchRippling(board: string, company: string): Promise<FetchedJob[]> {
  const jobs = await getJson<RipplingJob[]>(`${RIPPLING_API}/${encodeURIComponent(board)}/jobs`);
  return jobs.map((j) => {
    const location = j.workLocation?.label?.trim() ?? "";
    return {
      external_id: j.uuid,
      title: j.name.trim(),
      company,
      location,
      remote: looksRemote(location),
      url: j.url || `https://ats.rippling.com/${board}/jobs/${j.uuid}`,
      description: "", // from the job's detail
      compensation: null,
      posted_at: null,
    };
  });
}

/** A Rippling job link, as [board, uuid]. */
export function ripplingJob(url: string): [string, string] | null {
  const m = url.match(/^https:\/\/ats\.rippling\.com\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?([a-z0-9-]+)\/jobs\/([0-9a-f-]{36})/i);
  return m ? [m[1].toLowerCase(), m[2].toLowerCase()] : null;
}

/** A Rippling job's description (about the company, then the role) and locations. */
export async function fetchRipplingDescription(board: string, uuid: string): Promise<{ text: string; location?: string }> {
  const d = await getJson<{ description?: { company?: string; role?: string }; workLocations?: string[] }>(
    `${RIPPLING_API}/${encodeURIComponent(board)}/jobs/${encodeURIComponent(uuid)}`,
  );
  const text = [d.description?.role, d.description?.company].filter(Boolean).map((h) => htmlToText(String(h))).join("\n\n");
  if (!text) throw new Error("Rippling: no description for this job");
  const location = [...new Set(d.workLocations ?? [])].join(" | ");
  return { text: clip(text), location: location || undefined };
}

// --- InRecruiting (Zucchetti, *.intervieweb.it) -------------------------------------------
// Slug: "<host>/<company>/<lang>", e.g. "inrecruitingfr.intervieweb.it/namcobandai/en".
// The career page lists every job (title, link, location); the job pages' structured data
// has the description.

async function fetchInRecruiting(slug: string, company: string): Promise<FetchedJob[]> {
  const [host, org, lang = "en"] = slug.split("/");
  const html = await (await get(`https://${host}/${org}/${lang}/career`, "text/html")).text();
  const out = new Map<string, FetchedJob>();
  for (const card of html.split(/class="row vacancy__render"/).slice(1)) {
    const link = card.match(/href="(https?:\/\/[^"]+\/jobs\/[a-z0-9-]+-(\d+)\/[a-z]{2}\/?)"/i);
    const title = card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1];
    if (!link || !title || out.has(link[2])) continue;
    // <span title="Location"><i …></i><span class="sr-only">Location </span>Lyon France </span>
    const loc = card.match(/___vm_location___[\s\S]*?<span class="sr-only">[^<]*<\/span>([^<]*)</)?.[1];
    const location = decodeEntities((loc ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    out.set(link[2], {
      external_id: link[2],
      title: decodeEntities(title.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim(),
      company,
      location,
      remote: looksRemote(location),
      url: link[1],
      description: "", // from the job page's structured data
      compensation: null,
      posted_at: null,
    });
  }
  if (!out.size && !/vacancy__render|tab-annunci/.test(html)) throw new Error("InRecruiting: no job list on the career page (layout changed?)");
  return [...out.values()];
}

// --- Recruitee (JSON API) -----------------------------------------------------
// Slug: the career site host, "<company>.recruitee.com" or a custom domain.

interface RecruiteeOffer {
  id: number;
  title: string;
  status?: string;
  careers_url: string;
  location?: string;
  locations?: { city?: string; name?: string; country?: string }[];
  remote?: boolean;
  hybrid?: boolean;
  description?: string;
  requirements?: string;
  published_at?: string;
  salary?: { min?: string | null; max?: string | null; period?: string; currency?: string } | null;
}

async function fetchRecruitee(host: string, company: string): Promise<FetchedJob[]> {
  const data = await getJson<{ offers: RecruiteeOffer[] }>(`https://${host}/api/offers/`);
  return data.offers
    .filter((o) => !o.status || o.status === "published")
    .map((o) => {
      const places = (o.locations ?? []).map((l) => [l.city || l.name, l.country].filter(Boolean).join(", ")).filter(Boolean);
      const location = places.length ? [...new Set(places)].join(" | ") : (o.location ?? "");
      const s = o.salary;
      return {
        external_id: String(o.id),
        title: o.title.trim(),
        company,
        location,
        remote: Boolean(o.remote) || looksRemote(location),
        url: o.careers_url,
        description: clip([o.description, o.requirements].filter(Boolean).map((h) => htmlToText(h!)).join("\n\n")),
        compensation: s && (s.min || s.max) ? `${s.min ?? "?"}–${s.max ?? "?"} ${s.currency ?? ""} per ${s.period ?? "year"}`.trim() : null,
        posted_at: o.published_at ? new Date(o.published_at.replace(" UTC", "Z").replace(" ", "T")).toISOString() : null,
      };
    });
}

// --- Workable (widget API) ------------------------------------------------------
// Slug: the account, as in apply.workable.com/<account>.

interface WorkableJob {
  title: string;
  shortcode: string;
  url: string;
  telecommuting?: boolean;
  city?: string;
  country?: string;
  locations?: { city?: string; country?: string }[];
  description?: string;
  published_on?: string;
}

async function fetchWorkable(account: string, company: string): Promise<FetchedJob[]> {
  const data = await getJson<{ jobs: WorkableJob[] }>(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`,
  );
  return data.jobs.map((j) => {
    const places = (j.locations?.length ? j.locations : [{ city: j.city, country: j.country }])
      .map((l) => [l.city, l.country].filter(Boolean).join(", "))
      .filter(Boolean);
    const location = [...new Set(places)].join(" | ");
    return {
      external_id: j.shortcode,
      title: j.title.trim(),
      company,
      location,
      remote: Boolean(j.telecommuting) || looksRemote(location),
      url: j.url,
      description: clip(htmlToText(j.description ?? "")),
      compensation: null,
      posted_at: j.published_on ? new Date(j.published_on).toISOString() : null,
    };
  });
}

// --- Workday (careers site API) ---------------------------------------------------
// Slug: "<tenant>.wd<N>.myworkdayjobs.com/<site>", e.g. "philips.wd3.myworkdayjobs.com/jobs-and-careers".
// The list has no descriptions and often no country, and multi-location jobs only say
// "3 Locations". The detail API fills all three in, only for new postings that pass the title filter.

const WORKDAY_PAGE = 20; // the API's maximum
const WORKDAY_MAX = 2000;

/** Splits a Workday slug into its API base and the public site base. */
export function workdayBase(slug: string): { api: string; site: string } {
  const [host, site] = slug.split("/");
  const tenant = host.split(".")[0];
  return { api: `https://${host}/wday/cxs/${tenant}/${site}`, site: `https://${host}/${site}` };
}

interface WorkdayPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
}
interface WorkdayDetail {
  jobPostingInfo?: {
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    country?: { descriptor?: string };
    remoteType?: string;
  };
}

/** "Posted Today" / "Posted Yesterday" / "Posted 5 Days Ago" / "Posted 30+ Days Ago" → an ISO date. */
function workdayPostedOn(text: string | undefined, now = Date.now()): string | null {
  if (!text) return null;
  if (/today/i.test(text)) return new Date(now).toISOString();
  if (/yesterday/i.test(text)) return new Date(now - 86_400_000).toISOString();
  const days = text.match(/(\d+)\+?\s+days?/i);
  return days ? new Date(now - Number(days[1]) * 86_400_000).toISOString() : null;
}

async function fetchWorkday(slug: string, company: string): Promise<FetchedJob[]> {
  const { api, site } = workdayBase(slug);
  const page = async (offset: number) => {
    countRequest();
    const res = await fetch(`${api}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ limit: WORKDAY_PAGE, offset, searchText: "", appliedFacets: {} }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${api}/jobs`);
    return (await res.json()) as { total?: number; jobPostings?: WorkdayPosting[] };
  };
  // Only the first page reports the total; the rest are fetched a few at a time.
  const first = await page(0);
  const postings: WorkdayPosting[] = [...(first.jobPostings ?? [])];
  const offsets: number[] = [];
  for (let o = WORKDAY_PAGE; o < Math.min(first.total ?? 0, WORKDAY_MAX); o += WORKDAY_PAGE) offsets.push(o);
  for (let i = 0; i < offsets.length; i += 5) {
    const pages = await Promise.all(offsets.slice(i, i + 5).map(page));
    for (const p of pages) postings.push(...(p.jobPostings ?? []));
  }

  return postings.map((p) => {
    // "3 Locations" stays as is here; the detail fetch for new postings fills in the places.
    const location = p.locationsText ?? "";
    return {
      external_id: p.externalPath,
      title: p.title.trim(),
      company,
      location,
      remote: looksRemote(location),
      url: `${site}${p.externalPath}`,
      description: "", // fetched for new postings only
      compensation: null,
      posted_at: workdayPostedOn(p.postedOn),
    };
  });
}

/** Description and real places for one Workday posting (detail API). */
export async function fetchWorkdayPosting(slug: string, externalPath: string): Promise<{ text: string; location: string }> {
  const info = (await getJson<WorkdayDetail>(`${workdayBase(slug).api}${externalPath}`)).jobPostingInfo;
  const places = [info?.location, ...(info?.additionalLocations ?? [])].filter(Boolean) as string[];
  const country = info?.country?.descriptor;
  // The list often says just "Best" or "3 Locations": add the country so location filters can match.
  const location = places.map((p) => (country && !p.includes(country) ? `${p}, ${country}` : p)).join(" | ");
  return { text: clip(htmlToText(info?.jobDescription ?? "")), location };
}

/** A Workday posting URL as source slug + posting path, e.g. for aggregator links. */
export function workdayFromUrl(url: string): { slug: string; path: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith(".myworkdayjobs.com")) return null;
    const segments = u.pathname.split("/").filter(Boolean);
    const at = segments.findIndex((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s)); // skip a locale like en-US
    if (at < 0 || segments[at + 1] !== "job") return null;
    return { slug: `${u.hostname.toLowerCase()}/${segments[at]}`, path: `/${segments.slice(at + 1).join("/")}` };
  } catch {
    return null;
  }
}

/** Number of open postings on a Workday site, from one request (Add source shows it). */
export async function workdayTotal(slug: string): Promise<number> {
  const { api } = workdayBase(slug);
  const res = await fetch(`${api}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ limit: 1, offset: 0, searchText: "", appliedFacets: {} }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${api}/jobs`);
  return ((await res.json()) as { total?: number }).total ?? 0;
}

// --- Pinpoint (JSON feed) -----------------------------------------------------------
// Slug: the career site host, "<company>.pinpointhq.com".

interface PinpointPosting {
  id: string;
  title: string;
  url: string;
  description?: string | null;
  key_responsibilities?: string | null;
  key_responsibilities_header?: string | null;
  skills_knowledge_expertise?: string | null;
  skills_knowledge_expertise_header?: string | null;
  benefits?: string | null;
  benefits_header?: string | null;
  workplace_type?: string | null;
  location?: { city?: string | null; name?: string | null; province?: string | null } | null;
  compensation_visible?: boolean;
  compensation_minimum?: number | null;
  compensation_maximum?: number | null;
  compensation_currency?: string | null;
  compensation_frequency?: string | null;
}

async function fetchPinpoint(host: string, company: string): Promise<FetchedJob[]> {
  const data = await getJson<{ data: PinpointPosting[] }>(`https://${host}/postings.json`);
  return data.data.map((j) => {
    const l = j.location ?? {};
    // `name` is the location's label: a country or region, or just "Remote".
    const location = [l.city, l.name && l.name !== l.city ? l.name : null].filter(Boolean).join(", ");
    const section = (header: string | null | undefined, html: string | null | undefined) =>
      html ? `${header ? `${header}\n` : ""}${htmlToText(html)}` : "";
    const pay =
      j.compensation_visible && (j.compensation_minimum || j.compensation_maximum)
        ? `${j.compensation_minimum ?? "?"}–${j.compensation_maximum ?? "?"} ${j.compensation_currency ?? ""} ${j.compensation_frequency ?? ""}`.trim()
        : null;
    return {
      external_id: String(j.id),
      title: j.title.trim(),
      company,
      location,
      remote: j.workplace_type === "remote" || j.workplace_type === "hybrid" || looksRemote(location),
      url: j.url,
      description: clip(
        [
          section(null, j.description),
          section(j.key_responsibilities_header, j.key_responsibilities),
          section(j.skills_knowledge_expertise_header, j.skills_knowledge_expertise),
          section(j.benefits_header, j.benefits),
        ]
          .filter(Boolean)
          .join("\n\n"),
      ),
      compensation: pay,
      posted_at: null, // the feed has no publish date
    };
  });
}

// --- JobTech / Platsbanken (aggregator) -------------------------------------------
// Sweden's public employment service publishes every job ad in Platsbanken through an
// open API (jobtechdev.se), most of them in Swedish. Slug: search parameters, e.g.
// "occupation-field=apaJ_2ja_LuF" (Data/IT); empty means Data/IT + Culture/media/design.
// The API stops at 2,000 results per search, so each run reads the last week's ads
// (≈900 for the default) and the source is "partial": older ads aren't closed for
// dropping out of the window.

const JOBTECH_WINDOW_MINUTES = 7 * 24 * 60;
const JOBTECH_PAGE = 100;
/** Newest ads per search: plenty for the last week of one role. */
const JOBTECH_MAX = 300;

interface JobTechAd {
  id: string;
  headline: string;
  webpage_url: string;
  publication_date?: string;
  description?: { text?: string | null };
  employer?: { name?: string | null };
  application_details?: { url?: string | null };
  workplace_address?: { city?: string | null; municipality?: string | null; country?: string | null };
  workplace_model?: { label?: string | null } | null;
  salary_description?: string | null;
}

/** The employer's own posting when the ad links to one (so duplicates of direct sources match), else Platsbanken. */
function jobTechUrl(ad: JobTechAd): string {
  const apply = ad.application_details?.url;
  if (!apply || !/^https?:\/\//i.test(apply)) return ad.webpage_url;
  try {
    const u = new URL(apply);
    u.pathname = u.pathname.replace(/\/applications\/new\/?$/, ""); // Teamtailor apply form → the posting
    u.searchParams.delete("promotion");
    return u.toString();
  } catch {
    return ad.webpage_url;
  }
}

async function fetchJobTech(terms?: string[]): Promise<FetchedJob[]> {
  return perTerm(terms, (term) => searchJobTech(term));
}

async function searchJobTech(term: string | null): Promise<FetchedJob[]> {
  const base = new URLSearchParams({ sort: "pubdate-desc" });
  if (term) base.set("q", term);
  base.set("published-after", String(JOBTECH_WINDOW_MINUTES));
  base.set("limit", String(JOBTECH_PAGE));
  const out: FetchedJob[] = [];
  for (let offset = 0; offset + JOBTECH_PAGE <= JOBTECH_MAX; offset += JOBTECH_PAGE) {
    base.set("offset", String(offset));
    const page = await getJson<{ total?: { value?: number }; hits: JobTechAd[] }>(
      `https://jobsearch.api.jobtechdev.se/search?${base}`,
    );
    for (const ad of page.hits) {
      const a = ad.workplace_address ?? {};
      const place = a.city || a.municipality;
      const country = a.country === "Sverige" ? "Sweden" : a.country;
      const model = ad.workplace_model?.label ?? "";
      out.push({
        external_id: ad.id,
        title: ad.headline.trim(),
        company: ad.employer?.name?.trim() || "Unknown employer",
        location: [place, country].filter(Boolean).join(", ") || "Sweden",
        remote: /distans|hybrid/i.test(model),
        url: jobTechUrl(ad),
        description: clip(ad.description?.text ?? ""),
        compensation: ad.salary_description || null,
        posted_at: ad.publication_date ? new Date(ad.publication_date).toISOString() : null,
      });
    }
    if (page.hits.length < JOBTECH_PAGE || offset + JOBTECH_PAGE >= (page.total?.value ?? 0)) break;
  }
  return out;
}

// --- Sweden Game Jobs (aggregator) ---------------------------------------------

interface SgjJob {
  id: string;
  title: string;
  externalUrl: string;
  externalId?: string;
  createdAt?: string;
  cities?: string[];
  category?: string;
  company?: { name?: string };
}

async function fetchSwedenGameJobs(): Promise<FetchedJob[]> {
  const html = await (await get("https://www.swedengamejobs.com/", "text/html")).text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Sweden Game Jobs: page data not found (site layout changed?)");
  type Query = { queryKey: unknown; state: { data: unknown } };
  const queries: Query[] = JSON.parse(m[1])?.props?.pageProps?.trpcState?.json?.queries ?? [];
  const q = queries.find((x) => JSON.stringify(x.queryKey).includes("getAll"));
  const jobs = q?.state?.data;
  if (!Array.isArray(jobs)) throw new Error("Sweden Game Jobs: job list not found (site layout changed?)");
  return (jobs as SgjJob[])
    .filter((j) => j.externalUrl && j.title)
    .map((j) => {
      const cities = (j.cities ?? []).filter(Boolean);
      return {
        external_id: j.id,
        title: j.title.trim(),
        company: j.company?.name ?? "Unknown studio",
        location: cities.length ? cities.map((c) => (/remote/i.test(c) ? c : `${c}, Sweden`)).join(" | ") : "Sweden",
        remote: cities.some((c) => /remote/i.test(c)),
        url: j.externalUrl,
        description: "", // aggregator has no description; fetched from the original posting later
        compensation: null,
        posted_at: j.createdAt ?? null,
      };
    });
}

// --- Remote and international aggregators ------------------------------------------
// Public, free feeds. Each is "partial" (it only shows recent ads), so ads that drop out
// aren't closed. Fetching costs nothing; only scoring does, and that has its own caps.

const fromEpoch = (v: unknown): string | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};

function salary(min: unknown, max: unknown, currency?: string | null, period?: string | null): string | null {
  const lo = Number(min) || 0;
  const hi = Number(max) || 0;
  if (!lo && !hi) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const range = lo && hi && lo !== hi ? `${fmt(lo)}–${fmt(hi)}` : fmt(lo || hi);
  return [range, currency || "USD", period && period !== "annual" ? `/ ${period}` : null].filter(Boolean).join(" ");
}

/** "Remote" plus where it's open to: "Remote, worldwide" or "Remote (Sweden, Germany)". */
function remoteWhere(places: string[]): string {
  const p = places.map((x) => x.trim()).filter(Boolean);
  return p.length ? `Remote (${p.join(", ")})` : "Remote, worldwide";
}

// Himalayas: remote jobs worldwide (100k+), read through its search API so only matching
// ads come in. Slug: search parameters, e.g. "q=developer&country=SE"; empty means
// "q=developer". Newest first, at most 10 pages of 20 per run.
const HIMALAYAS_MAX_PAGES = 3;
/** Its public API allows 60 requests a minute; one per second stays under it with many searches. */
const HIMALAYAS_SPACING_MS = 1000;

interface HimalayasJob {
  title: string;
  companyName?: string;
  description?: string;
  excerpt?: string;
  minSalary?: number | string | null;
  maxSalary?: number | string | null;
  currency?: string | null;
  salaryPeriod?: string | null;
  locationRestrictions?: string[];
  pubDate?: number | string;
  applicationLink?: string;
  guid: string;
}

async function fetchHimalayas(terms?: string[]): Promise<FetchedJob[]> {
  return perTerm(terms, searchHimalayas);
}

async function searchHimalayas(term: string | null): Promise<FetchedJob[]> {
  const params = new URLSearchParams({ sort: "recent" });
  if (term) params.set("q", term);
  const out = new Map<string, FetchedJob>();
  for (let page = 1; page <= HIMALAYAS_MAX_PAGES; page++) {
    params.set("page", String(page));
    await new Promise((r) => setTimeout(r, HIMALAYAS_SPACING_MS));
    const data = await getJson<{ totalCount?: number; jobs?: HimalayasJob[] }>(
      `https://himalayas.app/jobs/api/search?${params}`,
    );
    const jobs = data.jobs ?? [];
    for (const j of jobs) {
      if (!j.guid || !j.title || out.has(j.guid)) continue;
      out.set(j.guid, {
        external_id: j.guid,
        title: j.title.trim(),
        company: j.companyName?.trim() || "Unknown company",
        location: remoteWhere(j.locationRestrictions ?? []),
        remote: true,
        url: j.guid,
        description: clip(htmlToText(j.description || j.excerpt || "")),
        compensation: salary(j.minSalary, j.maxSalary, j.currency, j.salaryPeriod),
        posted_at: fromEpoch(j.pubDate),
      });
    }
    if (jobs.length < 20 || page * 20 >= (data.totalCount ?? 0)) break;
  }
  return [...out.values()];
}

// Working Nomads: a small curated remote board; its public feed is the latest ~40 ads.
interface WorkingNomadsJob {
  url: string;
  title: string;
  description?: string;
  company_name?: string;
  location?: string;
  pub_date?: string;
}

async function fetchWorkingNomads(): Promise<FetchedJob[]> {
  const jobs = await getJson<WorkingNomadsJob[]>("https://www.workingnomads.com/api/exposed_jobs/");
  return jobs
    .filter((j) => j.url && j.title)
    .map((j) => ({
      external_id: j.url,
      title: j.title.trim(),
      company: j.company_name?.trim() || "Unknown company",
      location: remoteWhere((j.location ?? "").split(/,\s*/)),
      remote: true,
      url: j.url,
      description: clip(htmlToText(j.description ?? "")),
      compensation: null,
      posted_at: j.pub_date ? new Date(j.pub_date).toISOString() : null,
    }));
}

// Remote OK: remote jobs, mostly US companies; the feed is the latest ~100 ads.
// Its terms ask for a link back to the Remote OK posting, which is the URL we store.
interface RemoteOkJob {
  id?: string;
  position?: string;
  company?: string;
  location?: string;
  description?: string;
  url?: string;
  epoch?: number;
  salary_min?: number;
  salary_max?: number;
}

async function fetchRemoteOk(): Promise<FetchedJob[]> {
  const data = await getJson<RemoteOkJob[]>("https://remoteok.com/api");
  return data
    .filter((j) => j.id && j.position && j.url) // the first entry is the legal notice
    .map((j) => ({
      external_id: String(j.id),
      title: j.position!.trim(),
      company: j.company?.trim() || "Unknown company",
      location: remoteWhere(j.location ? [j.location] : []),
      remote: true,
      url: j.url!,
      description: clip(htmlToText(j.description ?? "")),
      compensation: salary(j.salary_min, j.salary_max),
      posted_at: fromEpoch(j.epoch),
    }));
}

// We Work Remotely: remote jobs, mostly US; RSS of the latest ads. Slug: a category feed
// (e.g. "remote-full-stack-programming-jobs"), or "all" for every category.
async function fetchWeWorkRemotely(): Promise<FetchedJob[]> {
  // Every category: the whole feed is ~100 recent ads; followers' filters do the rest.
  const url = "https://weworkremotely.com/remote-jobs.rss";
  const xml = await (await get(url, "application/rss+xml")).text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.map((item) => {
    const link = xmlTag(item, "link");
    // Titles read "Company: Role".
    const full = decodeEntities(xmlTag(item, "title"));
    const i = full.indexOf(": ");
    const region = decodeEntities(xmlTag(item, "region"));
    const country = decodeEntities(xmlTag(item, "country"));
    const pub = xmlTag(item, "pubDate");
    return {
      external_id: xmlTag(item, "guid") || link,
      title: (i > 0 ? full.slice(i + 2) : full).trim(),
      company: i > 0 ? full.slice(0, i).trim() : "Unknown company",
      location: remoteWhere([country || region].filter((x) => x && !/anywhere in the world/i.test(x))),
      remote: true,
      url: link,
      description: clip(htmlToText(decodeEntities(xmlTag(item, "description")))),
      compensation: null,
      posted_at: pub ? new Date(pub).toISOString() : null,
    };
  });
}

// Arbeitnow: jobs in Europe, mostly Germany (on-site and remote), 300 a page, newest
// first. Reads up to 5 pages, stopping at ads older than two weeks.
const ARBEITNOW_MAX_PAGES = 5;
const ARBEITNOW_MAX_AGE_DAYS = 14;

interface ArbeitnowJob {
  slug: string;
  company_name?: string;
  title: string;
  description?: string;
  remote?: boolean;
  url: string;
  location?: string;
  created_at?: number;
}

async function fetchArbeitnow(): Promise<FetchedJob[]> {
  const cutoff = Date.now() / 1000 - ARBEITNOW_MAX_AGE_DAYS * 86_400;
  const out: FetchedJob[] = [];
  for (let page = 1; page <= ARBEITNOW_MAX_PAGES; page++) {
    // Pages are ~2MB, so give them longer than the default.
    const data = await getJson<{ data?: ArbeitnowJob[]; links?: { next?: string | null } }>(
      `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
      45_000,
    );
    const jobs = data.data ?? [];
    for (const j of jobs) {
      if ((j.created_at ?? 0) < cutoff) continue;
      const place = j.location?.trim() ?? "";
      out.push({
        external_id: j.slug,
        title: j.title.trim(),
        company: j.company_name?.trim() || "Unknown company",
        location: j.remote ? [place, "Remote"].filter(Boolean).join(" / ") : place,
        remote: Boolean(j.remote),
        url: j.url,
        description: clip(htmlToText(j.description ?? "")),
        compensation: null,
        posted_at: fromEpoch(j.created_at),
      });
    }
    if (!data.links?.next || jobs.some((j) => (j.created_at ?? 0) < cutoff)) break;
  }
  return out;
}

// Work With Indies: jobs at indie game studios worldwide. No API: the job cards are in
// the home page's HTML (all of them, ~100). Descriptions come from each posting page.
async function fetchWorkWithIndies(): Promise<FetchedJob[]> {
  const html = await (await get("https://www.workwithindies.com/", "text/html")).text();
  const cards = [...html.matchAll(/<a[^>]+href="(\/careers\/[^"]+)"[^>]*class="job-card[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
  if (!cards.length) throw new Error("Work With Indies: no job cards found (site layout changed?)");
  const text = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, "")).trim();
  return cards.map(([, path, body]) => {
    const mobile = body.match(/class="job-link-mobile">([\s\S]*)/)?.[1] ?? body;
    const title = text(mobile.match(/class="text-block-14">([\s\S]*?)<\/div>/)?.[1] ?? "");
    const small = [...mobile.matchAll(/class="job-card-text-smol">([\s\S]*?)<\/div>/g)].map((m) => text(m[1])).filter((t) => t !== "|");
    const [company = "Unknown studio", place = ""] = small;
    // The card says "to work from <place>" for remote roles, "to join their team in <place>" otherwise.
    const remote = /class="job-card-text">to work from/.test(body) || looksRemote(place);
    const url = `https://www.workwithindies.com${path}`;
    return {
      external_id: path.replace("/careers/", ""),
      title,
      company,
      location: remote ? remoteWhere([place]) : place,
      remote,
      url,
      description: "", // fetched from the posting page later
      compensation: null,
      posted_at: null,
    };
  }).filter((j) => j.title);
}

// --- Jobylon ------------------------------------------------------------------
// A Nordic ATS. No public API: each company's embeddable widget page lists every open
// job in a JavaScript array (JBL.embed_v2['jobs'] = [{ id: '…', url: '…', … }]).
// Slug: the company's Jobylon id. The list has the city only ("Helsinki"), so the
// location filter waits for the posting, whose structured data has the country.

interface JobylonEntry {
  id: string;
  url: string;
  title: string;
  company: string;
  locations_text: string;
  workspace: string;
  published_date: string;
}

/** One string field from a JS object literal chunk ("key: 'value'"), with \uXXXX escapes decoded. */
function jsField(chunk: string, key: string): string {
  const m = chunk.match(new RegExp(`\\b${key}: '((?:[^'\\\\]|\\\\.)*)'`));
  if (!m) return "";
  return m[1]
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, "$1");
}

async function fetchJobylon(companyId: string, company: string): Promise<FetchedJob[]> {
  const html = await (await get(`https://cdn.jobylon.com/jobs/companies/${encodeURIComponent(companyId)}/embed/v2/`, "text/html")).text();
  const start = html.indexOf("JBL.embed_v2['jobs']");
  if (start < 0) throw new Error("Jobylon: job list not found (no such company, or the widget changed)");
  const list = html.slice(start, html.indexOf("];", start));
  // Each job starts with "{ id: '<digits>'"; nested objects come after it, so splitting there is safe.
  const chunks = list.split(/\{\s*id: '/).slice(1).map((c) => `id: '${c}`);
  return chunks
    .map((c): JobylonEntry => ({
      id: jsField(c, "id"),
      url: jsField(c, "url"),
      title: jsField(c, "title"),
      company: jsField(c, "company"),
      locations_text: jsField(c, "locations_text"),
      workspace: jsField(c, "workspace"),
      published_date: jsField(c, "published_date"),
    }))
    .filter((j) => j.id && j.title && j.url)
    .map((j) => {
      const remote = /remote/i.test(j.workspace);
      const posted = Date.parse(j.published_date.replace(/\./g, ""));
      return {
        external_id: j.id,
        title: j.title.trim(),
        // Jobylon's own name: the source's may just be the numeric id.
        company: j.company || company || "Unknown company",
        location: [j.locations_text, remote ? "Remote" : ""].filter(Boolean).join(" / "),
        remote,
        url: new URL(j.url, "https://emp.jobylon.com").toString(),
        description: "", // from the posting page later (with its country)
        compensation: null,
        posted_at: Number.isFinite(posted) ? new Date(posted).toISOString() : null,
      };
    });
}

// Jobindex: Denmark's largest job board, through its search RSS (20 a page). Slug: search
// parameters, e.g. "q=developer"; empty means "q=developer". Titles read "Role, Company";
// descriptions come from the posting later (the feed has a short teaser only).
const JOBINDEX_MAX_PAGES = 3;

async function fetchJobindex(terms?: string[]): Promise<FetchedJob[]> {
  return perTerm(terms, searchJobindex);
}

async function searchJobindex(term: string | null): Promise<FetchedJob[]> {
  const params = new URLSearchParams(term ? { q: term } : {});
  const out = new Map<string, FetchedJob>();
  for (let page = 1; page <= JOBINDEX_MAX_PAGES; page++) {
    params.set("page", String(page));
    const xml = await (await get(`https://www.jobindex.dk/jobsoegning.rss?${params}`, "application/rss+xml")).text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    for (const item of items) {
      const link = decodeEntities(xmlTag(item, "link"));
      const id = link.match(/\/vis-job\/([a-z0-9]+)/i)?.[1] ?? link;
      if (!link || out.has(id)) continue;
      const full = decodeEntities(xmlTag(item, "title"));
      const comma = full.lastIndexOf(", ");
      const teaser = decodeEntities(xmlTag(item, "description"));
      const area = decodeEntities(teaser.match(/jix_robotjob--area[^>]*>([^<]*)</)?.[1] ?? "").trim();
      const pub = xmlTag(item, "pubDate");
      out.set(id, {
        external_id: id,
        title: (comma > 0 ? full.slice(0, comma) : full).trim(),
        company: comma > 0 ? full.slice(comma + 2).trim() : "Unknown company",
        location: area ? `${area}, Denmark` : "Denmark",
        remote: looksRemote(area),
        url: link,
        description: "", // the feed only has a teaser; the posting is fetched later
        compensation: null,
        posted_at: pub && Number.isFinite(Date.parse(pub)) ? new Date(pub).toISOString() : null,
      });
    }
    if (items.length < 20) break;
  }
  return [...out.values()];
}

// Magnet.me: jobs, traineeships and internships in the Netherlands and Belgium, mostly for
// students and graduates. Its public API lists live postings (filtered, 100 a page) but
// not company names: those, and the description, come from the posting page later.
// Slug: filter parameters, e.g. "jobFunctions=IT"; empty means "jobFunctions=IT".
const MAGNETME_PAGE = 100;
/** All live postings (~27,000): Magnet.me has no text search, only fixed job categories. */
const MAGNETME_MAX_PAGES = 400;

interface MagnetOpportunity {
  id: number;
  name: string;
  remote?: boolean;
  publishedAt?: string | null;
  geolocation?: { city?: string; translatedCountry?: string; country?: string } | null;
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function fetchMagnetMe(): Promise<FetchedJob[]> {
  const params = new URLSearchParams({ state: "PUBLISHED" });
  params.set("limit", String(MAGNETME_PAGE));
  const out: FetchedJob[] = [];
  for (let page = 0; page < MAGNETME_MAX_PAGES; page++) {
    params.set("offset", String(page * MAGNETME_PAGE));
    const data = await getJson<{ data?: MagnetOpportunity[]; totalSize?: number }>(`https://magnet.me/api/opportunities?${params}`);
    const rows = data.data ?? [];
    for (const o of rows) {
      const g = o.geolocation ?? {};
      const place = [g.city, g.translatedCountry || g.country].filter(Boolean).join(", ");
      out.push({
        external_id: String(o.id),
        title: o.name.trim(),
        company: "", // filled in from the posting page
        location: o.remote ? [place, "Remote"].filter(Boolean).join(" / ") : place,
        remote: Boolean(o.remote),
        url: `https://magnet.me/en/opportunity/${o.id}/${slugify(o.name) || "opportunity"}`,
        description: "",
        compensation: null,
        posted_at: o.publishedAt ?? null,
      });
    }
    if (rows.length < MAGNETME_PAGE || (page + 1) * MAGNETME_PAGE >= (data.totalSize ?? 0)) break;
  }
  return out;
}

// Berlin Startup Jobs: a WordPress board for Berlin startups; RSS per category, 10-12 a
// page. Slug: a category ("engineering", "design-ux", …) or "all". Titles read
// "Role // Company"; the feed has a teaser only, so descriptions come from the postings.
const BSJ_MAX_PAGES = 10;

async function fetchBerlinStartupJobs(): Promise<FetchedJob[]> {
  // Every category, newest first; followers' filters do the rest.
  const base = "https://berlinstartupjobs.com/feed/";
  const out = new Map<string, FetchedJob>();
  for (let page = 1; page <= BSJ_MAX_PAGES; page++) {
    let xml: string;
    try {
      xml = await (await get(page === 1 ? base : `${base}?paged=${page}`, "application/rss+xml")).text();
    } catch (e) {
      if (page > 1 && e instanceof Error && e.message.startsWith("404")) break; // past the last page
      throw e;
    }
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    for (const item of items) {
      const link = xmlTag(item, "link");
      if (!link || out.has(link)) continue;
      const full = decodeEntities(xmlTag(item, "title"));
      const sep = full.lastIndexOf(" // ");
      const pub = xmlTag(item, "pubDate");
      out.set(link, {
        external_id: xmlTag(item, "guid") || link,
        title: (sep > 0 ? full.slice(0, sep) : full).trim(),
        company: sep > 0 ? full.slice(sep + 4).trim() : "Unknown company",
        location: "Berlin, Germany",
        remote: false,
        url: link,
        description: "", // teaser only; the posting is fetched later
        compensation: null,
        posted_at: pub && Number.isFinite(Date.parse(pub)) ? new Date(pub).toISOString() : null,
      });
    }
    if (items.length < 10) break;
  }
  return [...out.values()];
}

// Landing.jobs: curated tech jobs, mostly Portugal and elsewhere in Europe, through its
// public API (50 a page, the whole board). No company field: it's in the URL
// (landing.jobs/at/<company>/<job>).
interface LandingJob {
  id: string | number;
  title: string;
  url: string;
  remote?: boolean;
  role_description?: string | null;
  main_requirements?: string | null;
  nice_to_have?: string | null;
  perks?: string | null;
  currency_code?: string | null;
  gross_salary_low?: number | null;
  gross_salary_high?: number | null;
  published_at?: string | null;
  locations?: { city?: string | null; country_code?: string | null }[];
}

export const countryName = (code?: string | null) => {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

async function fetchLandingJobs(): Promise<FetchedJob[]> {
  const out: FetchedJob[] = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const jobs = await getJson<LandingJob[]>(`https://landing.jobs/api/v1/jobs?offset=${offset}`);
    for (const j of jobs) {
      const company = j.url.match(/\/at\/([^/]+)\//)?.[1] ?? "";
      const places = (j.locations ?? []).map((l) => [l.city, countryName(l.country_code)].filter(Boolean).join(", ")).filter(Boolean);
      out.push({
        external_id: String(j.id),
        title: j.title.trim(),
        company: company ? company.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown company",
        location: [...places, j.remote ? "Remote" : ""].filter(Boolean).join(" | "),
        remote: Boolean(j.remote),
        url: j.url,
        description: clip(
          [j.role_description, j.main_requirements, j.nice_to_have, j.perks].filter(Boolean).map((h) => htmlToText(String(h))).join("\n\n"),
        ),
        compensation: salary(j.gross_salary_low, j.gross_salary_high, j.currency_code),
        posted_at: j.published_at ?? null,
      });
    }
    if (jobs.length < 50) break;
  }
  return out;
}

// jobs.ch: Switzerland's largest job board, through its public search API (20 a page, up
// to 10 pages). Slug: search parameters, e.g. "query=developer"; empty means that.
// The search has a short preview only; descriptions come from the postings.
const JOBSCH_MAX_PAGES = 3;

interface JobsChDoc {
  job_id: string;
  title: string;
  company_name?: string | null;
  place?: string | null;
  publication_date?: string | null;
  _links?: { detail_en?: { href?: string }; detail_de?: { href?: string } };
}

async function fetchJobsCh(terms?: string[]): Promise<FetchedJob[]> {
  return perTerm(terms, searchJobsCh);
}

async function searchJobsCh(term: string | null): Promise<FetchedJob[]> {
  const params = new URLSearchParams(term ? { query: term } : {});
  const out = new Map<string, FetchedJob>();
  for (let page = 1; page <= JOBSCH_MAX_PAGES; page++) {
    params.set("page", String(page));
    const data = await getJson<{ documents?: JobsChDoc[]; num_pages?: number }>(`https://www.jobs.ch/api/v1/public/search?${params}`);
    for (const d of data.documents ?? []) {
      const url = d._links?.detail_en?.href ?? d._links?.detail_de?.href;
      if (!url || out.has(d.job_id)) continue;
      const place = d.place?.trim() ?? "";
      out.set(d.job_id, {
        external_id: d.job_id,
        title: d.title.trim(),
        company: d.company_name?.trim() || "Unknown company",
        location: place ? `${place}, Switzerland` : "Switzerland",
        remote: looksRemote(place),
        url,
        description: "", // from the posting later
        compensation: null,
        posted_at: d.publication_date ? new Date(d.publication_date).toISOString() : null,
      });
    }
    if (page >= (data.num_pages ?? 0)) break;
  }
  return [...out.values()];
}

/** A Jobylon posting URL (emp.jobylon.com/jobs/<id>-…). */
export const isJobylonPosting = (url: string) => /^https?:\/\/emp\.jobylon\.com\/jobs\/\d+/i.test(url);

/**
 * Whether a listing's real location comes with its details, so the location filter has
 * to wait: Workday lists say "Best" or "3 Locations", Jobylon lists name the city only.
 */
export const locationNeedsDetail = (url: string) =>
  workdayFromUrl(url) !== null || isJobylonPosting(url) || isAvaturePosting(url) || isPersonioPosting(url) || isBambooPosting(url);

/** A Personio job link. Read from a careers page, its list location is a city only. */
export const isPersonioPosting = (url: string) => /\.jobs\.personio\.(?:de|com)\/job\/\d+/i.test(url);

// --- Avature (careers sites of EA and other large employers) -------------------------
// Slug: the career site's base, "<host>[/<locale>]/careers", e.g. "jobs.ea.com/en_US/careers".
// Read from its search pages, 20 postings each (the RSS feed ignores the offset). Each
// result has a title, link and first location; the posting page adds every location,
// the work model and the description, for postings that pass someone's title filter.

const AVATURE_PAGE = 20;
const AVATURE_MAX_PAGES = 150;

/** An Avature posting link: …/careers/JobDetail/<title>/<id>. */
export const isAvaturePosting = (url: string) => /\/careers\/JobDetail\/[^/?#]+\/\d+/i.test(url);

async function fetchAvature(base: string, company: string): Promise<FetchedJob[]> {
  const out = new Map<string, FetchedJob>();
  for (let page = 0; page < AVATURE_MAX_PAGES; page++) {
    const html = await (
      await get(`https://${base}/SearchJobs?jobRecordsPerPage=${AVATURE_PAGE}&jobOffset=${page * AVATURE_PAGE}`, "text/html")
    ).text();
    const results = html.split(/<article class="article article--result/).slice(1);
    let added = 0;
    for (const r of results) {
      const a = r.match(/<a class="link link_result" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const id = a?.[1].match(/\/(\d+)\/?(?:[?#]|$)/)?.[1];
      if (!a || !id || out.has(id)) continue;
      added++;
      const location = decodeEntities(r.match(/class="list-item-location">([\s\S]*?)</)?.[1] ?? "").trim();
      out.set(id, {
        external_id: id,
        title: decodeEntities(a[2]).replace(/\s+/g, " ").trim(),
        company,
        location, // the first one; the posting page lists them all
        remote: looksRemote(location),
        url: decodeEntities(a[1]),
        description: "",
        compensation: null,
        posted_at: null,
      });
    }
    // A short page is the last; a page with nothing new means the offset stopped moving.
    if (results.length < AVATURE_PAGE || added === 0) break;
  }
  return [...out.values()];
}

/**
 * An Avature posting page: its description (the unlabelled fields), its locations
 * ("Location: Madrid Country: Spain" pairs) and whether its work model is remote.
 */
export async function fetchAvatureDescription(url: string): Promise<{ text: string; location?: string; remote?: boolean }> {
  const res = await get(url, "text/html");
  const html = await res.text();
  const fields = [...html.matchAll(/<div class="article__content__view__field([^"]*)"[^>]*>([\s\S]*?)(?=<div class="article__content__view__field[ "]|<\/article>)/g)];
  const text: string[] = [];
  let location: string | undefined;
  let remote = false;
  for (const [, cls, body] of fields) {
    if (/visibility--hidden/.test(cls)) continue;
    let plain = htmlToText(body);
    if (/field--locations/.test(cls)) {
      plain = plain.replace(/[•\u00a0]/g, " ").replace(/\s+/g, " ");
      const pairs = [...plain.matchAll(/Location:\s*([^]+?)\s*Country:\s*([^]+?)(?=\s*Location:|$)/g)].map((m) => `${m[1].trim()}, ${m[2].trim()}`);
      location = pairs.length ? [...new Set(pairs)].join(" | ") : plain.replace(/^Locations?\s*:?\s*/i, "").trim() || undefined;
      continue;
    }
    const label = body.match(/__label[^>]*>([\s\S]*?)</)?.[1]?.trim();
    if (label) {
      if (/work model/i.test(label) && /remote/i.test(plain)) remote = true;
      continue; // Role ID, Worker Type, Studio…: not the description
    }
    if (plain.trim()) text.push(plain.trim());
  }
  if (!text.length) throw new Error("Avature: no description found on the posting page");
  return { text: clip(text.join("\n\n")), location, remote };
}

// --- Apple (jobs.apple.com) -------------------------------------------------------
// Apple's own careers site. No public API, but its search pages carry their results as
// page data (20 a page). The search can't narrow by role (common words match nearly
// every posting), so it's read newest first back to the last successful check; the
// followers' filters do the rest. Descriptions come from the posting pages' data.

const APPLE_BASE = "https://jobs.apple.com/en-us";
/** Read back to the last success minus this margin: postings can appear a little late. */
const APPLE_MARGIN_MS = 24 * 3_600_000;
/** How far back the first fetch reads. */
const APPLE_FIRST_WINDOW_MS = 14 * 24 * 3_600_000;
/** At most this many pages (20 postings each) per fetch. */
const APPLE_MAX_PAGES = 50;

interface ApplePosting {
  id: string;
  positionId: string;
  type?: string;
  postingTitle: string;
  transformedPostingTitle: string;
  postDateInGMT?: string;
  jobSummary?: string;
  homeOffice?: boolean | string;
  locations?: { name?: string; city?: string; countryName?: string }[];
  team?: { teamCode?: string };
}

/** The JSON a jobs.apple.com page embeds (React Router hydration data). */
function applePageData(html: string): { loaderData?: Record<string, unknown> } {
  const m = html.match(/window\.__staticRouterHydrationData = JSON\.parse\(("(?:[^"\\]|\\.)*")\);/);
  if (!m) throw new Error("Apple: page data not found (site layout changed?)");
  return JSON.parse(JSON.parse(m[1]));
}

/** "Cupertino, United States of America"; a country-level location is just the country. */
const applePlace = (l: { name?: string; city?: string; countryName?: string }) =>
  [...new Set([l.name || l.city, l.countryName].filter(Boolean))].join(", ");

const appleTrue = (v: unknown) => v === true || v === "True" || v === "true";

async function fetchApple(since: string | null | undefined): Promise<FetchedJob[]> {
  const stop = since ? Date.parse(since) - APPLE_MARGIN_MS : Date.now() - APPLE_FIRST_WINDOW_MS;
  const out = new Map<string, FetchedJob>();
  for (let page = 1; page <= APPLE_MAX_PAGES; page++) {
    const html = await (await get(`${APPLE_BASE}/search?sort=newest&page=${page}`, "text/html")).text();
    const search = applePageData(html).loaderData?.search as { searchResults?: ApplePosting[] } | undefined;
    const results = search?.searchResults ?? [];
    for (const r of results) {
      // Retail hiring pipelines link by position id, other roles by their job number.
      const id = r.type === "PIPE" ? r.positionId : r.id;
      if (out.has(id)) continue;
      const places = (r.locations ?? []).map(applePlace).filter(Boolean);
      const remote = appleTrue(r.homeOffice);
      const team = r.team?.teamCode ? `?team=${encodeURIComponent(r.team.teamCode)}` : "";
      out.set(id, {
        external_id: id,
        title: r.postingTitle.trim(),
        company: "Apple",
        location: [...new Set(places), remote ? "Remote" : ""].filter(Boolean).join(" | "),
        remote,
        url: `${APPLE_BASE}/details/${encodeURIComponent(id)}/${r.transformedPostingTitle}${team}`,
        description: "", // the summary is boilerplate; the posting page has the real text
        compensation: null,
        posted_at: r.postDateInGMT ?? null,
      });
    }
    const oldest = results.at(-1)?.postDateInGMT;
    if (results.length < 20 || (oldest && Date.parse(oldest) < stop)) break;
  }
  return [...out.values()];
}

/** A jobs.apple.com posting's text and locations, from its page data. */
export async function fetchAppleDescription(url: string): Promise<{ text: string; location?: string }> {
  const html = await (await get(url, "text/html")).text();
  const d = (applePageData(html).loaderData?.jobDetails as { jobsData?: Record<string, unknown> } | undefined)?.jobsData;
  if (!d) throw new Error("Apple: posting data not found");
  const part = (title: string, key: string) => (typeof d[key] === "string" && d[key] ? `${title}\n${htmlToText(String(d[key]))}` : "");
  const text = [
    part("Summary", "jobSummary"),
    part("Description", "description"),
    part("Responsibilities", "responsibilities"),
    part("Minimum qualifications", "minimumQualifications"),
    part("Preferred qualifications", "preferredQualifications"),
  ]
    .filter(Boolean)
    .join("\n\n");
  const locs = (d.locations as { name?: string; city?: string; countryName?: string }[] | undefined) ?? [];
  const location = [...new Set(locs.map(applePlace).filter(Boolean))].join(" | ");
  return { text: clip(text), location: location || undefined };
}

/** A jobs.apple.com link. */
export const isAppleUrl = (url: string) => /^https?:\/\/jobs\.apple\.com\//i.test(url);

/** Number of postings on Apple's careers site, from one request (Add board shows it). */
export async function appleTotal(): Promise<number> {
  const html = await (await get(`${APPLE_BASE}/search`, "text/html")).text();
  return (applePageData(html).loaderData?.search as { totalRecords?: number } | undefined)?.totalRecords ?? 0;
}

/**
 * Fetches a source's listings and counts the HTTP requests it made (retries included),
 * which the Sources page shows as what the source costs to run.
 */
export async function fetchBoardCounted(
  source: Pick<Source, "ats" | "slug" | "company_name" | "country" | "last_success_at">,
  terms?: string[],
): Promise<{ jobs: FetchedJob[]; requests: number }> {
  const counter = { n: 0 };
  const jobs = await requestCount.run(counter, () => fetchBoard(source, terms));
  return { jobs, requests: counter.n };
}

/**
 * Fetches a source's current listings. `terms` are the searches for searchable aggregators
 * (ATS_INFO[ats].searchable), built from their followers' target roles; without them,
 * those fetch their newest listings.
 */
export function fetchBoard(
  source: Pick<Source, "ats" | "slug" | "company_name" | "country" | "last_success_at">,
  terms?: string[],
): Promise<FetchedJob[]> {
  const { ats, slug, company_name: company } = source;
  switch (ats) {
    case "greenhouse":
      return fetchGreenhouse(slug, company);
    case "lever":
      return fetchLever(slug, company);
    case "ashby":
      return fetchAshby(slug, company);
    case "teamtailor":
      return fetchTeamtailor(slug, company);
    case "smartrecruiters":
      return fetchSmartRecruiters(slug, company, source.country);
    case "personio":
      return fetchPersonio(slug, company);
    case "recruitee":
      return fetchRecruitee(slug, company);
    case "workable":
      return fetchWorkable(slug, company);
    case "workday":
      return fetchWorkday(slug, company);
    case "pinpoint":
      return fetchPinpoint(slug, company);
    case "jobylon":
      return fetchJobylon(slug, company);
    case "apple":
      return fetchApple(source.last_success_at);
    case "avature":
      return fetchAvature(slug, company);
    case "hibob":
      return fetchHiBob(slug, company);
    case "breezy":
      return fetchBreezy(slug, company);
    case "bamboohr":
      return fetchBambooHR(slug, company);
    case "phenom":
      return fetchPhenom(slug, company, terms);
    case "rippling":
      return fetchRippling(slug, company);
    case "inrecruiting":
      return fetchInRecruiting(slug, company);
    case "jobtech":
      return fetchJobTech(terms);
    case "swedengamejobs":
      return fetchSwedenGameJobs();
    case "himalayas":
      return fetchHimalayas(terms);
    case "workingnomads":
      return fetchWorkingNomads();
    case "remoteok":
      return fetchRemoteOk();
    case "weworkremotely":
      return fetchWeWorkRemotely();
    case "arbeitnow":
      return fetchArbeitnow();
    case "workwithindies":
      return fetchWorkWithIndies();
    case "jobindex":
      return fetchJobindex(terms);
    case "magnetme":
      return fetchMagnetMe();
    case "berlinstartupjobs":
      return fetchBerlinStartupJobs();
    case "landingjobs":
      return fetchLandingJobs();
    case "jobsch":
      return fetchJobsCh(terms);
  }
}

export const ATS_BOARD_URL: Record<Ats, (slug: string) => string> = {
  greenhouse: (s) => `https://job-boards.greenhouse.io/${s}`,
  lever: (s) => (s.startsWith("eu/") ? `https://jobs.eu.lever.co/${s.slice(3)}` : `https://jobs.lever.co/${s}`),
  ashby: (s) => `https://jobs.ashbyhq.com/${s}`,
  teamtailor: (s) => `https://${s}/jobs`,
  smartrecruiters: (s) => `https://jobs.smartrecruiters.com/${s}`,
  personio: (s) => `https://${s}`,
  recruitee: (s) => `https://${s}`,
  workable: (s) => `https://apply.workable.com/${s}`,
  workday: (s) => `https://${s}`,
  pinpoint: (s) => `https://${s}`,
  jobylon: (s) => `https://emp.jobylon.com/companies/${s}/`,
  jobtech: () => "https://arbetsformedlingen.se/platsbanken/",
  swedengamejobs: () => "https://www.swedengamejobs.com/",
  himalayas: () => "https://himalayas.app/jobs",
  workingnomads: () => "https://www.workingnomads.com/jobs",
  remoteok: () => "https://remoteok.com/",
  weworkremotely: () => "https://weworkremotely.com/",
  arbeitnow: () => "https://www.arbeitnow.com/",
  workwithindies: () => "https://www.workwithindies.com/",
  jobindex: () => "https://www.jobindex.dk/jobsoegning",
  magnetme: () => "https://magnet.me/en/opportunities",
  berlinstartupjobs: () => "https://berlinstartupjobs.com/",
  landingjobs: () => "https://landing.jobs/jobs",
  jobsch: () => "https://www.jobs.ch/en/vacancies/",
  apple: () => "https://jobs.apple.com/en-us/search?sort=newest",
  avature: (s) => `https://${s}/SearchJobs`,
  hibob: (s) => `https://${s}.careers.hibob.com/`,
  breezy: (s) => `https://${s}.breezy.hr/`,
  bamboohr: (s) => `https://${s}.bamboohr.com/careers`,
  phenom: (s) => `https://${s}/search-results`,
  rippling: (s) => `https://ats.rippling.com/${s}/jobs`,
  inrecruiting: (s) => {
    const [host, org, lang = "en"] = s.split("/");
    return `https://${host}/${org}/${lang}/career`;
  },
};

/** Whether a custom domain runs a Teamtailor (/jobs.rss) or Recruitee (/api/offers/) career site. */
export async function probeHost(host: string): Promise<"teamtailor" | "recruitee" | null> {
  const ok = async (path: string, type: RegExp) => {
    try {
      const res = await fetch(`https://${host}${path}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      });
      return res.ok && type.test(res.headers.get("content-type") ?? "");
    } catch {
      return false;
    }
  };
  if (await ok("/jobs.rss", /xml/)) return "teamtailor";
  if (await ok("/api/offers/", /json/)) return "recruitee";
  return null;
}
