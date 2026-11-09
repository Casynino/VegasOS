"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { InstallButton } from "@/components/staff/install-app";

/**
 * On a phone the sign-in form does not cover the picture (owner, 2026-11-09): the page shows the welcome and ONE small "Sign in" button,
 * and the button opens the form as a small pop-up (Escape, the X or a tap outside closes it). "Phone" here means a narrow screen OR a short
 * screen turned sideways (a phone in landscape cannot hold the whole card); a tablet or computer keeps the card on the page. The rules for
 * which is which live in login.css (.vg-intro, .vg-card-wrap, .vg-close). The form stays on the page, only hidden, so a wrong password keeps
 * its message and the browser's saved logins still find the fields.
 */
const WIDE = "(min-width: 768px) and (min-height: 521px), (min-width: 768px) and (orientation: portrait)";

export function LoginGate({ intro, openLabel, closeLabel, children }: { intro: ReactNode; openLabel: string; closeLabel: string; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    // a phone turned into a wide screen shows the card on the page: nothing to close any more
    const wide = window.matchMedia(WIDE);
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
      <div className="vg-intro">
        {intro}
        <button
          ref={opener}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="vg-up vg-intro-btn inline-flex h-11 items-center gap-2 rounded-full bg-gold px-7 text-[15px] font-semibold text-gold-foreground shadow-[0_10px_30px_-10px_rgba(226,186,110,0.55)] transition-[filter,transform] hover:brightness-105 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          style={{ "--rd": "0.55s" } as CSSProperties}
        >
          {openLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
        {/* A browser tab always keeps its bars; the home-screen app is full screen. Only phones that have not installed it see this link. */}
        <InstallButton
          render={(openSheet) => (
            <button type="button" onClick={openSheet} className="vg-up vg-intro-install mt-4 inline-flex items-center gap-1.5 text-[13px] text-white/60 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold" style={{ "--rd": "0.7s" } as CSSProperties}>
              <Smartphone className="size-3.5" aria-hidden="true" />
              {t("Get the full-screen app")}
            </button>
          )}
        />
      </div>

      <div
        className={cn("vg-card-wrap", open && "is-open")}
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
          {/* the wide layout (tablet, computer with touch): the same help link, quietly, under the card */}
          <InstallButton
            render={(openSheet) => (
              <div className="vg-install-wide mt-4 text-center">
                <button type="button" onClick={openSheet} className="inline-flex min-h-10 items-center gap-1.5 text-[13px] text-white/60 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
                  <Smartphone className="size-3.5" aria-hidden="true" />
                  {t("Get the full-screen app")}
                </button>
              </div>
            )}
          />
          {open && (
            <button type="button" onClick={() => setOpen(false)} aria-label={closeLabel} className="vg-close absolute right-2 top-2 z-10 size-10 rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-gold">
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
