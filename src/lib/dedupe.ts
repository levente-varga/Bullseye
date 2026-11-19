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
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co" || host === "jobs.ashbyhq.com") {
    const m = path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (m) return `${host === "jobs.ashbyhq.com" ? "ashby" : "lever"}:${m[1].toLowerCase()}`;
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
  // Pinpoint: <company>.pinpointhq.com/[en/]postings/<uuid>
  if (host.endsWith(".pinpointhq.com")) {
    const m = path.match(/\/postings\/([0-9a-f-]{36})/i);
    if (m) return `pinpoint:${m[1].toLowerCase()}`;
  }
  // Magnet.me: /<lang>/opportunity/<id>/<slug>; the slug and language vary.
  if (host === "magnet.me") {
    const m = path.match(/\/opportunit(?:y|ies)\/(\d+)/);
    if (m) return `magnet:${m[1]}`;
  }
  // jobs.ch: /<lang>/…/detail/<uuid>/ (the language part varies)
  if (host === "jobs.ch") {
    const m = path.match(/\/detail\/([0-9a-f-]{36})/i);
    if (m) return `jobsch:${m[1].toLowerCase()}`;
  }
  // Jobindex: /vis-job/<id>
  if (host === "jobindex.dk") {
    const m = path.match(/\/vis-job\/([a-z0-9]+)/i);
    if (m) return `jobindex:${m[1].toLowerCase()}`;
  }
  // HiBob: <company>.careers.hibob.com/jobs/<uuid>
  if (host.endsWith(".careers.hibob.com")) {
    const m = path.match(/\/jobs\/([0-9a-f-]{36})/i);
    if (m) return `hibob:${m[1].toLowerCase()}`;
  }
  // Breezy: <company>.breezy.hr/p/<id>-<title>
  if (host.endsWith(".breezy.hr")) {
    const m = path.match(/\/p\/([0-9a-f]{8,})(?:-|\/|$)/i);
    if (m) return `breezy:${m[1].toLowerCase()}`;
  }
  // Avature: …/careers/JobDetail/<title>/<id>; the locale prefix and title vary.
  {
    const m = path.match(/\/careers\/jobdetail\/[^/]+\/(\d+)/i);
    if (m) return `avature:${host}:${m[1]}`;
  }
  // Apple: /<locale>/details/<job number>/<title>; the locale, title and ?team= vary.
  if (host === "jobs.apple.com") {
    const m = path.match(/\/details\/([0-9a-z-]+)/i);
    if (m) return `apple:${m[1].toLowerCase()}`;
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
  | "pinpoint"
  | "apple"
  | "avature"
  | "hibob"
  | "breezy"
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
  // Lever's EU region: its own hosts, so the slug carries the region.
  if (host === "jobs.eu.lever.co") return { ats: "lever", slug: `eu/${first.toLowerCase()}` };
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
  if (host.endsWith(".pinpointhq.com")) return { ats: "pinpoint", slug: host };
  if (host.endsWith("jobylon.com")) return { ats: "custom", slug: host };
  if (host === "jobs.apple.com") return { ats: "apple", slug: "apple" };
  if (host.endsWith(".careers.hibob.com")) return { ats: "hibob", slug: host.split(".")[0] };
  if (host.endsWith(".breezy.hr") && host !== "app.breezy.hr") return { ats: "breezy", slug: host.split(".")[0] };
  {
    const base = avatureBase(url);
    if (base) return { ats: "avature", slug: base };
  }
  // Teamtailor's (/jobs/<id>-title) and Recruitee's (/o/<title>) URL shapes on custom domains.
  if (/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?jobs\/\d{5,}-/i.test(u.pathname)) return { ats: "probe?", slug: host };
  if (/^\/o\/[a-z0-9-]+/i.test(u.pathname)) return { ats: "probe?", slug: host };
  return { ats: "custom", slug: host };
}

/** The career site base of an Avature link ("jobs.ea.com/en_US/careers"), or null. */
export function avatureBase(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^((?:\/[a-z]{2}[_-][A-Za-z]{2})?\/careers)(?:\/|$)/);
    if (!m) return null;
    const avatureHost = u.hostname.endsWith(".avature.net");
    if (!avatureHost && !/\/careers\/(JobDetail|SearchJobs)\b/i.test(u.pathname)) return null;
    return `${u.hostname.toLowerCase()}${m[1]}`;
  } catch {
    return null;
  }
}
