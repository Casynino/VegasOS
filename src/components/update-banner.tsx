"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const CURRENT = process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev";
const CHECK_EVERY_MS = 60_000;

export function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (CURRENT === "dev") return;
    let stop = false;
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { version } = (await res.json()) as { version?: string };
        if (!stop && version && version !== "dev" && version !== CURRENT) setReady(true);
      } catch {}
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => { stop = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  if (!ready) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-3 z-[100] flex justify-center px-4 print:hidden">
      <div className="flex items-center gap-3 rounded-full border border-border bg-card py-2 pl-4 pr-2 text-sm text-foreground shadow-lg">
        <span className="font-medium">A new update is up.</span>
        <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background">
          <RefreshCw className="size-3.5" />Refresh
        </button>
      </div>
    </div>
  );
}
