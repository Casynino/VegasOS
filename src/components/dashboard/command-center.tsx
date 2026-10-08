import Link from "next/link";
import { Armchair, Boxes, BrushCleaning, ConciergeBell, HandCoins, UsersRound, UtensilsCrossed, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import type { CommandCenterData } from "@/server/services/command-center";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";
import { LiveRefresh } from "./command-center-list";

const ago = (m: number, t: T) => (m < 60 ? t("{n} min", { n: m }) : m < 1440 ? (m % 60 ? t("{h} h {m}m", { h: Math.floor(m / 60), m: m % 60 }) : t("{h} h", { h: Math.floor(m / 60) })) : t("{n} d", { n: Math.floor(m / 1440) }));
/** Restaurant stages (shown with t.ctx("kitchen", …): "Ready" here is an order ready to serve). */
const STAGE: Record<string, string> = { PENDING: msg("New"), PREPARING: msg("Cooking"), READY: msg("Ready"), OUT_FOR_DELIVERY: msg("Serving") };

/**
 * Management's live view, under the home's "Needs your attention" card: every department right now
 * (front desk, housekeeping, restaurant stages with their longest wait, tables, payments,
 * maintenance, stores) and what each member of staff has done today. Refreshes every minute.
 */
export async function LiveBoard({ data, time }: { data: CommandCenterData; time: string }) {
  const t = await getT();
  const { decisions, board } = data;
  const fd = board.frontDesk, hk = board.housekeeping;
  const tiles: { key: string; label: string; icon: LucideIcon; href: string; value: string; sub: string; warn?: boolean; body?: React.ReactNode }[] = [
    { key: "fd", label: t("Front desk"), icon: ConciergeBell, href: "/staff/reservations", value: `${fd.inHouse}`, sub: fd.overdue ? t("in the hotel · {arriving} arriving · {overdue} overdue", { arriving: fd.arriving, overdue: fd.overdue }) : t("in the hotel · {arriving} arriving", { arriving: fd.arriving }), warn: fd.overdue > 0 || !fd.onDesk,
      body: <p className="truncate text-[11px] text-muted-foreground">{board.frontDesk.onDesk ? <>{t("On desk:")} {board.frontDesk.onDeskShiftId
        ? <Link href={`/staff/shifts/${board.frontDesk.onDeskShiftId}`} className="relative z-10 font-medium text-foreground underline-offset-2 hover:underline">{board.frontDesk.onDesk}</Link>
        : <span className="font-medium text-foreground">{board.frontDesk.onDesk}</span>}</> : <span className="font-medium text-amber-600 dark:text-amber-400">{t("Nobody on shift")}</span>}</p> },
    { key: "hk", label: t("Housekeeping"), icon: BrushCleaning, href: "/staff/rooms", value: `${hk.dirty + hk.cleaning}`, sub: t("to clean · {n} ready", { n: hk.ready }), warn: hk.longestDirty >= 45 || hk.longestCleaning >= 40,
      body: <p className="truncate text-[11px] text-muted-foreground">{t("{n} cleaning", { n: hk.cleaning })}{hk.longestCleaning ? ` (${ago(hk.longestCleaning, t)})` : ""} · {t("{n} waiting", { n: hk.dirty })}{hk.longestDirty ? ` (${ago(hk.longestDirty, t)})` : ""}</p> },
    { key: "rs", label: t("Restaurant"), icon: UtensilsCrossed, href: "/staff/restaurant", value: `${board.restaurant.reduce((sum, s) => sum + s.count, 0)}`, sub: t("orders running"), warn: decisions.some((d) => d.area === "Restaurant"),
      body: (
        <div className="grid grid-cols-4 gap-1 text-center">
          {board.restaurant.map((s) => (
            <span key={s.status} className="min-w-0"><span className="block text-sm font-semibold tabular-nums">{s.count}</span><span className="block truncate text-[9px] uppercase tracking-wide text-muted-foreground">{STAGE[s.status] && t.ctx("kitchen", STAGE[s.status])}</span>{s.count > 0 && <span className="block text-[10px] tabular-nums text-muted-foreground">{ago(s.oldest, t)}</span>}</span>
          ))}
        </div>
      ) },
    { key: "tb", label: t("Tables"), icon: Armchair, href: "/staff/restaurant/tables", value: `${board.tables.seated}`, sub: t("of {total} seated · {bill} asking to pay", { total: board.tables.total, bill: board.tables.bill }), warn: decisions.some((d) => d.area === "Tables") },
    { key: "py", label: t("Payments"), icon: HandCoins, href: "/staff/restaurant", value: `${board.payments.toConfirm}`, sub: board.payments.toConfirm ? t("{amount} to confirm · {time}", { amount: formatTZS(board.payments.toConfirmAmount), time: ago(board.payments.oldest, t) }) : t("nothing waiting for reception"), warn: board.payments.oldest >= 60 },
    { key: "mt", label: t("Maintenance"), icon: Wrench, href: "/staff/rooms", value: `${board.maintenance.rooms + board.maintenance.assets}`, sub: `${t.plural(board.maintenance.rooms, "{n} room", "{n} rooms")} · ${t.plural(board.maintenance.assets, "{n} asset", "{n} assets")}` },
    { key: "st", label: t("Stores"), icon: Boxes, href: "/staff/inventory", value: `${board.stores.out + board.stores.low}`, sub: board.stores.waste ? t("{out} out · {low} low · {waste} waste to approve", { out: board.stores.out, low: board.stores.low, waste: board.stores.waste }) : t("{out} out · {low} low", { out: board.stores.out, low: board.stores.low }), warn: board.stores.out > 0 },
  ];

  return (
    <div>
      <LiveRefresh />
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("Hotel right now")}</h2>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />{t("Live · {time}", { time })}</p>
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          // The whole tile opens its page (a stretched link), so a link inside it — the front desk's shift — stays its own.
          <div key={tile.key} className={cn("relative min-w-0 space-y-1.5 bg-card px-4 py-3 transition-colors hover:bg-muted/30", tile.key === "rs" && "sm:col-span-2")}>
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><tile.icon className={cn("size-3.5", tile.warn ? "text-amber-500" : "")} /><Link href={tile.href} className="after:absolute after:inset-0">{tile.label}</Link>{tile.warn && <span className="size-1.5 rounded-full bg-amber-500" />}</p>
            <p className="flex items-baseline gap-1.5"><span className="text-xl font-semibold tabular-nums">{tile.value}</span><span className="truncate text-[11px] text-muted-foreground">{tile.sub}</span></p>
            {tile.body}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Staff supervision: what each person has done today, by department ("Checked in 4 guests",
 * "Prepared 14 orders") — activity, never a score. Tap a person to see every action they took.
 */
export async function StaffToday({ data, today }: { data: CommandCenterData; today: string }) {
  const t = await getT();
  const { activity } = data;
  const time = (iso: string) => t.time(iso);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("Staff today")}</h2>
        <Link href="/staff/activity" className="text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline">{t("All activity →")}</Link>
      </div>
      {activity.length === 0 ? <p className="rounded-2xl border border-border/70 bg-card px-4 py-5 text-sm text-muted-foreground">{t("Nobody has recorded any work yet today.")}</p> : (
        <div className="grid gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
          {activity.map((g) => (
            <div key={g.department} className="min-w-0 bg-card px-4 py-3">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"><UsersRound className="size-3.5" />{t(g.department)}</p>
              <ul className="space-y-1">
                {g.people.map((p) => (
                  <li key={p.id} className="min-w-0">
                    <Link href={`/staff/activity?user=${p.id}&from=${today}&to=${today}`} className="group -mx-2 block rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/50">
                      <p className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-semibold">{p.name}</span>{p.last && <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{t("last {time}", { time: time(p.last) })}</span>}</p>
                      <ul className="mt-0.5 space-y-0.5 text-[12px] leading-snug text-muted-foreground">
                        {p.things.slice(0, 5).map((thing) => <li key={thing}>{t(thing)}</li>)}
                        {p.money > 0 && <li>{t("Received {amount} for orders", { amount: formatTZS(p.money) })}</li>}
                      </ul>
                      <span className="mt-1 inline-block text-[11px] font-semibold text-[oklch(0.55_0.11_75)] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 dark:text-[oklch(0.8_0.1_82)]">{t("See everything {name} did →", { name: p.name.split(" ")[0] })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
