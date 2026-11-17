# Headshot

An automated job search that runs itself. Headshot polls company job boards on a schedule, filters listings against your criteria, has Claude score the rest for fit, and emails you a daily digest. You review matches in a small dashboard: approve or skip with a reason, and the scorer learns from your decisions.

**Stack:** Next.js 16 on Vercel (dashboard) · Supabase (Postgres + auth) · GitHub Actions (scheduled worker) · Claude API (scoring) · Resend (email). Everything runs on free tiers except LLM usage.

## How it works

```
GitHub Actions (cron)
  ├─ hourly   worker watchlist  → poll watchlist companies → score → instant email alert
  └─ daily    worker full       → poll all companies → filter → score
              worker digest     → email: new matches · follow-ups due · status changes
                     │
                     ▼
              Supabase Postgres  ◀──  Next.js dashboard on Vercel
                                       Inbox · Pipeline · Criteria · Sources · Profile · Report
```

1. **Fetch.** Listings come from the public job-board APIs of Greenhouse, Lever and Ashby. These are official, unauthenticated endpoints, so there's no scraping to break.
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
| `SUPABASE_URL` | `SCORING_MODEL` (default `claude-opus-5-5`; `claude-haiku-5-5` is much cheaper) |
| `SUPABASE_SERVICE_ROLE_KEY` | `MAX_SCORE_PER_RUN` (default 60) |
| `ANTHROPIC_API_KEY` | `APP_URL` (your Vercel URL, linked from emails) |
| `RESEND_API_KEY` | `DIGEST_FROM` (needs a verified domain in Resend) |
| | `DIGEST_TO` (fallback recipient; normally set on the Criteria page) |

Then run **Actions → Daily search and digest → Run workflow** once to test.

## Costs

Hosting, database, cron and email all fit in free tiers. GitHub Actions minutes are unlimited for public repos. The only variable cost is LLM scoring, which you control with:
- **hard filters**: tighter filters mean fewer listings to score
- **`SCORING_MODEL`**: Haiku costs a fraction of Opus
- **`MAX_SCORE_PER_RUN`**: a hard cap on scoring calls per run

## Roadmap
- [ ] Tailored CV and cover-letter drafts for approved jobs
- [ ] Assisted apply: prefill forms from the profile and answer bank
- [ ] More sources: Workable, SmartRecruiters, aggregator APIs
