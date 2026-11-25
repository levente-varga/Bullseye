import { USER_AGENT, fetchOracleDescription, fetchTaleoDescription, isTaleoPosting, fetchAppleDescription, fetchAvatureDescription, fetchBambooDescription, fetchRipplingDescription, fetchEightfoldDescription, ripplingJob, isAvaturePosting, isBambooPosting, isRadancyPosting, isHaileyPosting, fetchHaileyDescription, fetchSmartRecruitersDescription, fetchWorkdayPosting, htmlToText, isAppleUrl, isJobylonPosting, isPersonioPosting, countryName, workdayFromUrl, CITY_ONLY_LISTS, isLandingJobsPosting, fetchLandingJobsPosting } from "./ats";
import type { Source } from "./types";

/**
 * Finds a description for listings whose source doesn't include one
 * (SmartRecruiters and Workday lists, aggregator entries). Only runs for new listings
 * that passed the title/location filters, so each posting is fetched once.
 */

const MAX = 12_000;
/** Below this, we treat the listing as "thin": scored on title and location only. */
export const THIN_THRESHOLD = 300;

/** Thrown when the posting page says the job is gone (aggregators lag behind). */
export class PostingClosedError extends Error {}

const CLOSED_RE =
  /(position|job|vacancy|role|posting)( is| has been)? (no longer|not) (available|active|open)|no longer accepting applications|this job (has )?(expired|closed)/i;

/**
 * The posting's text, plus its real location when the list didn't have it
 * (Workday lists say "Best" or "3 Locations"; the detail gives "Best, Netherlands").
 */
export async function describe(
  source: Pick<Source, "ats" | "slug">,
  job: { external_id: string; url: string },
  /**
   * structuredOnly: a page must carry a real posting (a known job system, or the page's
   * JobPosting data), not just text. For companies' own pages behind aggregator links,
   * where a careers page can show the same general text for every job.
   */
  opts: { structuredOnly?: boolean; title?: string } = {},
): Promise<{ text: string; location?: string; company?: string; remote?: boolean; title?: string }> {
  const only = opts.structuredOnly ? { title: opts.title } : null;
  if (source.ats === "smartrecruiters") {
    return { text: await fetchSmartRecruitersDescription(source.slug, job.external_id) };
  }
  // Workday pages render in the browser, so the page itself has no text: use its API.
  // Also for Workday links found on an aggregator.
  const wd = source.ats === "workday" ? { slug: source.slug, path: job.external_id } : workdayFromUrl(job.url);
  if (wd) {
    const { text, location } = await fetchWorkdayPosting(wd.slug, wd.path);
    return { text, location: location || undefined };
  }
  // Rippling: the job's detail in the board API has the description.
  const rippling = ripplingJob(job.url);
  if (rippling) return fetchRipplingDescription(...rippling);
  // Eightfold: the job's entry in the careers API has the description.
  if (source.ats === "eightfold") return fetchEightfoldDescription(source.slug, job.external_id);
  // Oracle Recruiting: the job's details in the same API have the text.
  if (source.ats === "oracle") return fetchOracleDescription(source.slug, job.external_id);
  // Taleo: the posting page renders its text from a hidden field.
  if (isTaleoPosting(job.url)) return fetchTaleoDescription(job.url);
  // BambooHR: the job's detail JSON has the description and the country.
  if (isBambooPosting(job.url)) return fetchBambooDescription(job.url);
  // HaileyHR: the ad is Markdown in the job page's embedded data.
  if (isHaileyPosting(job.url)) return fetchHaileyDescription(job.url);
  // Radancy: the link only gives a rough title and the city; the posting's structured data
  // has the real title, the full location and the text.
  if (isRadancyPosting(job.url)) {
    const { text, location, title } = await describePage(job.url, only);
    return { text, location, title };
  }
  // Landing.jobs: the sitemap gives only the link; the page's data has everything else.
  if (isLandingJobsPosting(job.url)) return fetchLandingJobsPosting(job.url);
  // Avature: description, locations and work model are fields on the posting page.
  if (isAvaturePosting(job.url)) return fetchAvatureDescription(job.url);
  // Apple's posting pages render in the browser; their page data has the text.
  if (isAppleUrl(job.url)) return fetchAppleDescription(job.url);
  // Jobylon lists and Personio careers pages name the city only: the posting's structured
  // data adds the country.
  if (isJobylonPosting(job.url) || isPersonioPosting(job.url) || CITY_ONLY_LISTS.test(job.url)) {
    const { text, location } = await describePage(job.url, only);
    return { text, location };
  }
  // Magnet.me's API has no company names; its list already has the full location
  // ("Utrecht, Netherlands"), which the page would shorten to a country code.
  if (/^https:\/\/magnet\.me\/en\/opportunity\//.test(job.url)) {
    const { text, company } = await describePage(job.url, only);
    return { text, company };
  }
  return { text: (await describePage(job.url, only)).text };
}



/** Fetches a posting page and extracts its text: schema.org JobPosting first, then the page body. */
export async function describeFromPage(url: string): Promise<string> {
  return (await describePage(url)).text;
}

