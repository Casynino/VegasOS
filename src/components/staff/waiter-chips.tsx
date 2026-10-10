"use client";

import { useEffect, useState } from "react";
import { Initials } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { colleaguesAction } from "@/app/staff/(app)/restaurant/waiter-actions";
import { useIsRestaurantDevice } from "./waiter-pin";
import { useT } from "@/i18n/client";

type Waiter = { id: string; name: string; number?: string | null; onShiftSince: string | null };
const first = (n: string) => n.replace(/\s*\(.*\)/, "").trim().split(/\s+/)[0];

/**
 * On the shared Restaurant Counter: "who serves it?" as a row of chips — the waiters on shift (only they
 * take work). Tap one to choose, tap again to clear. Off the Counter: nothing.
 */
export function WaiterChips({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useT();
  const device = useIsRestaurantDevice();
  const [waiters, setWaiters] = useState<Waiter[] | null>(null);

  // Loaded now and again whenever the screen comes back into view (shifts start and end during the day).
  useEffect(() => {
    if (!device) return;
    let live = true;
    const load = () => colleaguesAction().then((r) => { if (live && r.ok) setWaiters(r.data); });
    void load();
    const again = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    const timer = setInterval(again, 60_000);
    return () => { live = false; window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); clearInterval(timer); };
  }, [device]);

  if (!device) return null;
  // Only the waiters on shift take work.
  const list = waiters?.filter((w) => w.onShiftSince) ?? [];
  if (!waiters) return <p className="text-xs text-muted-foreground">{t("Loading the waiters…")}</p>;
  if (!list.length) return <p className="text-xs text-muted-foreground">{waiters.length ? t("No waiter is on shift — a waiter taps “Start my shift” on their phone.") : t("No waiters yet — the MD adds them in Staff & roles.")}</p>;
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Who serves it")}>
      {list.map((w) => {
        const on = value === w.id;
        return (
          <button key={w.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? "" : w.id)} title={w.number ? `${w.name} · ${w.number}` : w.name}
            className={cn("inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition",
              on ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.72_0.12_80/0.16)] text-foreground" : "border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <span className="relative">
              <Initials name={w.name} className="size-6 text-[9px]" />
              {w.onShiftSince && <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-card" aria-label={t("On shift")} />}
            </span>
            {first(w.name)}
            {w.number && <span className="font-mono text-[10px] text-muted-foreground">{w.number}</span>}
          </button>
        );
      })}
    </div>
  );
}
