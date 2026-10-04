"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Transparent over the hero photo at the top of the page (like a magazine
 * cover), turning into a compact smoked-glass bar once the visitor scrolls.
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      style={{ viewTransitionName: "site-header" }}
      data-scrolled={scrolled}
      className={cn(
        "group/hdr sticky top-0 z-40 -mb-18 text-white transition-[background-color,box-shadow,border-color,backdrop-filter] duration-500 lg:-mb-20 motion-reduce:transition-none",
        scrolled
          ? "border-b border-white/10 bg-[#0d0b08] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)] backdrop-blur-2xl backdrop-saturate-150"
          : "border-b border-transparent bg-linear-to-b from-[#0d0b08]/70 to-transparent backdrop-blur-0",
      )}
    >
      {children}
    </header>
  );
}
