import type { Ats, FetchedJob, Source } from "./types";

/**
 * Adapters for job sources. The ATS ones (Greenhouse, Lever, Ashby,
 * Teamtailor, SmartRecruiters) are public endpoints companies publish for
 * exactly this purpose. Sweden Game Jobs is an aggregator read from its page
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

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

const clip = (s: string) => s.slice(0, MAX_DESCRIPTION);
const looksRemote = (s: string) => /\bremote\b/i.test(s);

async function get(url: string, accept: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { Accept: accept, "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

async function getJson<T>(url: string): Promise<T> {
  return (await (await get(url, "application/json")).json()) as T;
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
  const data = await getJson<LeverJob[]>(
    `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
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

export function fetchBoard(source: Pick<Source, "ats" | "slug" | "company_name" | "country">): Promise<FetchedJob[]> {
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
    case "swedengamejobs":
      return fetchSwedenGameJobs();
  }
}

export const ATS_BOARD_URL: Record<Ats, (slug: string) => string> = {
  greenhouse: (s) => `https://job-boards.greenhouse.io/${s}`,
  lever: (s) => `https://jobs.lever.co/${s}`,
  ashby: (s) => `https://jobs.ashbyhq.com/${s}`,
  teamtailor: (s) => `https://${s}/jobs`,
  smartrecruiters: (s) => `https://jobs.smartrecruiters.com/${s}`,
  swedengamejobs: () => "https://www.swedengamejobs.com/",
};
