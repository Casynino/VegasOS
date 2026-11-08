"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/**
 * THE WAY BACK, on a phone and a tablet (owner, 2026-11-08, as in his Target console). An iPhone home-screen app, an in-app browser or a
 * freshly opened link has no back button — an app that can only be left by signing out is not navigable. So the top bar carries its own:
 * on every page that is not a department's home it shows "‹ Back"; on a home it shows what it always showed (the date: `children`).
 *
 * WHERE IT GOES. The app keeps its own small trail of where this tab has been (sessionStorage — per tab, never shared): Back returns to the page
 * before this one, so a bill opened from a booking opened from the list unwinds the way it was walked. With no trail (a fresh open from a link
 * or a QR) it climbs one level up the address — and never above the department's home. Opening a home starts a new trail.
 */
const KEY = "vlh.nav.trail";
const MAX = 8;

/** The trail is kept with the person it belongs to: somebody else signing in on the same tab starts a new one. */
function read(owner: string): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    if (!v || v.o !== owner || !Array.isArray(v.t)) return [];
    return v.t.filter((x: unknown): x is string => typeof x === "string");
  } catch { return []; }
}
function write(owner: string, trail: string[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ o: owner, t: trail.slice(-MAX) })); } catch { /* a convenience only: Back still climbs by the address */ }
}

/** One level up the address (/staff/reservations/abc → /staff/reservations); a first-level page goes home. */
function parentOf(path: string, home: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length < 2 ? home : `/${parts.join("/")}`;
}

export function MobileBack({ home, roots, owner, label, children }: { home: string; roots: string[]; /** Who is signed in (their id): the trail belongs to them. */ owner: string; label: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isRoot = roots.includes(pathname);

  useEffect(() => {
    if (isRoot) { write(owner, [pathname]); return; }
    const trail = read(owner);
    const at = trail.lastIndexOf(pathname); // walking back the way you came does not grow the trail
    write(owner, at >= 0 ? trail.slice(0, at + 1) : [...trail, pathname]);
  }, [pathname, isRoot, owner]);

  if (isRoot) return <>{children}</>;

  const back = () => {
    const trail = read(owner);
    const here = trail.lastIndexOf(pathname);
    const previous = here > 0 ? trail[here - 1] : undefined;
    if (previous) { write(owner, trail.slice(0, here)); router.push(previous); }
    else router.push(parentOf(pathname, home));
  };

  return (
    <button type="button" onClick={back}
      className="-ml-1 inline-flex h-10 min-w-0 items-center gap-1 rounded-full pl-1.5 pr-3 text-sm font-semibold text-foreground/90 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.12_80)]/60">
      <ChevronLeft className="size-5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}
