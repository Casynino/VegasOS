"use client";

import { useEffect } from "react";

/**
 * For tables marked `data-stack` (they become cards on phones): each cell gets its column's
 * heading as `data-label`, so the card can say "Amount 12,000". Keeps up as rows change.
 */
export function StackTableLabels() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    // A row React has taken over (hydrated) carries React's own key; a streamed row still waiting
    // for React must not be touched — changing it first is what causes a "hydration mismatch".
    const hydrated = (el: Element) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
    const label = () => {
      let waiting = false;
      for (const table of document.querySelectorAll<HTMLTableElement>("table[data-stack]")) {
        const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
        for (const tr of table.querySelectorAll("tbody tr, tfoot tr")) {
          if (!hydrated(tr)) { waiting = true; continue; }
          let col = 0;
          for (const cell of tr.children) {
            if (!cell.hasAttribute("data-label")) cell.setAttribute("data-label", heads[col] ?? "");
            // An empty "—" field is left out of the phone card.
            const text = cell.textContent?.trim() ?? "";
            const blank = (text === "" || text === "—") && !cell.querySelector("button, a, input, select, svg");
            if (blank !== cell.hasAttribute("data-blank")) cell.toggleAttribute("data-blank", blank);
            col += (cell as HTMLTableCellElement).colSpan || 1;
          }
        }
      }
      // Rows React has not taken over yet: look again shortly (hydrating changes nothing to observe).
      if (waiting && retries++ < 40) { clearTimeout(timer); timer = setTimeout(label, 250); }
    };
    // Only once the page has finished loading and React has taken over the streamed HTML —
    // labelling earlier changes the server's HTML under React ("hydration mismatch").
    const watch = new MutationObserver(() => { clearTimeout(timer); retries = 0; timer = setTimeout(label, 60); });
    const start = () => { timer = setTimeout(() => { label(); watch.observe(document.body, { childList: true, subtree: true }); }, 400); };
    if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
    return () => { window.removeEventListener("load", start); watch.disconnect(); clearTimeout(timer); };
  }, []);
  return null;
}
