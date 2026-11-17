import type { Job } from "./types";

/** Email rendering for the daily digest and watchlist alerts. Plain inline styles for email clients. */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const appUrl = () => (process.env.APP_URL || "").replace(/\/$/, "");

function jobRow(j: Job): string {
  const score = j.score != null ? `<strong>${j.score}</strong> · ` : "";
  return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">
    <a href="${esc(j.url)}" style="color:#111;font-weight:600;text-decoration:none">${esc(j.title)}</a><br>
    <span style="color:#555">${score}${esc(j.company)} · ${esc(j.location || "Location n/a")}${j.remote ? " · Remote" : ""}</span>
    ${j.score_summary ? `<div style="color:#333;margin-top:4px">${esc(j.score_summary)}</div>` : ""}
  </td></tr>`;
}

function section(title: string, jobs: Job[], empty: string): string {
  return `<h2 style="font-size:16px;margin:24px 0 4px">${esc(title)} (${jobs.length})</h2>
  ${jobs.length ? `<table style="width:100%;border-collapse:collapse">${jobs.map(jobRow).join("")}</table>` : `<p style="color:#777">${esc(empty)}</p>`}`;
}

function wrap(body: string): string {
  const link = appUrl()
    ? `<p style="margin-top:24px"><a href="${esc(appUrl())}" style="color:#2563eb">Open Headshot →</a></p>`
    : "";
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#111">${body}${link}</div>`;
}

export function renderDigest(args: {
  newMatches: Job[];
  followUps: Job[];
  statusChanges: Job[];
}): { subject: string; html: string } {
  const { newMatches, followUps, statusChanges } = args;
  const top = newMatches[0]?.score;
  const subject =
    `Headshot: ${newMatches.length} new match${newMatches.length === 1 ? "" : "es"}` +
    (top != null ? `, top ${top}` : "") +
    (followUps.length ? ` · ${followUps.length} follow-up${followUps.length === 1 ? "" : "s"} due` : "");
  const html = wrap(`
    <h1 style="font-size:20px">Your daily job digest</h1>
    ${section("New matches", newMatches, "Nothing new above your threshold today.")}
    ${section("Follow-ups due", followUps, "No follow-ups due.")}
    ${section("Status changes (last 24h)", statusChanges, "No changes.")}
  `);
  return { subject, html };
}

export function renderWatchlistAlert(jobs: Job[]): { subject: string; html: string } {
  const companies = [...new Set(jobs.map((j) => j.company))].join(", ");
  return {
    subject: `Headshot alert: new posting at ${companies}`,
    html: wrap(`<h1 style="font-size:20px">New on your watchlist</h1>${section("Matches", jobs, "")}`),
  };
}

/** Sends to `to` (from the dashboard setting), falling back to the DIGEST_TO env var. */
export async function sendEmail(subject: string, html: string, to?: string): Promise<void> {
  const { Resend } = await import("resend");
  to = to?.trim() || process.env.DIGEST_TO;
  if (!process.env.RESEND_API_KEY || !to) {
    console.warn("RESEND_API_KEY or a recipient (dashboard setting / DIGEST_TO) not set; skipping email:", subject);
    return;
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.DIGEST_FROM || "Headshot <onboarding@resend.dev>",
    // Replies go to a real inbox, since the sending subdomain can't receive mail.
    ...(process.env.DIGEST_REPLY_TO ? { replyTo: process.env.DIGEST_REPLY_TO } : {}),
    to,
    subject,
    html,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}
