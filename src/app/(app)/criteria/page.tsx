import { createClient } from "@/lib/supabase/server";
import { SCORING_MODELS, type Criteria } from "@/lib/types";
import { daysAgoIso } from "@/lib/time";
import { addExcludeKeyword, saveCriteria } from "../actions";

export default async function CriteriaPage() {
  const supabase = await createClient();
  const since = daysAgoIso(60);
  const [{ data: c, error }, { data: skips }] = await Promise.all([
    supabase.from("criteria").select("*").eq("id", 1).single(),
    supabase.from("feedback").select("reasons").eq("decision", "skip").gte("created_at", since),
  ]);
  if (error) throw new Error(error.message);
  const criteria = c as Criteria;

  const counts = new Map<string, number>();
  for (const s of skips ?? []) for (const r of s.reasons as string[]) counts.set(r, (counts.get(r) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
      <form action={saveCriteria} className="space-y-5">
        <div>
          <h1 className="h1">Criteria</h1>
          <p className="muted text-sm">
            Hard filters run first and cost nothing. Only listings that pass them are scored by the LLM. Separate list
            entries with commas or new lines. Changes apply to listings fetched from now on.
          </p>
        </div>

        <ListField name="roles" label="Target roles (title must contain one)" value={criteria.roles} placeholder="Frontend, Full-stack, React" />
        <ListField name="locations" label="Target locations (location must contain one)" value={criteria.locations} placeholder="Budapest, Hungary, Europe" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="remote_ok" defaultChecked={criteria.remote_ok} />
          Remote listings pass the location filter
        </label>
        <ListField name="include_keywords" label="Must-have keywords (description must contain one; empty = any)" value={criteria.include_keywords} placeholder="TypeScript, React" />
        <ListField name="exclude_keywords" label="Exclude keywords (whole words in the title)" value={criteria.exclude_keywords} placeholder="Senior Staff, Principal, PHP" />

        <label className="block space-y-1">
          <span className="label">Preferences for the scorer</span>
          <textarea
            name="preferences"
            defaultValue={criteria.preferences}
            rows={4}
            className="input"
            placeholder="E.g. I prefer product companies over agencies, small-to-mid teams, and want to grow towards full-stack."
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="label">Scoring model</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {SCORING_MODELS.map((m) => (
              <label key={m.id} className="card flex cursor-pointer gap-2 p-3 text-sm has-[:checked]:border-[var(--accent)]">
                <input type="radio" name="scoring_model" value={m.id} defaultChecked={criteria.scoring_model === m.id} className="mt-0.5" />
                <span>
                  <span className="block font-medium">{m.label}</span>
                  <span className="muted block text-xs">{m.note}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="muted text-xs">Used from the next worker run. Already-scored listings keep their score.</p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="label">Inbox score threshold (0–100)</span>
            <input name="score_threshold" type="number" min={0} max={100} defaultValue={criteria.score_threshold} className="input" />
          </label>
          <label className="block space-y-1">
            <span className="label">Follow up after (days)</span>
            <input name="followup_days" type="number" min={1} defaultValue={criteria.followup_days} className="input" />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="label">Send digest and alerts to</span>
          <input name="digest_email" type="email" defaultValue={criteria.digest_email} className="input" placeholder="you@example.com" />
          <span className="muted block text-xs">
            Until you verify a sending domain in Resend, it only delivers to your Resend account&apos;s email.
          </span>
        </label>

        <button className="btn-primary">Save criteria</button>
      </form>

      <aside className="space-y-3">
        <h2 className="font-medium">What your skips say</h2>
        <p className="muted text-sm">Skip reasons from the last 60 days. The scorer already sees them; turn frequent ones into hard filters to save cost.</p>
        {ranked.length === 0 ? (
          <p className="muted text-sm">No skips yet.</p>
        ) : (
          <ul className="card divide-y divide-[var(--border)] text-sm">
            {ranked.map(([reason, n]) => (
              <li key={reason} className="flex justify-between px-3 py-2">
                <span>{reason}</span>
                <span className="muted">{n}×</span>
              </li>
            ))}
          </ul>
        )}
        <form action={addExcludeKeyword} className="flex gap-2">
          <input name="keyword" placeholder="Add exclude keyword" className="input" />
          <button className="btn">Add</button>
        </form>
      </aside>
    </div>
  );
}

function ListField(props: { name: string; label: string; value: string[]; placeholder: string }) {
  return (
    <label className="block space-y-1">
      <span className="label">{props.label}</span>
      <textarea name={props.name} defaultValue={props.value.join(", ")} rows={2} className="input" placeholder={props.placeholder} />
    </label>
  );
}
