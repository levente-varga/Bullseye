import { createClient } from "@/lib/supabase/server";
import type { JobStatus, Run } from "@/lib/types";

const STATUSES: JobStatus[] = ["scored", "approved", "applied", "interview", "offer", "rejected", "skipped", "filtered", "closed"];

export default async function ReportPage() {
  const supabase = await createClient();
  const counts = await Promise.all(
    STATUSES.map(async (s) => {
      const { count } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", s);
      return [s, count ?? 0] as const;
    }),
  );
  const { data: runs, error } = await supabase.from("runs").select("*").order("started_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);

  const c = Object.fromEntries(counts) as Record<JobStatus, number>;
  const applied = c.applied + c.interview + c.offer + c.rejected;
  const responded = c.interview + c.offer;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="h1">Report</h1>
        <p className="muted text-sm">Where your search stands, and a log of every automated run.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Waiting in inbox" value={c.scored} />
        <Stat label="Applications" value={applied} />
        <Stat label="Interviews + offers" value={responded} />
        <Stat label="Response rate" value={applied ? `${Math.round((responded / applied) * 100)}%` : "—"} />
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Listings by status</h2>
        <div className="card grid grid-cols-3 divide-x divide-y divide-[var(--border)] text-sm sm:grid-cols-9 sm:divide-y-0">
          {counts.map(([s, n]) => (
            <div key={s} className="p-3">
              <div className="muted capitalize">{s}</div>
              <div className="text-lg font-semibold">{n}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Recent runs</h2>
        {(runs as Run[]).length === 0 ? (
          <p className="muted text-sm">No runs yet. The worker writes here every time it runs.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="muted border-b border-[var(--border)]">
                <tr>
                  <th className="p-3 font-medium">When</th>
                  <th className="p-3 font-medium">Kind</th>
                  <th className="p-3 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {(runs as Run[]).map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap p-3">{new Date(r.started_at).toLocaleString()}</td>
                    <td className="p-3">{r.kind}</td>
                    <td className="p-3">
                      {r.error ? (
                        <span className="text-red-600">{r.error}</span>
                      ) : !r.finished_at ? (
                        <span className="muted">running…</span>
                      ) : (
                        <span className="muted">
                          {Object.entries(r.stats)
                            .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
                            .join(" · ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card p-4">
      <div className="muted text-sm">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
