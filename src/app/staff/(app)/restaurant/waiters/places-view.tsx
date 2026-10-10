import Link from "next/link";
import { Armchair, BedDouble, MapPin, ShoppingBag, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import type { PlaceKind, PlaceServed } from "@/server/services/waiter-performance";
import { GOLD } from "./parts";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";

const GROUPS: { kind: PlaceKind; title: string; icon: typeof Armchair; tone: string }[] = [
  { kind: "TABLE", title: msg("Tables"), icon: Armchair, tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  { kind: "ROOM", title: msg("Rooms (room service)"), icon: BedDouble, tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  { kind: "COUNTER", title: msg("Counter & restaurant"), icon: Store, tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  { kind: "OTHER", title: msg("Take out & other"), icon: ShoppingBag, tone: "bg-muted text-muted-foreground" },
];

/**
 * Every table, room and counter with orders in the period — and who served it: each waiter with
 * their orders and value there. The value is the served orders'; cancelled orders are counted apart.
 */
export async function PlacesView({ places, href, multiDay }: { places: PlaceServed[]; href: (id: string) => string; multiDay: boolean }) {
  const t = await getT();
  if (!places.length) {
    return (
      <div className="grid place-items-center gap-2 rounded-3xl border border-dashed border-border/70 px-6 py-16 text-center text-sm text-muted-foreground">
        <MapPin className="size-7 opacity-50" />{t("No orders in this period — no table or room was served.")}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {GROUPS.map((g) => {
        const list = places.filter((p) => p.kind === g.kind);
        if (!list.length) return null;
        return (
          <section key={g.kind}>
            <h2 className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className={cn("grid size-5 place-items-center rounded-md [&_svg]:size-3", g.tone)}><g.icon /></span>{t(g.title)}</span>
              <span className="tracking-normal tabular-nums">{g.kind === "ROOM" ? t.plural(list.length, "{n} room", "{n} rooms") : t.plural(list.length, "{n} place", "{n} places")} · {formatTZS(list.reduce((sum, p) => sum + p.value, 0))}</span>
            </h2>
            <ul className="overflow-hidden rounded-3xl border border-border/70 bg-card">
              {list.map((p) => (
                <li key={p.key} className="grid gap-x-4 gap-y-2 border-b border-border/50 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-sm font-semibold">{t(p.label)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {t.plural(p.customers, "{n} customer", "{n} customers")} · {multiDay ? t("last order {when}", { when: t.dateTime(p.last) }) : t("last order at {time}", { time: t.time(p.last) })}
                    </p>
                  </div>
                  {/* Served by */}
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {p.by.length ? p.by.map((b) => {
                      const chip = (
                        <>
                          <span className="truncate font-semibold">{b.id ? b.name : t(b.name)}</span>
                          <span className="text-muted-foreground tabular-nums">{t.plural(b.orders, "{n} order", "{n} orders")}{b.value ? ` · ${b.value.toLocaleString("en-US")}` : ""}</span>
                        </>
                      );
                      const cls = "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]";
                      return b.id
                        ? <Link key={b.id} href={href(b.id)} className={cn(cls, "border-border/70 bg-background/60 hover:border-[oklch(0.72_0.11_80)]/50 hover:bg-muted")}>{chip}</Link>
                        : <span key="none" className={cn(cls, "border-dashed border-amber-500/40 bg-amber-500/5")}>{chip}</span>;
                    }) : <span className="text-[11px] text-muted-foreground">{t("Only cancelled orders")}</span>}
                  </div>
                  <div className="flex items-baseline gap-3 sm:justify-end sm:text-right">
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {t("{n} served", { n: p.served })}{p.going ? ` · ${t("{n} going", { n: p.going })}` : ""}{p.cancelled ? ` · ${t("{n} cancelled", { n: p.cancelled })}` : ""}
                    </span>
                    <span className={cn("w-28 shrink-0 text-right text-sm font-semibold tabular-nums", GOLD)}>{formatTZS(p.value)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
