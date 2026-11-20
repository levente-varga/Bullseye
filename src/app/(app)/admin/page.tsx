import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, PageHeader, Panel, Pill, SectionHeader } from "@/components/ui";
import { createClient, currentUser } from "@/lib/supabase/server";
import { formatUsd } from "@/lib/pricing";
import { agoText, nowMs } from "@/lib/time";
import type { Member, Settings } from "@/lib/types";
import { addCreditGrant, cancelInvite, inviteMember, removeMember, saveMemberDefaults, updateMemberCaps } from "../actions";

/** Admin only: invite friends, set their AI spend caps, remove them. */
export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const sp = await searchParams;
  const supabase = await createClient();
  const me = await currentUser(supabase);
  if (!me.isAdmin) notFound();

  const dayAgo = new Date(nowMs() - 86_400_000).toISOString();
  const [{ data: m }, { data: inv }, { data: shares }, { data: subs }, { data: st }, { data: bal }] = await Promise.all([
    supabase.from("members").select("*").order("created_at"),
    supabase.from("invites").select("*").order("invited_at", { ascending: false }),
    // Everyone's spend in the last 24 hours (admin sees all run shares).
    supabase.from("run_users").select("user_id, stats, runs!inner(started_at)").gte("runs.started_at", dayAgo),
    supabase.from("subscriptions").select("user_id"),
    supabase.from("settings").select("*").single(),
    // Each member's AI balance: granted here, minus their runs and other AI tasks.
    supabase.from("member_balances").select("user_id, granted_usd, spent_usd, balance_usd"),
  ]);
  const balanceOf = new Map(
    ((bal ?? []) as { user_id: string; granted_usd: number; spent_usd: number; balance_usd: number }[]).map((b) => [b.user_id, b]),
  );
  const settings = st as Settings;
  const members = (m ?? []) as Member[];
  const memberEmails = new Set(members.map((x) => x.email.toLowerCase()));
  // An invite is done once its person is a member and has signed in (or it failed).
  const invites = ((inv ?? []) as { email: string; invited_at: string; sent_at: string | null; error: string | null }[]).filter(
    (i) => !i.sent_at || i.error || !memberEmails.has(i.email.toLowerCase()),
  );
  const spent = new Map<string, number>();
  for (const s of shares ?? []) spent.set(s.user_id, (spent.get(s.user_id) ?? 0) + (Number(s.stats?.cost_usd) || 0));
  const followed = new Map<string, number>();
  for (const s of subs ?? []) followed.set(s.user_id, (followed.get(s.user_id) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Members"
        meta="Invite friends and set their AI spend caps. Everyone's data stays private."
      />

      <div className="space-y-10">
        <section>
          <SectionHeader title="Invite" />
          {typeof sp.invited === "string" && (
            <Notice key={crypto.randomUUID()} tone="ok" params={["invited", "error"]}>
              Invite queued for {sp.invited}. The email goes out with the next check, within about 15 minutes.
            </Notice>
          )}
          {typeof sp.error === "string" && (
            <Notice key={crypto.randomUUID()} tone="bad" params={["invited", "error"]}>
              {sp.error}
            </Notice>
          )}
          <form action={inviteMember} className="panel flex flex-wrap items-end gap-3 p-3">
            <label className="field min-w-0 flex-1">
              <span className="label">Email</span>
              <input name="email" type="email" required placeholder="friend@example.com" className="input" />
            </label>
            <SubmitButton className="btn-primary btn-field" done="Queued">
              Send invite
            </SubmitButton>
          </form>
          <p className="faint mt-2 text-[12px]">They get a link to set a password.</p>
          <form action={saveMemberDefaults} className="panel mt-3 flex flex-wrap items-end gap-3 p-3">
            <div className="w-full text-[13px]">
              Defaults for new members
              <span className="hint">Existing members keep theirs.</span>
            </div>
            <Money name="default_run_cost_usd" label="Per run" value={settings.default_run_cost_usd} />
            <Money name="default_daily_cost_usd" label="Per 24 hours" value={settings.default_daily_cost_usd} />
            <SubmitButton className="btn btn-field" done="Saved">Save defaults</SubmitButton>
          </form>
          {invites.length > 0 && (
            <Panel title="Pending invites" aside={String(invites.length)}>
              <ul className="divide">
                {invites.map((i) => (
                  <li key={i.email} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{i.email}</span>
                    {i.error ? (
                      <Pill tone="bad">Failed: {i.error}</Pill>
                    ) : i.sent_at ? (
                      <span className="faint text-[12px]">sent {agoText(i.sent_at)}, not accepted yet</span>
                    ) : (
                      <span className="faint text-[12px]">sending within ~15 min</span>
                    )}
                    <form action={inviteMember}>
                      <input type="hidden" name="email" value={i.email} />
                      <SubmitButton className="btn" done="Queued">Resend</SubmitButton>
                    </form>
                    <form action={cancelInvite}>
                      <input type="hidden" name="email" value={i.email} />
                      <SubmitButton className="btn">Cancel</SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </section>

        <section>
          <SectionHeader title="Members" count={members.length} />
          <Panel>
            {members.length === 0 ? (
              <Empty>No members yet.</Empty>
            ) : (
              <ul className="divide">
                {members.map((x) => (
                  <li key={x.user_id} className="space-y-3 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="font-medium">{x.email}</span>
                      {x.is_admin && <Pill tone="accent">Admin</Pill>}
                      <span className="faint text-[12px]">
                        joined {agoText(x.created_at)} · {followed.get(x.user_id) ?? 0} sources · spent{" "}
                        <span className="mono">{formatUsd(spent.get(x.user_id) ?? 0)}</span> in 24h
                      </span>
                      <Link href={x.user_id === me.id ? "/report" : `/report?member=${x.user_id}`} className="link ml-auto text-[12px]">
                        Report →
                      </Link>
                    </div>
                    {/* AI balance: members spend from credit granted here; the admin draws on the account. */}
                    {x.is_admin ? (
                      <p className="faint text-[12px]">Draws on the Anthropic account directly (Report → Credits).</p>
                    ) : (
                      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                        <div className="text-[13px]">
                          <span className="hint">Balance</span>
                          <span className={`mono text-[15px] ${Number(balanceOf.get(x.user_id)?.balance_usd ?? 0) <= 0 ? "text-[var(--bad)]" : ""}`}>
                            {formatUsd(Number(balanceOf.get(x.user_id)?.balance_usd ?? 0))}
                          </span>
                          <span className="faint text-[12px]">
                            {" "}
                            of <span className="mono">{formatUsd(Number(balanceOf.get(x.user_id)?.granted_usd ?? 0))}</span> granted ·{" "}
                            <span className="mono">{formatUsd(Number(balanceOf.get(x.user_id)?.spent_usd ?? 0))}</span> spent
                          </span>
                        </div>
                        <form action={addCreditGrant} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="user_id" value={x.user_id} />
                          <label className="field">
                            <span className="hint">Add credit ($, negative to take back)</span>
                            <input name="amount" type="number" step={0.01} required className="input mono w-28" placeholder="5.00" />
                          </label>
                          <label className="field">
                            <span className="hint">Note</span>
                            <input name="note" className="input w-44" placeholder="optional" />
                          </label>
                          <SubmitButton className="btn btn-field" done="Added">
                            Add
                          </SubmitButton>
                        </form>
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-3">
                      <form action={updateMemberCaps} className="flex flex-wrap items-end gap-3">
                        <input type="hidden" name="user_id" value={x.user_id} />
                        <Money name="max_run_cost_usd" label="Per run" value={x.max_run_cost_usd} />
                        <Money name="max_daily_cost_usd" label="Per 24 hours" value={x.max_daily_cost_usd} />
                        <SubmitButton className="btn btn-field" done="Saved">Save caps</SubmitButton>
                      </form>
                      {!x.is_admin && x.user_id !== me.id && (
                        <form action={removeMember} className="ml-auto flex flex-wrap items-center gap-2 text-[12px]">
                          <input type="hidden" name="user_id" value={x.user_id} />
                          <label className="muted flex items-center gap-1.5">
                            <input type="checkbox" name="confirm" />
                            Delete their account and data
                          </label>
                          <SubmitButton className="btn btn-danger">Remove</SubmitButton>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      </div>
    </>
  );
}

function Money(props: { name: string; label: string; value: number }) {
  return (
    <label className="field">
      <span className="hint">{props.label}</span>
      <span className="flex items-center gap-1.5">
        <span className="faint mono">$</span>
        <input name={props.name} type="number" min={0} step={0.01} defaultValue={props.value} className="input mono w-24" />
      </span>
    </label>
  );
}
