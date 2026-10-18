"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuiet } from "@/components/staff/quiet";

/** Keeps management's live view current: refreshes every minute while the page is visible. Never in a quiet session (a Developer's). */
export function LiveRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const quiet = useQuiet();
  useEffect(() => {
    if (quiet) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds, quiet]);
  return null;
}
