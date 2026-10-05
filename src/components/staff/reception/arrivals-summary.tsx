import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { whatsAppLink } from "@/lib/arrival-reminder";
import { formatBusinessDate, formatDateTime, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Initials } from "@/components/dashboard/kit";
import { buttonVariants } from "@/components/ui/button";
import { ShowRows } from "@/components/dashboard/show-rows";
import type { getArrivalsSummary } from "@/server/services/front-desk";
import { MeetingButtons } from "@/app/staff/(app)/reservations/[id]/panels";

type Summary = Awaited<ReturnType<typeof getArrivalsSummary>>;
type Person = Summary["expected"][number];

const GRID = "lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_8.5rem_8rem]";
const shortDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const day = (d: string) => shortDay.format(new Date(`${d}T00:00:00Z`)).replace(",", "");

/**
 * Start of shift: the guests still to check in today as a reservation list
 * (three in view, the rest a scroll away) with Check in on every row, and any
 * no-show that needs a decision.
 */
export function ArrivalsSummary({ s, today, canCheckIn, show = 3 }: { s: Summary; today: string; canCheckIn: boolean; show?: number }) {
  const toCome = [...s.expected, ...s.late].sort((a, b) => a.arrival.localeCompare(b.arrival) || (a.eta ?? "99").localeCompare(b.eta ?? "99"));

  /** Where this arrival stands, in reception's words. */
  const state = (p: Person) =>
    p.meeting ? { tag: p.arrival < today ? "Missed meeting" : "Meeting today", tone: p.arrival < today ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-violet-500/15 text-violet-700 dark:text-violet-300", note: `Meeting ${p.meeting.time}${p.meeting.contact ? ` · ${p.meeting.contact}` : ""}` }
    : p.arrival < today ? { tag: "Late", tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300", note: `Was due ${formatBusinessDate(p.arrival)}` }
      : p.late ? { tag: "Late arrival", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300", note: `${p.eta ? `Around ${p.eta} · ` : ""}room kept${p.lateNote ? ` · ${p.lateNote}` : ""}` }
        : { tag: "Expected today", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300", note: `${p.eta ? `Around ${p.eta} · ` : ""}${p.nights} night${p.nights === 1 ? "" : "s"}` };

  return (
    <section aria-label="Arrivals today" className="space-y-4 rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">To check in · {toCome.length}</p>
        {toCome.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            {s.total ? "Everyone due today is checked in." : "Nobody is due to arrive today."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/70">
            <div className={cn("hidden gap-4 border-b border-border/70 bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground lg:grid", GRID)}>
              <span>Guest</span><span>Room</span><span>Stay</span><span>Status</span><span className="text-right">Balance</span><span />
            </div>
            <ShowRows show={show} total={toCome.length}>
              <ul className="divide-y divide-border/60">
                {toCome.map((p) => {
                  const st = state(p);
                  return (
                    <li key={p.id} data-row className={cn("relative grid gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 lg:items-center", GRID)}>
                      <div className="flex min-w-0 items-center gap-3">
                        <Initials name={p.name} className="size-9 text-xs" />
                        <div className="min-w-0">
                          <Link href={`/staff/reservations/${p.id}`} className="block truncate font-semibold after:absolute after:inset-0">{p.name}</Link>
                          <span className="block truncate text-xs text-muted-foreground">{p.phone ?? "No phone"} · <span className="font-mono">{p.reference}</span> · {p.source}{p.company ? ` · ${p.company}` : ""}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">Booked by {p.bookedBy ?? "website"}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pl-12 lg:pl-0">
                        {p.roomTypes.length ? p.roomTypes.map((x) => (
                          <span key={x.number} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs", x.meeting ? "bg-violet-500/12 text-violet-800 dark:text-violet-200" : "bg-muted")}><strong className="tabular-nums">{x.number}</strong><span className={x.meeting ? "" : "text-muted-foreground"}>{x.meeting ? `— ${x.type}` : x.type}</span></span>
                        )) : <span className="text-xs font-medium text-amber-700 dark:text-amber-400">No room yet</span>}
                      </div>
                      <div className="pl-12 text-sm lg:pl-0">
                        <span className="whitespace-nowrap">{p.meeting ? `${day(p.arrival)} · ${p.meeting.time}` : `${day(p.arrival)} → ${day(p.departure)}`}</span>
                        <span className="block truncate text-xs text-muted-foreground">{st.note}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-12 lg:block lg:pl-0">
                        <span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", st.tone)}>{st.tag}</span>
                        <span className="text-[11px] font-medium lg:mt-1 lg:block">
                          {p.notHeld ? <span className="text-orange-700 dark:text-orange-400">Not paid · room not held</span>
                            : p.pending ? <span className="text-amber-700 dark:text-amber-400">Unpaid{p.holdUntil ? ` · held till ${formatDateTime(p.holdUntil)}` : ""}</span>
                            : p.billTo === "GROUP" ? <span className="text-violet-700 dark:text-violet-300">Group pays</span>
                            : p.billTo !== "GUEST" ? <span className="text-violet-700 dark:text-violet-300">Company invoice</span>
                              : <span className="text-emerald-700 dark:text-emerald-400">{p.paidAmount > 0 ? "Paid / deposit" : "Confirmed by manager"}</span>}
                        </span>
                      </div>
                      <div className={cn("whitespace-nowrap pl-12 text-sm font-semibold tabular-nums lg:pl-0 lg:text-right", p.balance > 0 ? "text-rose-600 dark:text-rose-400" : p.balance < 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                        {p.balance > 0 ? <>{p.paidAmount > 0 ? "Owes" : "Unpaid"} {formatTZS(p.balance)}</> : p.balance < 0 ? <>Credit {formatTZS(-p.balance)}</> : p.net > 0 ? "Paid" : "—"}
                        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground lg:ml-0 lg:block">of {formatTZS(p.net)}</span>
                      </div>
                      <div className="relative z-10 flex items-center gap-1.5 pl-12 lg:justify-end lg:pl-0">
                        {p.phone && (
                          <a href={whatsAppLink(p.phone, p.reminder)} target="_blank" rel="noreferrer" title={`Send a WhatsApp reminder: ${p.reminder}`} aria-label={`Remind ${p.name} on WhatsApp`}
                            className="grid size-8 place-items-center rounded-lg border border-border hover:bg-muted">
                            <MessageCircle className="size-4 text-emerald-600" />
                          </a>
                        )}
                        {canCheckIn && (p.meeting
                          ? <MeetingButtons reservationId={p.id} status={p.pending ? "RESERVED" : "CONFIRMED"} balance={p.balance} canStart canComplete={false} size="sm" />
                          : <Link href={`/staff/check-in?id=${p.id}#workspace`} className={buttonVariants({ size: "sm" })}>Check in</Link>)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ShowRows>
          </div>
        )}
      </div>

      {/* Guests who did not arrive while their room is still held: one quiet line — open it to decide (keep the room or release it). */}
      {s.noShows.length > 0 && (
        <details className="group rounded-2xl border border-rose-500/30 bg-rose-500/[0.04]">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm">
            <span className="size-2 shrink-0 rounded-full bg-rose-500" />
            <span className="min-w-0 flex-1"><b className="font-semibold text-rose-700 dark:text-rose-300">{s.noShows.length} no-show{s.noShows.length === 1 ? "" : "s"}</b>
              <span className="text-muted-foreground"> — did not arrive, room{s.noShows.length === 1 ? "" : "s"} still held. Keep or release.</span></span>
            <span className="shrink-0 text-xs font-medium text-muted-foreground group-open:hidden">Review</span>
            <span className="hidden shrink-0 text-xs font-medium text-muted-foreground group-open:inline">Hide</span>
          </summary>
          <ul className="max-h-[17rem] divide-y divide-border/60 overflow-y-auto overscroll-contain border-t border-rose-500/20 px-3 text-sm [scrollbar-width:thin]">
            {s.noShows.map((n) => (
              <li key={n.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  <Link href={`/staff/reservations/${n.id}`} className="font-medium hover:underline">{n.name}</Link>
                  <span className="text-xs text-muted-foreground"> · room {n.rooms.join(", ")}{n.paid > 0 ? " · paid" : ""}</span>
                </span>
                <Link href={`/staff/reservations/${n.id}`} className={buttonVariants({ size: "sm", variant: "outline", className: "h-7 px-2.5 text-xs" })}>Decide</Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
