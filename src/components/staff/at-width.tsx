"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * Draws its children only on a computer-width screen (`wide`, lg and up) or only on a phone / tablet (`!wide`) — and mounts them only
 * there. For a part that must exist ONCE even though the page has two places for it (the bell: in the top bar of a phone, in the
 * side menu of a computer): hiding one with CSS would still run its polling and ring its sound twice. Before the browser has said which
 * screen it is (the server's drawing) the phone's one is drawn.
 */
const QUERY = "(min-width: 1024px)";
const subscribe = (notify: () => void) => {
  const m = window.matchMedia(QUERY);
  m.addEventListener("change", notify);
  return () => m.removeEventListener("change", notify);
};

export function AtWidth({ wide, children }: { wide: boolean; children: ReactNode }) {
  const isWide = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  return isWide === wide ? <>{children}</> : null;
}
