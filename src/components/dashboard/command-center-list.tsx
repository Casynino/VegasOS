"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keeps management's live view current: refreshes every minute while the page is visible. */
export function LiveRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
