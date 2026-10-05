"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

/** The live theme is the html attribute itself, so every switch on the page (header, footer, menu) agrees. */
function readTheme(): Theme {
  return document.documentElement.dataset.pubTheme === "dark" ? "dark" : "light";
}
function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-pub-theme"] });
  return () => mo.disconnect();
}

/**
 * Visitor light/dark switch for the public website. The theme is applied before first paint
 * by THEME_SCRIPT in the root layout (src/app/layout.tsx): localStorage "vlh-theme", else the
 * device setting, written to html[data-pub-theme]. This button only flips it and remembers the
 * choice on this device. Sits on dark surfaces (header, menu, footer).
 *
 * compact: a round icon button (desktop header, footer). withLabel: the switch with its text (menu).
 */
export function ThemeToggle({ className, withLabel, compact }: { className?: string; withLabel?: boolean; compact?: boolean }) {
  // null on the server and during hydration (the attribute is only known in the browser).
  const theme = useSyncExternalStore<Theme | null>(subscribe, readTheme, () => null);

  function toggle() {
    const next: Theme = readTheme() === "dark" ? "light" : "dark";
    const apply = () => {
      document.documentElement.dataset.pubTheme = next;
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
  const label = dark ? "Switch to light mode" : "Switch to dark mode";

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-pressed={dark}
        title={dark ? "Light mode" : "Dark mode"}
        className={cn(
          "group relative inline-grid size-11 place-items-center rounded-full text-white/75 transition-colors duration-200 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
          className,
        )}
      >
        <Sun
          aria-hidden="true"
          strokeWidth={1.6}
          className={cn("col-start-1 row-start-1 size-[18px] transition-[opacity,rotate,scale] duration-300 ease-pub motion-reduce:transition-none", dark ? "rotate-0 scale-100 opacity-100" : "-rotate-45 scale-75 opacity-0")}
        />
        <Moon
          aria-hidden="true"
          strokeWidth={1.6}
          className={cn("col-start-1 row-start-1 size-[17px] transition-[opacity,rotate,scale] duration-300 ease-pub motion-reduce:transition-none", dark ? "rotate-45 scale-75 opacity-0" : "rotate-0 scale-100 opacity-100")}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={dark}
      title={dark ? "Light mode" : "Dark mode"}
      className={cn(
        "group relative inline-flex h-11 items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.05] px-1 text-white transition-colors duration-200 hover:border-gold/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
        withLabel ? "pr-4" : "",
        className,
      )}
    >
      <span className="relative grid h-8 w-14 grid-cols-2 place-items-center rounded-full bg-black/25">
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0.5 top-0.5 size-7 rounded-full bg-gold shadow-[0_0_14px_oklch(0.78_0.12_80/0.6)] transition-transform duration-300 ease-pub motion-reduce:transition-none",
            dark && "translate-x-6",
          )}
        />
        <Sun className={cn("relative size-3.5 transition-colors", dark ? "text-white/50" : "text-[#15120e]")} aria-hidden="true" />
        <Moon className={cn("relative size-3.5 transition-colors", dark ? "text-[#15120e]" : "text-white/50")} aria-hidden="true" />
      </span>
      {withLabel && <span className="text-[13px] text-white/80">{dark ? "Dark mode" : "Light mode"}</span>}
    </button>
  );
}
