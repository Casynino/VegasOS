"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Phone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { telHref } from "./contact";

/**
 * Routes with their own primary action or fixed bar: the booking flow, room pages (their own
 * CTA), the menu (basket), meeting room and transport (their own forms) and private links.
 */
const HIDDEN_ON = [
  /^\/book(\/|$)/,
  /^\/booking\//,
  /^\/rooms\/[^/]+$/,
  /^\/menu(\/|$)/,
  /^\/meeting-room(\/|$)/,
  /^\/transport(\/|$)/,
  /^\/verify\//,
];
const DISMISSED_KEY = "vlh-bookbar-hidden";
const FIELD = "input, textarea, select, [contenteditable='true']";

function readDismissed() {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Phones only: a slim floating "Book your stay" dock. It appears once the visitor is past the
 * first screen, steps aside while they type (keyboard up), near the footer (which has its own
 * Book button) and on pages that render their own bottom bar ([data-pub-bottom-bar]), and can be
 * dismissed for the session. While it is up, the header's small Book button hides
 * (html[data-pub-bar="on"]) so only one Book is on screen. It never needs a layout spacer.
 */
export function MobileBookBar({ phone }: { phone: string | null }) {
  const pathname = usePathname();
  const hiddenRoute = HIDDEN_ON.some((r) => r.test(pathname));
  const [on, setOn] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const visible = on && !hiddenRoute && !dismissed;

  useEffect(() => {
    if (hiddenRoute || dismissed || readDismissed()) return;
    let typing = false;
    let nearFooter = false;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const past = window.scrollY > window.innerHeight * 0.6;
        const ownBar = document.querySelector("[data-pub-bottom-bar]") !== null;
        setOn(past && !typing && !nearFooter && !ownBar);
      });
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.matches(FIELD)) {
        typing = true;
        update();
      }
    };
    const onFocusOut = () => {
      // Focus may be moving to the next field: check once it has landed.
      setTimeout(() => {
        typing = document.activeElement instanceof Element && document.activeElement.matches(FIELD);
        update();
      }, 0);
    };
    const footer = document.getElementById("site-footer");
    const io = footer
      ? new IntersectionObserver(([entry]) => {
          nearFooter = entry.isIntersecting;
          update();
        })
      : null;
    if (footer && io) io.observe(footer);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    update();
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [hiddenRoute, dismissed, pathname]);

  // Tell the header (one Book button on screen at a time).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.pubBar = visible ? "on" : "off";
    return () => {
      delete root.dataset.pubBar;
    };
  }, [visible]);

  if (hiddenRoute) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {}
  }

  const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";
  return (
    <div
      inert={!visible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.625rem+env(safe-area-inset-bottom))] sm:hidden",
        "transition-[translate,opacity] duration-300 ease-pub motion-reduce:transition-none",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-[calc(100%+1rem)] opacity-0",
      )}
    >
      <div className="mx-auto flex max-w-md items-center gap-1 rounded-full border border-white/10 bg-[#120f0b]/90 p-1.5 shadow-[0_18px_44px_-14px_rgb(0_0_0/0.7)] backdrop-blur-lg">
        {phone && (
          <a href={telHref(phone)} className={cn("grid size-11 shrink-0 place-items-center rounded-full text-white/80 transition-colors hover:text-white", focus)}>
            <Phone className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
            <span className="sr-only">Call the hotel</span>
          </a>
        )}
        <Link
          href="/book"
          className={cn(
            "flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-gold px-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#16110a] transition-[background-color,scale] duration-200 active:scale-[0.98] motion-reduce:transition-none",
            focus,
          )}
        >
          <span className="truncate">Book your stay</span>
          <ArrowRight className="size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
        </Link>
        <button type="button" onClick={dismiss} className={cn("grid size-11 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:text-white", focus)}>
          <X className="size-4" strokeWidth={1.6} aria-hidden="true" />
          <span className="sr-only">Hide the booking bar</span>
        </button>
      </div>
    </div>
  );
}
