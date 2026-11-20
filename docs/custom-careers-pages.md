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
| Donkey Crew | donkey.team/jobs | Links on the jobs page (5 at the time); apply by email | From each job page |
| Games Farm | games-farm.com/jobs.html | **One page, one section per job** (`#programmer`…), an email link each | The section's text |
| Gamepires | gamepires.com (WordPress, `?page_id=3846`) | **One page, one section per job** (`#3d-gameplay-animator`…) | The section's text |
| AlterEyes | altereyes.com/jobs/ | **One page, one section per job** (`#headline-…`) | The section's text |
| Isoocool Entertainment | iscoolentertainment.com/careers/ | Links on the careers page (7 at the time) | Job pages are tiny (7KB, no apply link): likely rendered in the browser, so possibly titles only |
| Bohemia Interactive | careers.bohemia.net/en/open-positions | Links on the careers page or `sitemap.xml` (7 at the time) | Titles only: the job pages render in the browser, and `robots.txt` disallows `/api/` |

One-page sites (every job a section of one page) need the type to split the page by
its headings; the rest are a list of links to job pages.

## Not covered by it

- **gamejobs.co**: its firewall answers every Bullseye request with 403 (robots.txt itself
  allows general bots). Postings there are usually on the studio's own board, e.g. Sumo
  Digital's HiBob site.
- **Tesla** (`tesla.com/careers`): its CDN answers every bot request with "Access Denied"
  (403), robots.txt included; reading it would mean posing as a browser.
- **Nintendo Europe** (Cornerstone OnDemand, `nintendoeurope.csod.com`): its job search
  needs the anonymous token the careers page issues; skipped for now.
- **Super Spline Studios** (`supersplinestudios.com/jobs/`): answers Bullseye with 403
  Forbidden, like gamejobs.co.
- **Second Star Games** (CharlieHR Recruit, `jobs.recruit.charliehr.com/<company>/<job>/view-job`):
  each job page is readable (Next.js data and JSON-LD), but no public list of a company's
  jobs was found (`/<company>` and `/<company>/jobs` are 404).
- **Overwolf** (Comeet): job pages render with JSON-LD, but the list of positions is loaded
  by Comeet's script, whose API needs a company id and token not found on the site.
- **Game Dev Estonia** (`gamedevestonia.ee/jobs`, an industry job board): readable (RSS
  and a WordPress `jobpost` API), but only 7 jobs, the newest seen from 2024, and every
  job names "Gamedev Estonia" rather than the studio, so not worth an aggregator.
- **MED-EL** (`jobs.medel.com`): a single-page app on AWS Amplify; jobs come from a private
  GraphQL (AppSync) API with a key in its bundle, and every URL (sitemap included) returns
  the same shell. Not readable without that undocumented API.
- **Playtouch** (`playtouch.net/career`): the jobs are added by JavaScript (the linked
  `#qa-release-ops-…` job isn't in the page's HTML); no job system behind it.
- **Playrix** (`playrix.com/job/open/…`): the whole site is a JavaScript app. Every URL
  (even `robots.txt`) returns the same empty shell, with no job links or text; the jobs
  come from an undocumented internal API.
