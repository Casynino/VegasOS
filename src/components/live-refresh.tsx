"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuiet } from "@/components/staff/quiet";

/**
 * Keeps an open order page up to date (the kitchen moves it along) — stops when the order is finished. Never runs in a quiet session
 * (a Developer's): a page that refreshes itself would keep the Developer's 30-minute idle rule from ever ending the session.
 */
export function LiveRefresh({ every = 15, active }: { every?: number; active: boolean }) {
  const router = useRouter();
  const quiet = useQuiet();
  useEffect(() => {
    if (!active || quiet) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, every * 1000);
    return () => clearInterval(t);
  }, [active, quiet, every, router]);
  return null;
}
