"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js (the copy of Super Drive's worker: it stores nothing and only shows a short "No internet" page when a page cannot load;
 * its main job is to make Android offer the one-tap "Install app"). Whole-site scope, like the manifest's (the staff pages, the sign-in page and
 * the website all go through it, unchanged). Only in the live build: while building the app on a computer a worker would just get in the way.
 * A failure here is silent — the app works without it.
 */
export function StaffServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const go = () => {
      // the first version of this worker was registered for /staff only; the whole-site one replaces it
      navigator.serviceWorker
        .getRegistrations()
        .then((rs) => rs.filter((r) => new URL(r.scope).pathname === "/staff").forEach((r) => void r.unregister()))
        .catch(() => {});
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    };
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  }, []);
  return null;
}
