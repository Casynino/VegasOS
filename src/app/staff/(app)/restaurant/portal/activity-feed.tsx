import Link from "next/link";
import { ArrowRightLeft, BedDouble, Banknote, ChefHat, CircleCheck, HandPlatter, PackageCheck, Plus, Printer, Receipt, UserRoundCheck, Wine, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FeedEvent = {
  id: string; at: string; time: string; who: string; role: string | null; from: string | null; to: string;
  /** What happened when the status did not move (a waiter started serving it, a transfer, a payment…). */
  note: string | null;
  orderId: string; number: string; place: string; items: number; drinksOnly: boolean;
};

const STEP: Record<string, { text: string; icon: typeof ChefHat; tone: string }> = {
  PENDING: { text: "placed", icon: Receipt, tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  ACCEPTED: { text: "accepted", icon: ChefHat, tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  PREPARING: { text: "started preparing", icon: ChefHat, tone: "bg-amber-500/15 text-amber-600 dark:text-amber-300" },
  READY: { text: "marked ready", icon: CircleCheck, tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
  OUT_FOR_DELIVERY: { text: "started serving", icon: HandPlatter, tone: "bg-violet-500/15 text-violet-600 dark:text-violet-300" },
  DELIVERED: { text: "served", icon: CircleCheck, tone: "bg-teal-500/15 text-teal-600 dark:text-teal-300" },
  COMPLETED: { text: "completed", icon: CircleCheck, tone: "bg-teal-500/15 text-teal-600 dark:text-teal-300" },
  COLLECTED: { text: "handed over", icon: PackageCheck, tone: "bg-teal-500/15 text-teal-600 dark:text-teal-300" },
  CANCELLED: { text: "cancelled", icon: X, tone: "bg-rose-500/15 text-rose-600 dark:text-rose-300" },
};
const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
/** Same status before and after: not a kitchen step but a note on the order (who serves it, money, items). */
const isNote = (e: FeedEvent) => e.from === e.to;
function noteStep(note: string): { icon: typeof ChefHat; tone: string } {
  if (/^(Transferred|Table transferred|Handed to|No longer handed|The manager gave|The manager moved)|no longer (in charge|serving)/.test(note)) return { icon: ArrowRightLeft, tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300" };
  if (/in charge|is serving|^Goes to/.test(note)) return { icon: UserRoundCheck, tone: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.5_0.11_70)] dark:text-[oklch(0.84_0.11_82)]" };
  if (note.startsWith("Payment reversed")) return { icon: Banknote, tone: "bg-rose-500/15 text-rose-600 dark:text-rose-300" };
  if (note.startsWith("Pa")) return { icon: Banknote, tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" };
  if (note.startsWith("Charged") || /^(Removed from|Taken off) .*bill/.test(note)) return { icon: BedDouble, tone: "bg-violet-500/15 text-violet-600 dark:text-violet-300" };
  if (note.startsWith("Added")) return { icon: Plus, tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300" };
  if (/printed|downloaded/.test(note)) return { icon: Printer, tone: "bg-muted text-muted-foreground" };
  return { icon: Receipt, tone: "bg-muted text-muted-foreground" };
}

/**
 * For managers and the MD: the kitchen, the bar and the waiters, live — every step of every order
 * today (who, what, when), newest first. The board refreshes itself, so this follows along.
 */
export function ActivityFeed({ events }: { events: FeedEvent[] }) {
  const steps = events.filter((e) => !isNote(e));
  const kitchen = steps.filter((e) => !e.drinksOnly && ["ACCEPTED", "PREPARING", "READY"].includes(e.to)).length;
  const bar = steps.filter((e) => e.drinksOnly && ["ACCEPTED", "PREPARING", "READY"].includes(e.to)).length;
  const service = steps.filter((e) => ["OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "COLLECTED"].includes(e.to)).length;
  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-50" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>
            Kitchen &amp; bar, live
          </h2>
          <p className="text-xs text-muted-foreground">Every step of every order today — who did it and when. You watch; the kitchen, bar and waiters work.</p>
        </div>
        <div className="flex gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1"><ChefHat className="size-3.5 text-amber-500" /><strong className="tabular-nums">{kitchen}</strong> kitchen</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1"><Wine className="size-3.5 text-violet-500" /><strong className="tabular-nums">{bar}</strong> bar</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1"><HandPlatter className="size-3.5 text-teal-500" /><strong className="tabular-nums">{service}</strong> served</span>
        </div>
      </div>
      {events.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing yet today — steps appear here as the kitchen, bar and waiters work.</p> : (
        <ol className="mt-3 max-h-[19rem] divide-y divide-border/50 overflow-y-auto overscroll-contain border-t border-border/70 [scrollbar-width:thin]">
          {events.map((e) => {
            if (isNote(e)) {
              const n = noteStep(e.note ?? "");
              return (
                <li key={e.id}>
                  <Link href={`/staff/restaurant/orders/${e.orderId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40 sm:px-5">
                    <span className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{e.time}</span>
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", n.tone)}><n.icon className="size-4" /></span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate" title={e.note ?? undefined}><strong className="font-semibold">{shortNo(e.number)}</strong> <span className="text-muted-foreground">·</span> {e.note ?? "Updated"}</span>
                      <span className="block truncate text-xs text-muted-foreground">{e.place} · by {e.who.replace(/\s*\(.*\)/, "")}{e.role ? ` (${e.role})` : ""}</span>
                    </span>
                  </Link>
                </li>
              );
            }
            const s = STEP[e.to] ?? STEP.PENDING;
            const Icon = e.drinksOnly && ["ACCEPTED", "PREPARING", "READY"].includes(e.to) ? Wine : s.icon;
            return (
              <li key={e.id}>
                <Link href={`/staff/restaurant/orders/${e.orderId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40 sm:px-5">
                  <span className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{e.time}</span>
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", s.tone)}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate"><strong className="font-semibold">{e.who}</strong>{e.role && <span className="text-muted-foreground"> ({e.role})</span>} {s.text} <strong className="font-semibold">{shortNo(e.number)}</strong></span>
                    <span className="block truncate text-xs text-muted-foreground">{e.place} · {e.items} item{e.items === 1 ? "" : "s"}{e.drinksOnly ? " · drinks" : ""}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
