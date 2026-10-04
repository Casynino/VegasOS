"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

/**
 * Visitor light/dark switch for the public website. The theme is applied
 * before first paint by a tiny script in the public layout; this button only
 * flips it and remembers the choice on this device.
 */
export function ThemeToggle({ className, withLabel }: { className?: string; withLabel?: boolean }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.dataset.pubTheme === "dark" ? "dark" : "light"); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const apply = () => {
      document.documentElement.dataset.pubTheme = next;
      setTheme(next);
    };
    try { localStorage.setItem("vlh-theme", next); } catch {}
    // Cross-fade the whole page where supported.
    type VT = { ready: Promise<void>; finished: Promise<void> };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => VT };
    if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const t = doc.startViewTransition(apply);
      // A rapid second click aborts the first transition — harmless, so swallow it.
      t.ready.catch(() => {});
      t.finished.catch(() => {});
    } else apply();
  }

  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      title={dark ? "Light mode" : "Dark mode"}
      className={cn(
        "group relative inline-flex h-10 items-center gap-2 rounded-full border border-white/20 bg-white/[0.07] px-1 text-white backdrop-blur-md transition-colors hover:border-gold/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
        withLabel ? "pr-4" : "",
        className,
      )}
    >
      <span className="relative grid h-8 w-14 grid-cols-2 place-items-center rounded-full bg-black/25">
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0.5 top-0.5 size-7 rounded-full bg-gold shadow-[0_0_16px_oklch(0.78_0.12_80/0.8)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            dark && "translate-x-6",
          )}
        />
        <Sun className={cn("relative size-3.5 transition-colors", dark ? "text-white/50" : "text-[#15120e]")} aria-hidden="true" />
        <Moon className={cn("relative size-3.5 transition-colors", dark ? "text-[#15120e]" : "text-white/50")} aria-hidden="true" />
      </span>
      {withLabel && <span className="text-sm">{dark ? "Dark mode" : "Light mode"}</span>}
    </button>
  );
}
