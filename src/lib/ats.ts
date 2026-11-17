import type { Ats, FetchedJob } from "./types";

/**
 * Adapters for public ATS job-board APIs. All three are unauthenticated,
 * documented endpoints that companies publish for exactly this purpose.
 */

const MAX_DESCRIPTION = 12_000;

function htmlToText(html: string): string {
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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
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

export function fetchBoard(ats: Ats, slug: string, company: string): Promise<FetchedJob[]> {
  switch (ats) {
    case "greenhouse":
      return fetchGreenhouse(slug, company);
    case "lever":
      return fetchLever(slug, company);
    case "ashby":
      return fetchAshby(slug, company);
  }
}

export const ATS_BOARD_URL: Record<Ats, (slug: string) => string> = {
  greenhouse: (s) => `https://job-boards.greenhouse.io/${s}`,
  lever: (s) => `https://jobs.lever.co/${s}`,
  ashby: (s) => `https://jobs.ashbyhq.com/${s}`,
};
