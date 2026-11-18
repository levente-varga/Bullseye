import { USER_AGENT, fetchSmartRecruitersDescription, fetchWorkdayPosting, htmlToText, workdayFromUrl } from "./ats";
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
): Promise<{ text: string; location?: string }> {
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
  return { text: await describeFromPage(job.url) };
}

/** Fetches a posting page and extracts its text: schema.org JobPosting first, then the page body. */
export async function describeFromPage(url: string): Promise<string> {
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
        if (text.length >= THIN_THRESHOLD) return text.slice(0, MAX);
      }
    } catch {
      // malformed JSON-LD: ignore and keep looking
    }
  }

  // Fallback: visible text of the main content.
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body[\s\S]*?<\/body>/i)?.[0] ?? html;
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
  return text.slice(0, MAX);
}

type Json = null | string | number | boolean | Json[] | { [k: string]: Json };

function findJobPosting(node: Json): { description?: Json } | null {
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
