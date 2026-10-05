"use client";

import { useSyncExternalStore } from "react";

const FORMAT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" });

function subscribe(onTick: () => void) {
  const t = window.setInterval(onTick, 20_000);
  return () => window.clearInterval(t);
}

/** The hotel's local time (Dar es Salaam), kept current. `initial` is the server-rendered time. */
export function LocalTime({ initial, className }: { initial: string; className?: string }) {
  const time = useSyncExternalStore(subscribe, () => FORMAT.format(new Date()), () => initial);
  return <time className={className}>{time}</time>;
}
