"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Phone Back closes an open overlay (the booking sheet, the photo viewer) instead of leaving the
 * page. `opened()` — call it when the overlay opens — adds one same-URL history entry; Back pops
 * it and runs `close`. `closed()` — call it from the overlay's close event — steps back over that
 * entry when the overlay was closed its own way (X, Escape, a tap outside). Next.js copies its
 * router state into the entry, so its own Back handling is unaffected.
 */
export function useBackToClose(close: () => void) {
  const entry = useRef<string | null>(null);
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    const onPop = () => {
      const key = entry.current;
      if (key && (window.history.state as { vlhOverlay?: string } | null)?.vlhOverlay !== key) {
        entry.current = null;
        closeRef.current();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const opened = useCallback(() => {
    if (entry.current) return;
    const key = Math.random().toString(36).slice(2);
    entry.current = key;
    window.history.pushState({ vlhOverlay: key }, "");
  }, []);

  const closed = useCallback(() => {
    const key = entry.current;
    entry.current = null;
    if (key && (window.history.state as { vlhOverlay?: string } | null)?.vlhOverlay === key) window.history.back();
  }, []);

  return { opened, closed };
}
