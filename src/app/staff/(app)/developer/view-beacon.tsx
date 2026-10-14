"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isLoggedPath } from "@/lib/developer-paths";
import { recordDeveloperView } from "./actions";

/**
 * Draws nothing. Rendered by the staff layout for a Developer only: when they move to another page without a full reload (the
 * layout is not drawn again on such a move) it asks the server to note the visit. The server decides everything — who it is,
 * which page, whether it is a repeat — so this only saves it a call for the few harmless pages that are never written.
 */
export function DeveloperViewBeacon() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    // The page the server just sent was noted by the layout itself.
    if (first.current) { first.current = false; return; }
    if (isLoggedPath(pathname)) void recordDeveloperView().catch(() => undefined);
  }, [pathname]);
  return null;
}
