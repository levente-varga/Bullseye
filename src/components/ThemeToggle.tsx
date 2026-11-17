"use client";

import { useEffect, useState } from "react";
import { IconMonitor, IconMoon, IconSun } from "./icons";

type Theme = "light" | "dark" | "system";

/** Light / dark / system switch. The choice is per browser (localStorage). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from storage after hydration
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {}
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {}
  }

  const options: { value: Theme; label: string; Icon: typeof IconSun }[] = [
    { value: "light", label: "Light theme", Icon: IconSun },
    { value: "dark", label: "Dark theme", Icon: IconMoon },
    { value: "system", label: "Follow system theme", Icon: IconMonitor },
  ];

  return (
    <div className="inline-flex border border-[var(--border)]" role="group" aria-label="Theme">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => apply(value)}
          className={`flex h-6 w-7 items-center justify-center ${
            theme === value ? "bg-[var(--surface-2)] text-[var(--fg)]" : "text-[var(--faint)] hover:text-[var(--fg)]"
          }`}
        >
          <Icon width={13} height={13} />
        </button>
      ))}
    </div>
  );
}
