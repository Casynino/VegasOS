"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/i18n/client";

function subscribe(onTick: () => void) {
  const t = window.setInterval(onTick, 20_000);
  return () => window.clearInterval(t);
}

/** The hotel's local time (Dar es Salaam), kept current. `initial` is the server-rendered time. */
export function LocalTime({ initial, className }: { initial: string; className?: string }) {
  const t = useT();
  // "09:02" (24 h) in the hotel's time zone, in the visitor's language.
  const time = useSyncExternalStore(subscribe, () => t.time(new Date(), "Africa/Dar_es_Salaam"), () => initial);
  return <time className={className}>{time}</time>;
}
