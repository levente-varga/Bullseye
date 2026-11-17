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

/** Recognizes which ATS a posting URL belongs to, for suggesting direct sources. */
export function detectAts(url: string): { ats: "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "teamtailor?" | "custom"; slug: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ats: "custom", slug: url };
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const first = u.pathname.split("/").filter(Boolean)[0] ?? "";
  if (host.endsWith("greenhouse.io")) return { ats: "greenhouse", slug: first.toLowerCase() };
  if (host === "jobs.lever.co") return { ats: "lever", slug: first.toLowerCase() };
  if (host === "jobs.ashbyhq.com") return { ats: "ashby", slug: first.toLowerCase() };
  if (host.endsWith("smartrecruiters.com")) return { ats: "smartrecruiters", slug: first };
  if (host.endsWith("jobylon.com")) return { ats: "custom", slug: host };
  // Teamtailor's URL shape; confirmed later by checking for /jobs.rss.
  if (/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?jobs\/\d{5,}-/i.test(u.pathname)) return { ats: "teamtailor?", slug: host };
  return { ats: "custom", slug: host };
}
