"use client";

import { useEffect, useState } from "react";

/**
 * The fixed site header. Transparent over the hero photo at the top of the page (a soft scrim
 * keeps it legible), smoked glass with a gold hairline once the visitor scrolls, plus a fine gold
 * reading-progress line (CSS scroll timeline, no JS) — styles in globals.css (.pub-header).
 *
 * Contract for pages: the header overlays the page and takes no space. Its height at the top
 * is var(--pub-header-h) (4rem phones/tablets, 5rem from 1024px) and 4rem once scrolled, so
 * sticky bars below it use top-16. Being fixed, the shrink never shifts the page.
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
      className="pub-header group/hdr fixed inset-x-0 top-0 z-40 text-white"
    >
      {children}
      <span aria-hidden="true" className="pub-header__progress" />
    </header>
  );
}
