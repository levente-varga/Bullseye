"use client";

import { useEffect, useState } from "react";

/** Timezone picker with a one-click "use this browser's timezone". */
export function TimezoneSelect({ name, value, options }: { name: string; value: string; options: string[] }) {
  const [tz, setTz] = useState(value);
  const [browserTz, setBrowserTz] = useState<string | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration
      setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {}
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select name={name} value={tz} onChange={(e) => setTz(e.target.value)} className="input w-full max-w-[20rem]">
        {(options.includes(tz) ? options : [tz, ...options]).map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      {browserTz && browserTz !== tz && (
        <button type="button" onClick={() => setTz(browserTz)} className="btn-ghost text-[12px]">
          Use {browserTz.replace(/_/g, " ")}
        </button>
      )}
    </div>
  );
}
