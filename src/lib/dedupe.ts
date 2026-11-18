/**
 * Cross-source deduplication. The same posting can arrive from a company's own
 * ATS and from an aggregator, often under slightly different URLs (with or
 * without a title slug, different hosts). We key on the ATS's own job ID where
 * the URL reveals it, and on a cleaned-up URL otherwise.
 */
export function dedupeKey(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return `url:${url.trim().toLowerCase()}`;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const path = u.pathname;

  // Greenhouse: /jobs/<id> on its own hosts, or ?gh_jid=<id> on company sites.
  const ghJid = u.searchParams.get("gh_jid");
  if (ghJid) return `gh:${ghJid}`;
  if (host.endsWith("greenhouse.io")) {
    const m = path.match(/\/jobs\/(\d+)/);
    if (m) return `gh:${m[1]}`;
  }
  // Lever and Ashby: UUIDs after the company slug.
  if (host === "jobs.lever.co" || host === "jobs.ashbyhq.com") {
    const m = path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (m) return `${host === "jobs.lever.co" ? "lever" : "ashby"}:${m[1].toLowerCase()}`;
  }
  // SmartRecruiters: /<Company>/<digits>[-title-slug]
  if (host.endsWith("smartrecruiters.com")) {
    const m = path.match(/\/[^/]+\/(\d{6,})/);
    if (m) return `sr:${m[1]}`;
  }
  // Personio: <company>.jobs.personio.de|com/job/<id>
  if (/\.jobs\.personio\.(de|com)$/.test(host)) {
    const m = path.match(/\/job\/(\d+)/);
    if (m) return `personio:${m[1]}`;
  }
  // Workable: apply.workable.com/[<account>/]j/<shortcode>
  if (host === "apply.workable.com" || host.endsWith(".workable.com")) {
    const m = path.match(/\/j\/([A-Z0-9]{6,})/i);
    if (m) return `workable:${m[1].toUpperCase()}`;
  }
  // Workday: the posting id is the last path segment; the locale prefix (/en-US/) varies.
  if (host.endsWith(".myworkdayjobs.com")) {
    const m = path.match(/\/job\/(?:.*\/)?([^/]+)$/);
    if (m) return `workday:${host}:${m[1].toLowerCase()}`;
  }
  // Jobylon uses a Teamtailor-like path; keep its IDs in their own namespace.
  if (host.endsWith("jobylon.com")) {
    const m = path.match(/\/jobs\/(\d+)/);
    if (m) return `jobylon:${m[1]}`;
  }
  // Teamtailor (any custom domain): /jobs/<digits>-<title-slug>; IDs are global.
  const tt = path.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?jobs\/(\d{5,})(?:-|\/|$)/i);
  if (tt) return `tt:${tt[1]}`;

  // Anything else: host + path, plus non-tracking query params (some sites use ?id=).
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !/^(utm_|ref$|source$|src$|gh_src$|lever-|oga$)/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  return `url:${host}${path.replace(/\/+$/, "").toLowerCase()}${query}`;
}

export type DetectedAts =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "personio"
  | "recruitee"
  | "workable"
  | "workday"
  | "probe?" // a custom domain that looks like Teamtailor or Recruitee; confirmed with probeHost()
  | "custom";

/**
 * Recognizes which ATS a posting or board URL belongs to, and the source slug
 * (same format as sources.slug) for it. Used for suggestions and Add source.
 */
export function detectAts(url: string): { ats: DetectedAts; slug: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ats: "custom", slug: url };
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const segments = u.pathname.split("/").filter(Boolean);
  const first = segments[0] ?? "";
  if (host.endsWith("greenhouse.io")) return { ats: "greenhouse", slug: first.toLowerCase() };
  if (host === "jobs.lever.co") return { ats: "lever", slug: first.toLowerCase() };
  if (host === "jobs.ashbyhq.com") return { ats: "ashby", slug: first.toLowerCase() };
  if (host.endsWith("smartrecruiters.com")) return { ats: "smartrecruiters", slug: first };
  if (/\.jobs\.personio\.(de|com)$/.test(host)) return { ats: "personio", slug: host };
  if (host.endsWith(".recruitee.com")) return { ats: "recruitee", slug: host };
  if (host === "apply.workable.com") {
    // apply.workable.com/j/<code> links don't name the account.
    return first && !/^(j|api)$/i.test(first) ? { ats: "workable", slug: first.toLowerCase() } : { ats: "custom", slug: host };
  }
  if (host.endsWith(".workable.com") && host !== "www.workable.com") return { ats: "workable", slug: host.split(".")[0] };
  if (host.endsWith(".myworkdayjobs.com")) {
    const site = segments.find((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s)); // skip a locale like en-US
    return site ? { ats: "workday", slug: `${host}/${site}` } : { ats: "custom", slug: host };
  }
  if (host.endsWith("jobylon.com")) return { ats: "custom", slug: host };
  // Teamtailor's (/jobs/<id>-title) and Recruitee's (/o/<title>) URL shapes on custom domains.
  if (/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?jobs\/\d{5,}-/i.test(u.pathname)) return { ats: "probe?", slug: host };
  if (/^\/o\/[a-z0-9-]+/i.test(u.pathname)) return { ats: "probe?", slug: host };
  return { ats: "custom", slug: host };
}
