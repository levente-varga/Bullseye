import { USER_AGENT, fetchAppleDescription, fetchAvatureDescription, isAvaturePosting, fetchSmartRecruitersDescription, fetchWorkdayPosting, htmlToText, isAppleUrl, isJobylonPosting, workdayFromUrl } from "./ats";
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
): Promise<{ text: string; location?: string; company?: string; remote?: boolean }> {
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
  // Avature: description, locations and work model are fields on the posting page.
  if (isAvaturePosting(job.url)) return fetchAvatureDescription(job.url);
  // Apple's posting pages render in the browser; their page data has the text.
  if (isAppleUrl(job.url)) return fetchAppleDescription(job.url);
  // Jobylon lists name the city only: the posting's structured data adds the country.
  if (isJobylonPosting(job.url)) return describePage(job.url);
  // Magnet.me's API has no company names; its list already has the full location
  // ("Utrecht, Netherlands"), which the page would shorten to a country code.
  if (/^https:\/\/magnet\.me\/en\/opportunity\//.test(job.url)) {
    const { text, company } = await describePage(job.url);
    return { text, company };
  }
  return { text: await describeFromPage(job.url) };
}

/** Fetches a posting page and extracts its text: schema.org JobPosting first, then the page body. */
export async function describeFromPage(url: string): Promise<string> {
  return (await describePage(url)).text;
}

/** The posting's text, and its location ("City, Country") when its structured data has one. */
async function describePage(url: string): Promise<{ text: string; location?: string; company?: string }> {
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
          return { text: text.slice(0, MAX), location: postingLocation(found), company: company || undefined };
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
  return { text: text.slice(0, MAX) };
}

/** "Helsinki, Finland" from a JobPosting's jobLocation (one place or several), if it has a country. */
function postingLocation(posting: { jobLocation?: Json }): string | undefined {
  const places = Array.isArray(posting.jobLocation) ? posting.jobLocation : posting.jobLocation ? [posting.jobLocation] : [];
  const names = places
    .map((pl) => {
      const a = (pl && typeof pl === "object" && !Array.isArray(pl) ? pl.address : null) as Record<string, Json> | null;
      if (!a || typeof a !== "object") return "";
      const country = typeof a.addressCountry === "object" && a.addressCountry ? (a.addressCountry as Record<string, Json>).name : a.addressCountry;
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

function findJobPosting(node: Json): { description?: Json; jobLocation?: Json; hiringOrganization?: Json } | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findJobPosting(n);
      if (f) return f;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const type = node["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return node;
    if (node["@graph"]) return findJobPosting(node["@graph"]);
  }
  return null;
}
