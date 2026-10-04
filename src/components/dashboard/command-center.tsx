import Link from "next/link";
import { Armchair, Boxes, BrushCleaning, ConciergeBell, HandCoins, UsersRound, UtensilsCrossed, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import type { CommandCenterData } from "@/server/services/command-center";
import { LiveRefresh } from "./command-center-list";

const ago = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}m` : ""}` : `${Math.floor(m / 1440)} d`);
const STAGE: Record<string, string> = { PENDING: "New", PREPARING: "Cooking", READY: "Ready", OUT_FOR_DELIVERY: "Serving" };

/**
 * Management's live view, under the home's "Needs your attention" card: every department right now
 * (front desk, housekeeping, restaurant stages with their longest wait, tables, payments,
 * maintenance, stores) and what each member of staff has done today. Refreshes every minute.
 */
export function LiveBoard({ data, time }: { data: CommandCenterData; time: string }) {
  const { decisions, board } = data;
  const tiles: { key: string; label: string; icon: LucideIcon; href: string; value: string; sub: string; warn?: boolean; body?: React.ReactNode }[] = [
    { key: "fd", label: "Front desk", icon: ConciergeBell, href: "/staff/reservations", value: `${board.frontDesk.inHouse}`, sub: `in the hotel · ${board.frontDesk.arriving} arriving${board.frontDesk.overdue ? ` · ${board.frontDesk.overdue} overdue` : ""}`, warn: board.frontDesk.overdue > 0 || !board.frontDesk.onDesk,
      body: <p className="truncate text-[11px] text-muted-foreground">{board.frontDesk.onDesk ? <>On desk: {board.frontDesk.onDeskShiftId
        ? <Link href={`/staff/shifts/${board.frontDesk.onDeskShiftId}`} className="relative z-10 font-medium text-foreground underline-offset-2 hover:underline">{board.frontDesk.onDesk}</Link>
        : <span className="font-medium text-foreground">{board.frontDesk.onDesk}</span>}</> : <span className="font-medium text-amber-600 dark:text-amber-400">Nobody on shift</span>}</p> },
    { key: "hk", label: "Housekeeping", icon: BrushCleaning, href: "/staff/rooms", value: `${board.housekeeping.dirty + board.housekeeping.cleaning}`, sub: `to clean · ${board.housekeeping.ready} ready`, warn: board.housekeeping.longestDirty >= 45 || board.housekeeping.longestCleaning >= 40,
      body: <p className="truncate text-[11px] text-muted-foreground">{board.housekeeping.cleaning} cleaning{board.housekeeping.longestCleaning ? ` (${ago(board.housekeeping.longestCleaning)})` : ""} · {board.housekeeping.dirty} waiting{board.housekeeping.longestDirty ? ` (${ago(board.housekeeping.longestDirty)})` : ""}</p> },
    { key: "rs", label: "Restaurant", icon: UtensilsCrossed, href: "/staff/restaurant", value: `${board.restaurant.reduce((t, s) => t + s.count, 0)}`, sub: "orders running", warn: decisions.some((d) => d.area === "Restaurant"),
      body: (
        <div className="grid grid-cols-4 gap-1 text-center">
          {board.restaurant.map((s) => (
            <span key={s.status} className="min-w-0"><span className="block text-sm font-semibold tabular-nums">{s.count}</span><span className="block truncate text-[9px] uppercase tracking-wide text-muted-foreground">{STAGE[s.status]}</span>{s.count > 0 && <span className="block text-[10px] tabular-nums text-muted-foreground">{ago(s.oldest)}</span>}</span>
          ))}
        </div>
      ) },
    { key: "tb", label: "Tables", icon: Armchair, href: "/staff/restaurant/tables", value: `${board.tables.seated}`, sub: `of ${board.tables.total} seated · ${board.tables.bill} asking to pay`, warn: decisions.some((d) => d.area === "Tables") },
    { key: "py", label: "Payments", icon: HandCoins, href: "/staff/restaurant", value: `${board.payments.toConfirm}`, sub: board.payments.toConfirm ? `${formatTZS(board.payments.toConfirmAmount)} to confirm · ${ago(board.payments.oldest)}` : "nothing waiting for reception", warn: board.payments.oldest >= 60 },
    { key: "mt", label: "Maintenance", icon: Wrench, href: "/staff/rooms", value: `${board.maintenance.rooms + board.maintenance.assets}`, sub: `${board.maintenance.rooms} room${board.maintenance.rooms === 1 ? "" : "s"} · ${board.maintenance.assets} asset${board.maintenance.assets === 1 ? "" : "s"}` },
    { key: "st", label: "Stores", icon: Boxes, href: "/staff/inventory", value: `${board.stores.out + board.stores.low}`, sub: `${board.stores.out} out · ${board.stores.low} low${board.stores.waste ? ` · ${board.stores.waste} waste to approve` : ""}`, warn: board.stores.out > 0 },
  ];

  return (
    <div>
      <LiveRefresh />
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Hotel right now</h2>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />Live · {time}</p>
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          // The whole tile opens its page (a stretched link), so a link inside it — the front desk's shift — stays its own.
          <div key={t.key} className={cn("relative min-w-0 space-y-1.5 bg-card px-4 py-3 transition-colors hover:bg-muted/30", t.key === "rs" && "sm:col-span-2")}>
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><t.icon className={cn("size-3.5", t.warn ? "text-amber-500" : "")} /><Link href={t.href} className="after:absolute after:inset-0">{t.label}</Link>{t.warn && <span className="size-1.5 rounded-full bg-amber-500" />}</p>
            <p className="flex items-baseline gap-1.5"><span className="text-xl font-semibold tabular-nums">{t.value}</span><span className="truncate text-[11px] text-muted-foreground">{t.sub}</span></p>
            {t.body}
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
export function StaffToday({ data, today }: { data: CommandCenterData; today: string }) {
  const { activity } = data;
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(new Date(iso));
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Staff today</h2>
        <Link href="/staff/activity" className="text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline">All activity →</Link>
      </div>
      {activity.length === 0 ? <p className="rounded-2xl border border-border/70 bg-card px-4 py-5 text-sm text-muted-foreground">Nobody has recorded any work yet today.</p> : (
        <div className="grid gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
          {activity.map((g) => (
            <div key={g.department} className="min-w-0 bg-card px-4 py-3">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"><UsersRound className="size-3.5" />{g.department}</p>
              <ul className="space-y-1">
                {g.people.map((p) => (
                  <li key={p.id} className="min-w-0">
                    <Link href={`/staff/activity?user=${p.id}&from=${today}&to=${today}`} className="group -mx-2 block rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/50">
                      <p className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-semibold">{p.name}</span>{p.last && <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">last {time(p.last)}</span>}</p>
                      <ul className="mt-0.5 space-y-0.5 text-[12px] leading-snug text-muted-foreground">
                        {p.things.slice(0, 5).map((t) => <li key={t}>{t}</li>)}
                        {p.money > 0 && <li>Received {formatTZS(p.money)} for orders</li>}
                      </ul>
                      <span className="mt-1 inline-block text-[11px] font-semibold text-[oklch(0.55_0.11_75)] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 dark:text-[oklch(0.8_0.1_82)]">See everything {p.name.split(" ")[0]} did →</span>
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
