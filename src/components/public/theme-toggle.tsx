"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

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
  const t = useT();
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
      const vt = doc.startViewTransition(apply);
      // A rapid second click aborts the first transition — harmless, so swallow it.
      vt.ready.catch(() => {});
      vt.finished.catch(() => {});
    } else apply();
  }

  const dark = theme === "dark";
  const label = dark ? t("Switch to light mode") : t("Switch to dark mode");

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-pressed={dark}
        title={dark ? t("Light mode") : t("Dark mode")}
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

  // withLabel (the phone menu): the icon and its word, nothing around them (owner, 2026-10-06: no shapes).
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={dark}
      title={dark ? t("Light mode") : t("Dark mode")}
      className={cn(
        "group inline-flex min-h-11 items-center gap-2.5 rounded-sm text-[14px] text-white/75 transition-colors duration-200 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
        className,
      )}
    >
      {dark
        ? <Moon className="size-4 text-gold" strokeWidth={1.6} aria-hidden="true" />
        : <Sun className="size-4 text-gold" strokeWidth={1.6} aria-hidden="true" />}
      {withLabel && <span>{dark ? t("Dark mode") : t("Light mode")}</span>}
    </button>
  );
}
