"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { buttonClass } from "../kit/button";

const FIELD = "input, textarea, select, [contenteditable='true']";

/**
 * Phones: the room page's slim floating "Book" dock — the room, its price and one slim
 * hairline button to the booking panel. It comes up once the hero (with its own Book button) is
 * scrolled away, and steps aside while the booking panel is on screen and while the guest
 * types, so it never covers the form. Marked data-pub-bottom-bar: the footer keeps room for it.
 */
export function RoomBookDock({ name, price, href, label = "Book" }: { name: string; price: string | null; href: string; label?: string }) {
  const t = useT();
  const [past, setPast] = useState(false);
  const [targetInView, setTargetInView] = useState(false);
  const [typing, setTyping] = useState(false);
  const hidden = !past || targetInView || typing;

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPast(window.scrollY > window.innerHeight * 0.5));
    };
    const target = href.startsWith("#") ? document.getElementById(href.slice(1)) : null;
    const io = target
      ? new IntersectionObserver(([entry]) => setTargetInView(entry.isIntersecting), { rootMargin: "0px 0px -15% 0px" })
      : null;
    if (target && io) io.observe(target);
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.matches(FIELD)) setTyping(true);
    };
    const onFocusOut = () => {
      // Focus may be moving to the next field: check once it has landed.
      setTimeout(() => setTyping(document.activeElement instanceof Element && document.activeElement.matches(FIELD)), 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [href]);

  const cls = buttonClass({ size: "sm", className: "shrink-0 gap-1.5 px-[1.125rem]" });
  const inner = (
    <>
      <span className="truncate">{t(label)}</span>
      <ArrowRight className="size-3.5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
    </>
  );

  return (
    <div
      data-pub-bottom-bar=""
      inert={hidden}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.625rem+env(safe-area-inset-bottom))] sm:hidden",
        "transition-[translate,opacity] duration-300 ease-pub motion-reduce:transition-none",
        hidden ? "pointer-events-none translate-y-[calc(100%+1rem)] opacity-0" : "translate-y-0 opacity-100",
      )}
    >
      <div data-glass="dock" className="pub-glass mx-auto flex max-w-md items-center gap-3 rounded-full py-1.5 pl-5 pr-1.5 text-white">
        <p className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-2 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-white/70">
            <span aria-hidden="true" className="h-px w-3 shrink-0 bg-gold/80" />
            <span className="truncate">{t(name)}</span>
          </span>
          {price && (
            <span className="mt-0.5 block truncate font-display text-[1.125rem] lining-nums tabular-nums text-gold">
              {price}
              <span className="font-sans text-[11px] text-white/55"> {t("/ night")}</span>
            </span>
          )}
        </p>
        {href.startsWith("/") ? (
          <Link href={href} className={cls}>
            {inner}
          </Link>
        ) : (
          <a href={href} className={cls}>
            {inner}
          </a>
        )}
      </div>
    </div>
  );
}
