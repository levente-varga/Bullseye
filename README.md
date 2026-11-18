# Bullseye

An automated job search that runs itself. Bullseye polls company job boards on a schedule, filters listings against your criteria, has Claude score the rest for fit, and emails you a daily digest. You review matches in a small dashboard: approve or skip with a reason, and the scorer learns from your decisions.

**Stack:** Next.js 16 on Vercel (dashboard) · Supabase (Postgres + auth) · GitHub Actions (scheduled worker) · Claude API (scoring) · Resend (email). Everything runs on free tiers except LLM usage.

## How it works

```
Every 15 min (Supabase cron → GitHub Actions): worker tick → runs what the schedule (Criteria page) says is due
  ├─ watchlist (e.g. hourly)  → poll watched companies → score → instant email alert
  └─ daily (e.g. 07:00 local) → poll all companies → filter → score
              worker digest     → email: new matches · follow-ups due · status changes
                     │
                     ▼
              Supabase Postgres  ◀──  Next.js dashboard on Vercel
                                       Inbox · Pipeline · Criteria · Sources · Profile · Report
```

1. **Fetch.** Listings come from companies' own job boards through public endpoints: Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, Workable, Workday and Pinpoint APIs, and Teamtailor and Personio feeds. Two aggregators catch everything else: [Sweden Game Jobs](https://www.swedengamejobs.com) for games (descriptions are fetched from the original posting), and [JobTech](https://jobtechdev.se), the open API behind Sweden's public job board Platsbanken (by default the last 7 days of IT and design ads).
   - **Deduplication:** the same posting from two sources is stored once, keyed on the ATS job ID (or a cleaned-up URL). The company's own board wins. If it's added later, it adopts the aggregator's copy along with your decisions on it.
   - **Discovery:** companies seen on the aggregator are suggested as direct sources on the Sources page.
2. **Filter.** Cheap hard filters (role in the title, location or remote, excluded title words, must-have keywords) run first, at no cost.
3. **Score.** Listings that pass are scored 0–100 by Claude against your criteria, your CV and your **last 40 approve/skip decisions**. The skip reasons are the feedback loop.
4. **Review.** The Inbox shows matches above your threshold. Approve moves a listing to the Pipeline. Skip records why.
5. **Track.** The Pipeline goes To apply → Applied → Interview → Offer / Rejected, and flags follow-ups after N days.
6. **Report.** The daily digest email, plus a Report page with your funnel and a log of every run.

Your personal data (CV, profile, answers) lives only in the database. Nothing personal is committed to this repo.

## Setup

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
3. **Authentication → Users → Add user**: create your login (email + password, tick *Auto confirm*).
4. Allow that email to see the data. In the SQL Editor:
   ```sql
   insert into allowed_users (email) values ('you@example.com');
   ```
5. **Authentication → Sign In / Providers → turn off "Allow new users to sign up"**, so nobody else can register.
6. **Project Settings → API**: copy the URL, the `anon` key and the `service_role` key.

### 2. Local
```bash
cp .env.example .env.local   # fill in the values
npm install
npm run dev                  # http://localhost:3000
npm run worker -- full       # run a fetch + score locally
npm run worker -- digest     # send the digest locally
```

### 3. Vercel (dashboard)
Import the repo in Vercel and add **only** these env vars:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
The service-role and API keys never go to Vercel.

### 4. GitHub Actions (worker)
**Settings → Secrets and variables → Actions**

| Secrets | Variables (optional) |
|---|---|
| `SUPABASE_URL` | `SCORING_MODEL` (fallback only; the model is picked on the Criteria page, default Haiku 5.5) |
| `SUPABASE_SERVICE_ROLE_KEY` | `MAX_SCORE_PER_RUN` (default 60) |
| `ANTHROPIC_API_KEY` | `APP_URL` (your Vercel URL, linked from emails) |
| `RESEND_API_KEY` | `DIGEST_FROM` (e.g. `Bullseye <bullseye@jobs.example.com>`; needs a verified domain in Resend) |
| | `DIGEST_REPLY_TO` (a real inbox for replies) |
| | `DIGEST_TO` (fallback recipient; normally set on the Criteria page) |

Then run **Actions → Scheduler → Run workflow** with mode `daily` once to test. The schedule itself (daily time, watchlist interval, timezone) is set on the Criteria page.

### 5. Reliable heartbeat (Supabase cron)
GitHub's own cron is best-effort for public repos and can skip hours. Supabase starts the workflow every 15 minutes instead (migration `*_scheduler_cron.sql`, using `pg_cron` + `pg_net`):
1. Create a fine-grained GitHub token at [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new): this repository only, **Actions: Read and write**.
2. Supabase → **Project Settings → Vault** → add a secret named `github_dispatch_token` with the token.
3. Check: `select public.dispatch_scheduler();` starts a run; `select status_code from net._http_response order by created desc limit 1;` should be `204`.

When the token expires, runs stop: replace the Vault secret with a new token.

## Costs

Hosting, database, cron and email all fit in free tiers. GitHub Actions minutes are unlimited for public repos. The only variable cost is LLM scoring, which you control with:
- **hard filters**: tighter filters mean fewer listings to score
- **the scoring model** (Criteria page): Haiku 5.5 is the default and costs a fraction of Sonnet or Opus
- **`MAX_SCORE_PER_RUN`**: a hard cap on scoring calls per run

## Roadmap
- [ ] Tailored CV and cover-letter drafts for approved jobs
- [ ] Assisted apply: prefill forms from the profile and answer bank
- [ ] More sources: Varbi, ReachMee, Talentech (common in Sweden); JOIN (page data only). Checked and skipped for now: Homerun, Softgarden, BambooHR (no public data), Breezy (no real board to verify)
