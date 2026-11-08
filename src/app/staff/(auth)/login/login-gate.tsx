"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * On a phone the sign-in form does not cover the picture (owner, 2026-11-09): the page shows the welcome and ONE small "Sign in" button,
 * and the button opens the form as a small pop-up (Escape, the X or a tap outside closes it). From a tablet up the card simply stays on
 * the page (`md:contents` makes this wrapper disappear there). The form stays on the page, only hidden, so a wrong password keeps its
 * message and the browser's saved logins still find the fields.
 */
export function LoginGate({ intro, openLabel, closeLabel, children }: { intro: ReactNode; openLabel: string; closeLabel: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // a phone turned into a wide screen shows the card on the page: nothing to close any more
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => { if (wide.matches) setOpen(false); };
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    const button = opener.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      document.body.style.overflow = before;
      button?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <>
      <div className="flex flex-col items-center text-center md:hidden">
        {intro}
        <button
          ref={opener}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="vg-up mt-7 inline-flex h-11 items-center gap-2 rounded-full bg-gold px-7 text-[15px] font-semibold text-gold-foreground shadow-[0_10px_30px_-10px_rgba(226,186,110,0.55)] transition-[filter,transform] hover:brightness-105 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          style={{ "--rd": "0.55s" } as CSSProperties}
        >
          {openLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div
        className={cn(
          "md:contents",
          open ? "max-md:fixed max-md:inset-0 max-md:z-50 max-md:flex max-md:items-start max-md:justify-center max-md:overflow-y-auto max-md:bg-[#050403]/70 max-md:p-4 max-md:pt-[12svh] max-md:backdrop-blur-[4px]" : "max-md:hidden",
        )}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      >
        <div
          ref={panel}
          tabIndex={open ? -1 : undefined}
          role={open ? "dialog" : undefined}
          aria-modal={open ? true : undefined}
          aria-label={open ? openLabel : undefined}
          className={cn("vg-panel relative mx-auto w-full max-w-[26rem] outline-none", open && "vg-panel-open")}
        >
          {children}
          {open && (
            <button type="button" onClick={() => setOpen(false)} aria-label={closeLabel} className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-gold md:hidden">
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
