# Custom careers pages (not built yet)

Some companies post jobs only on their own website, with no job system Bullseye can
read (no Greenhouse, Lever, Teamtailor…). A **Custom careers page** source type would
cover them:

- **Adding:** paste the careers page, and set a **default location** (these sites rarely
  state one in a machine-readable way, and a posting with no location fails the
  location filter).
- **Fetching:** read the site's jobs feed when it has one (WordPress: `/<path>/feed/`),
  otherwise collect the job links from the careers page (or its sitemap). Fetch mode:
  Paged.
- **Descriptions:** from each job's own page (JSON-LD when present, else the page text).
  Pages built in the browser have no text: those postings are titles only ("Limited
  info", scored on the title).

## Sites it would support

Checked on 2026-11-20.

| Company | Careers page | Where the jobs come from | Descriptions |
| --- | --- | --- | --- |
| Flix Interactive | flixinteractive.com/vacancies/ | WordPress jobs feed (`/vacancies/feed/`, 10 a page, `?paged=2`…) | Full, in the feed. Location only in some titles ("– Kuala Lumpur"). |
| Gaijin Entertainment | gaijinent.com/jobs | Links on the `/jobs` page (`/job/<slug>`, 11 at the time) | From each job page (no structured data) |
| Anshar Studios | ansharstudios.com/careers | Links on the careers page to Traffit (`ansharstudios.traffit.com/public/an/<hash>`, 6 at the time); Traffit's own public list is empty for them | From each Traffit job page |
| Innovecs | jobs.innovecs.com/vacancies/ | WordPress (no jobs feed): job links on the vacancies page or its Yoast sitemap | From each job page (no structured data) |
| 4A Games | 4a-games.com.mt | Squarespace site, one page per job (e.g. `/principal-ai-designer`) | From each job page |
| THQ Nordic Mobile | thqnordicmobile.com/en/jobs/ | Links on the jobs page (5 at the time); apply by email | From each job page, with structured data (so a location too) |
| Digital Sun | digitalsungames.com/jobs/ | WordPress: links on the jobs page (9 at the time); its jobs feed is empty; apply through its own system | From each job page (no structured data) |
| Original Games | originalgames.io/careers | Tilda site, one page per job (e.g. `/marketing_data_analyst`); apply by email | From each job page (no structured data) |
| Kaiko | kaikogames.com/jobs.html | Static site: `jobs.html` links one page per job (`job_anm.html`); apply by email | From each job page |
| GameXcite | gamexcite.de/jobs | Wix site: links on the jobs page (7 at the time); apply by email | From each job page |
| Hello Games | hellogames.org (e.g. `/jobs/build-engineer`) | One page per job; `/jobs` itself is a 404, so the list lives elsewhere; apply by email | From each job page |
| Mighty Koi | mighty-koi.com/careers | Its own site and application form; the careers page shows no job links (likely added by JavaScript) | From each job page |
| Bohemia Interactive | careers.bohemia.net/en/open-positions | Links on the careers page or `sitemap.xml` (7 at the time) | Titles only: the job pages render in the browser, and `robots.txt` disallows `/api/` |

## Not covered by it

- **gamejobs.co**: its firewall answers every Bullseye request with 403 (robots.txt itself
  allows general bots). Postings there are usually on the studio's own board, e.g. Sumo
  Digital's HiBob site.
- **Nintendo Europe** (Cornerstone OnDemand, `nintendoeurope.csod.com`): its job search
  needs the anonymous token the careers page issues; skipped for now.
- **Super Spline Studios** (`supersplinestudios.com/jobs/`): answers Bullseye with 403
  Forbidden, like gamejobs.co.
- **Playtouch** (`playtouch.net/career`): the jobs are added by JavaScript (the linked
  `#qa-release-ops-…` job isn't in the page's HTML); no job system behind it.
- **Playrix** (`playrix.com/job/open/…`): the whole site is a JavaScript app. Every URL
  (even `robots.txt`) returns the same empty shell, with no job links or text; the jobs
  come from an undocumented internal API.
