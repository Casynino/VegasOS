"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js for the staff app (the pass-through worker that lets Android offer the one-tap "Install app"). Only in the live
 * build: while building the app on a computer a worker would just get in the way. A failure here is silent — the app works without it.
 */
export function StaffServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/staff" }).catch(() => {});
  }, []);
  return null;
}
