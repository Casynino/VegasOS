"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keeps an open order page up to date (the kitchen moves it along) — stops when the order is finished. */
export function LiveRefresh({ every = 15, active }: { every?: number; active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, every * 1000);
    return () => clearInterval(t);
  }, [active, every, router]);
  return null;
}
