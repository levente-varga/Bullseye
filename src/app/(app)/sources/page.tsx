import { createClient } from "@/lib/supabase/server";
import { ATS_BOARD_URL } from "@/lib/ats";
import type { Source } from "@/lib/types";
import { addSource, deleteSource, updateSource } from "../actions";

export default async function SourcesPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("sources").select("*").order("company_name");
  if (error) throw new Error(error.message);
  const sources = data as Source[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">Sources</h1>
        <p className="muted text-sm">
          Company job boards on Greenhouse, Lever or Ashby. Find the board by opening a company&apos;s careers page: the
          URL looks like <code>job-boards.greenhouse.io/<b>slug</b></code>, <code>jobs.lever.co/<b>slug</b></code> or{" "}
          <code>jobs.ashbyhq.com/<b>slug</b></code>. Watchlist companies are checked hourly and trigger an instant email.
        </p>
      </div>

      <form action={addSource} className="card grid gap-3 p-4 sm:grid-cols-[140px_1fr_1fr_auto_auto] sm:items-end">
        <label className="block space-y-1">
          <span className="label">ATS</span>
          <select name="ats" className="input">
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="ashby">Ashby</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="label">Board slug or URL</span>
          <input name="slug" required className="input" placeholder="e.g. vercel" />
        </label>
        <label className="block space-y-1">
          <span className="label">Company name</span>
          <input name="company_name" className="input" placeholder="Vercel" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="watchlist" /> Watchlist
        </label>
        <button className="btn-primary">Add</button>
      </form>

      {sources.length === 0 ? (
        <p className="muted text-sm">No sources yet.</p>
      ) : (
        <ul className="card divide-y divide-[var(--border)]">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <a href={ATS_BOARD_URL[s.ats](s.slug)} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                  {s.company_name}
                </a>
                <p className="muted text-sm">
                  {s.ats} · {s.slug} · {s.last_checked_at ? `checked ${new Date(s.last_checked_at).toLocaleString()}` : "never checked"}
                  {!s.enabled && " · paused"}
                </p>
                {s.last_error && <p className="text-sm text-red-600">Last error: {s.last_error}</p>}
              </div>
              <Toggle id={s.id} field="watchlist" on={s.watchlist} onLabel="★ Watchlist" offLabel="☆ Watch" />
              <Toggle id={s.id} field="enabled" on={s.enabled} onLabel="Pause" offLabel="Resume" />
              <form action={deleteSource}>
                <input type="hidden" name="id" value={s.id} />
                <button className="btn text-red-600">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Toggle(props: { id: string; field: string; on: boolean; onLabel: string; offLabel: string }) {
  return (
    <form action={updateSource}>
      <input type="hidden" name="id" value={props.id} />
      <input type="hidden" name="field" value={props.field} />
      <input type="hidden" name="value" value={String(!props.on)} />
      <button className="btn">{props.on ? props.onLabel : props.offLabel}</button>
    </form>
  );
}