/** The posting's text, and its location ("City, Country") when its structured data has one. */
/** Hosts whose robots.txt asks for a pause between requests (Cornerstone: Crawl-delay 10). */
const SLOW_HOSTS: [RegExp, number][] = [[/\.csod\.com$/i, 10_000]];
const lastHit = new Map<string, Promise<void>>();
/** Waits until a slow host may be asked again; requests to it queue up one by one. */
function politeTurn(url: string): Promise<void> {
  const host = new URL(url).hostname;
  const gap = SLOW_HOSTS.find(([re]) => re.test(host))?.[1];
  if (!gap) return Promise.resolve();
  const prev = lastHit.get(host) ?? Promise.resolve();
  const mine = prev.then(() => new Promise<void>((r) => setTimeout(r, gap)));
  lastHit.set(host, mine);
  return prev;
}

async function describePage(
  url: string,
  /** Set for companies' own pages: page text only counts when it names the job (see describe). */
  strict: { title?: string } | null = null,
): Promise<{ text: string; location?: string; company?: string; title?: string }> {
  await politeTurn(url);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404 || res.status === 410) throw new PostingClosedError(`${res.status} for ${url}`);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const html = await res.text();

  // Most career sites embed structured data for Google Jobs.
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = findJobPosting(JSON.parse(m[1]));
      if (found?.description) {
        const text = htmlToText(String(found.description));
        if (text.length >= THIN_THRESHOLD) {
          const org = found.hiringOrganization;
          const company = org && typeof org === "object" && !Array.isArray(org) && typeof org.name === "string" ? org.name.trim() : undefined;
          const title = typeof found.title === "string" ? htmlToText(found.title).trim() : "";
          return { text: text.slice(0, MAX), location: postingLocation(found), company: company || undefined, title: title || undefined };
        }
      }
    } catch {
      // malformed JSON-LD: ignore and keep looking
    }
  }

  // A block marked as the job description (common on hand-built and Webflow sites),
  // which skips banners and navigation; else the main content.
  const block = innerDiv(html, /<div[^>]+class="[^"]*\bjob-description\b[^"]*"[^>]*>/i);
  const main =
    (block && htmlToText(block).length >= THIN_THRESHOLD ? block : null) ??
    html.match(/<main[\s\S]*?<\/main>/i)?.[0] ??
    html.match(/<body[\s\S]*?<\/body>/i)?.[0] ??
    html;
  const text = htmlToText(
    main
      .replace(/<(script|style|noscript|svg|nav|header|footer|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1)
    .join("\n");
  if (text.length < 2000 && CLOSED_RE.test(text)) throw new PostingClosedError(`closed: ${url}`);
  // A company's page without posting data: its text only counts when it names this job.
  // A general careers page (the same text for every job) doesn't.
  if (strict && !(strict.title && namesTheJob(text, strict.title))) throw new Error(`no posting for this job on ${url}`);
  return { text: text.slice(0, MAX) };
}

/** Whether page text names the job: most of the title's words (3+ letters), accents and case aside. */
function namesTheJob(text: string, title: string): boolean {
  const fold = (x: string) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const page = fold(text);
  const words = fold(title).split(/[^\p{L}\p{N}+#]+/u).filter((w) => w.length >= 3);
  if (!words.length) return false;
  return words.filter((w) => page.includes(w)).length / words.length >= 0.75;
}

/** "Helsinki, Finland" from a JobPosting's jobLocation (one place or several), if it has a country. */
function postingLocation(posting: { jobLocation?: Json }): string | undefined {
  const places = Array.isArray(posting.jobLocation) ? posting.jobLocation : posting.jobLocation ? [posting.jobLocation] : [];
  const names = places
    .map((pl) => {
      const a = (pl && typeof pl === "object" && !Array.isArray(pl) ? pl.address : null) as Record<string, Json> | null;
      if (!a || typeof a !== "object") return "";
      const raw = typeof a.addressCountry === "object" && a.addressCountry ? (a.addressCountry as Record<string, Json>).name : a.addressCountry;
      // A two-letter code ("DE", Personio) reads as the country's name, like the filters expect.
      const country = typeof raw === "string" && /^[A-Za-z]{2}$/.test(raw.trim()) ? countryName(raw.trim()) : raw;
      if (typeof country === "string" && country.trim()) {
        return [a.addressLocality, country].filter((x) => typeof x === "string" && x.trim()).join(", ");
      }
      // Some (Jobylon) put "Helsinki, Finland" in streetAddress and leave out the country.
      const street = typeof a.streetAddress === "string" ? a.streetAddress.trim() : "";
      return street.includes(",") ? street : "";
    })
    .filter((n) => n.includes(","));
  return names.length ? [...new Set(names)].join(" | ") : undefined;
}

/** The inner HTML of the first <div> whose opening tag matches `open`, honoring nested divs. */
function innerDiv(html: string, open: RegExp): string | null {
  const m = open.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = start;
  let depth = 1;
  for (let t = tag.exec(html); t; t = tag.exec(html)) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return null;
}

type Json = null | string | number | boolean | Json[] | { [k: string]: Json };

function findJobPosting(node: Json): { description?: Json; jobLocation?: Json; hiringOrganization?: Json; title?: Json } | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findJobPosting(n);
      if (f) return f;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const type = node["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) {
      // Some sites (Cornerstone) capitalize the property names: "Title", "Description".
      return { ...node, description: node.description ?? node.Description, title: node.title ?? node.Title, jobLocation: node.jobLocation ?? node.JobLocation, hiringOrganization: node.hiringOrganization ?? node.HiringOrganization };
    }
    if (node["@graph"]) return findJobPosting(node["@graph"]);
  }
  return null;
}
