import { USER_AGENT, decodeEntities } from "./ats";
import { robotsAllows } from "./robots";
import type { Ats } from "./types";

/**
 * The company's own posting behind an aggregator's listing, so its description can come
 * from the source (company page first, the aggregator's text as the fallback). Only
 * aggregators that point to it: checked by hand in Nov 2026.
 * - JobTech, Sweden Game Jobs: the listing's link already is the employer's posting.
 * - Jobindex: the posting page's "View job" button (jobs posted on Jobindex itself have none).
 * - Working Nomads: its /job/go/ link redirects to the posting.
 * Others (Magnet.me, Himalayas, Remote OK, We Work Remotely, Arbeitnow, Landing.jobs, …) have
 * you apply on the aggregator, link only the company's homepage, or forbid it in robots.txt.
 */
export async function companyLink(ats: Ats, url: string): Promise<string | null> {
  // JobTech and Sweden Game Jobs list the employer's posting as the job's own link.
  if (ats === "jobtech" || ats === "swedengamejobs") return lookUp(ats, url);
  const link = await lookUp(ats, url);
  // A link back to the aggregator itself isn't the company's posting.
  try {
    return link && new URL(link).hostname.replace(/^www\./, "") !== new URL(url).hostname.replace(/^www\./, "") ? link : null;
  } catch {
    return null;
  }
}

async function lookUp(ats: Ats, url: string): Promise<string | null> {
  try {
    switch (ats) {
      case "jobtech":
        // Platsbanken's own page when the ad has no link of its own: that's the aggregator.
        return /arbetsformedlingen\.se/i.test(new URL(url).hostname) ? null : url;
      case "swedengamejobs":
        return url;
      case "jobindex":
        return await jobindexLink(url);
      case "workingnomads":
        return await redirectTarget(url);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function jobindexLink(url: string): Promise<string | null> {
  if (!(await robotsAllows(url))) return null;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const html = await res.text();
  const href = html.match(/<a[^>]*class="[^"]*\bseejobdesktop\b[^"]*"[^>]*href="([^"]+)"/)?.[1] ?? html.match(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*\bseejobdesktop\b/)?.[1];
  if (!href) return null;
  const link = decodeEntities(href);
  return /^https?:\/\//i.test(link) && !/jobindex\.dk/i.test(new URL(link).hostname) ? link : null;
}

/** Where a redirect link points, without loading the page it points to. */
async function redirectTarget(url: string): Promise<string | null> {
  if (!(await robotsAllows(url))) return null;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  await res.body?.cancel();
  const to = res.headers.get("location");
  return to && res.status >= 300 && res.status < 400 ? new URL(to, url).toString() : null;
}
