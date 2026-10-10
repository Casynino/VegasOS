import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BedDouble, CalendarCheck, ChevronRight, Clock, DoorOpen, FileText, History, Lock, LogOut, UserRound, Wallet } from "lucide-react";
import { getMyOpenShift, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessDayConfig, businessToday, getSettings } from "@/server/settings";
import { MyWeek, myWeek } from "./my-week";
import { WhatsOn, whatsOn } from "./whats-on";
import { DESK_LIMIT, getShiftOverview, shiftHistory } from "@/server/services/shifts";
import { inHouseBalances } from "@/server/services/guest-balances";
import { needsOwnShift } from "@/lib/permissions";
import { staffHome } from "@/lib/staff-home";
import { formatTZS } from "@/lib/format";
import { toDbDate } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";
import { SlimBanner } from "@/components/staff/slim-banner";
import { DeskCard } from "@/components/staff/desk-card";
import { ShiftControls } from "@/components/staff/shift-controls";
import { logoutAction } from "@/app/staff/(auth)/login/actions";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Start shift") };
}
export const dynamic = "force-dynamic";

/** Where to go once the shift is running: only a staff or reception page, never back here. */
function safeNext(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !/^\/(staff|reception)\//.test(value)) return null;
  if (value.startsWith("/staff/start-shift") || /[\\\s]/.test(value)) return null;
  return value;
}

/**
 * NO ACTIVE SHIFT — a receptionist does reception work only inside their own open shift. Sent here when they have
 * none: see the desk (up to two receptionists work together), what the day holds and the last handover, then start —
 * and go on to where they were going. When both places are taken, they ask one of the two to end their shift (or a
 * manager). Managers, the MD and the owner never need a shift and are sent home.
 */
export default async function StartShiftPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!needsOwnShift(user.permissions)) redirect(staffHome(user.permissions));
  const next = safeNext((await searchParams).next);
  if (await getMyOpenShift(user.id)) redirect(next ?? staffHome(user.permissions));

  const [today, s, t] = await Promise.all([businessToday(), getSettings(), getT()]);
  const day = toDbDate(today);
  const [overview, mine, arrivals, departures, inHouse, balances, week, on] = await Promise.all([
    getShiftOverview(today),
    shiftHistory({ userId: user.id, take: 3, department: "RECEPTION" }),
    db.reservation.count({ where: { arrivalDate: { lte: day }, status: { in: ["RESERVED", "CONFIRMED"] } } }),
    db.reservation.count({ where: { departureDate: { lte: day }, status: "CHECKED_IN" } }),
    db.reservation.count({ where: { status: "CHECKED_IN", kind: "STAY" } }),
    inHouseBalances(today),
    myWeek(user.id, today, businessDayConfig(s)),
    whatsOn(today, businessDayConfig(s)),
  ]);
  const scheduled = overview.scheduledToday;
  const isScheduled = scheduled?.scheduledUserId === user.id;
  const desk = overview.openAll;
  const full = overview.full;
  const now = new Date();
  const clock = (d: Date | string) => new Intl.DateTimeFormat(t.intl, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: s.timezone }).format(new Date(d));
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: s.timezone }).format(now));
  const first = user.fullName.replace(/\s*\(.*\)/, "").split(" ")[0];
  const greeting = hour < 12 ? t("Good morning, {name}", { name: first }) : hour < 17 ? t("Good afternoon, {name}", { name: first }) : t("Good evening, {name}", { name: first });
  const joinNames = (names: string[]) => names.join(t(" and "));

  return (
    <div className="w-full space-y-5">
      <SlimBanner icon={<Clock />} eyebrow={`${t("Reception")} · ${t.date(today, true)}`} title={greeting}
        sub={full ? t("Both reception places are taken — ask one of them to end their shift before you start.") : t("Start your shift to work the desk. When you end it, your shift report is made automatically.")}
        right={<ShiftControls variant="switch" myShiftOpen={false} otherOpenBy={full ? joinNames(desk.map((o) => o.user.fullName.split(" ")[0])) : null} scheduledName={scheduled?.scheduledUser.fullName ?? null} isScheduled={isScheduled} />} />

      {full && (
        <p className="flex gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          <Lock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <span>{t.rich("<b>{n} receptionists are on shift</b> — {list}. Please contact one of them to end their shift, or contact the Manager if you need authorized access.", { b: (c) => <strong className="font-semibold">{c}</strong> }, { n: desk.length, list: joinNames(desk.map((o) => t("{name} (since {time})", { name: o.user.fullName, time: clock(o.startedAt) }))) })}</span>
        </p>
      )}

      {/* What the desk holds today — before you start */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <DeskCard desk={desk} limit={DESK_LIMIT} meId={user.id} timezone={s.timezone} now={now} className="col-span-2 xl:col-span-1" />
        {[
          { icon: DoorOpen, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-300", label: t("To check in"), value: arrivals, sub: arrivals ? t("arrivals today or late") : t("no one waiting") },
          { icon: CalendarCheck, tone: "bg-amber-500/12 text-amber-600 dark:text-amber-300", label: t("To check out"), value: departures, sub: departures ? t("due today or earlier") : t("no one due") },
          { icon: BedDouble, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-300", label: t("Stays in the hotel"), value: inHouse, sub: t("checked in now") },
          { icon: Wallet, tone: "bg-rose-500/12 text-rose-600 dark:text-rose-300", label: t("Guests owing"), value: balances.summary.owingCount, sub: balances.summary.owingCount ? t("{amount} to collect", { amount: formatTZS(balances.summary.totalOutstanding) }) : t("everyone is paid up") },
        ].map((x) => (
          <div key={x.label} className="flex items-center gap-3.5 rounded-3xl border border-border/70 bg-card px-4 py-3.5">
            <span className={cn("hidden size-11 shrink-0 place-items-center rounded-2xl sm:grid", x.tone)}><x.icon className="size-5" /></span>
            <div className="min-w-0 leading-tight">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{x.label}</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums">{x.value}</p>
              <p className="text-xs leading-snug text-muted-foreground">{x.sub}</p>
            </div>
          </div>
        ))}
      </section>

      {/* What is waiting at the desk — before she starts */}
      <WhatsOn on={on} timezone={s.timezone} now={now} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <MyWeek week={week} />
        {/* Your last shifts, each with its report */}
        <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold"><History className="size-4 text-muted-foreground" />{t("Your last shifts")}</h2>
          {mine.length === 0 ? <p className="mt-4 rounded-2xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">{t("This will be your first shift.")}</p> : (
            <ul className="mt-3 space-y-2">
              {mine.map((h) => (
                <li key={h.id} className="flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-2.5 transition hover:bg-muted/40">
                  {/* The card opens the shift (what was done and collected); Report opens its report */}
                  <Link href={`/staff/shifts/${h.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Clock className="size-4" /></span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">{t.date(h.businessDate)} · {t(h.label)}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{clock(h.startedAt)} → {h.endedAt ? clock(h.endedAt) : t("open")} · {t("collected {amount}", { amount: formatTZS(h.collected) })}</span>
                    </span>
                  </Link>
                  {h.endedAt && <Link href={`/staff/shifts/${h.id}/report`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted"><FileText className="size-3.5" />{t("Report")}</Link>}
                </li>
              ))}
            </ul>
          )}
          <Link href="/staff/account#my-shift" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.8_0.1_82)]">{t("All my shifts")}<ChevronRight className="size-3.5" /></Link>
        </section>
      </div>

      <nav className="flex flex-wrap items-center justify-center gap-2 pb-2 text-sm">
        <Link href="/staff/collections" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Wallet className="size-3.5" />{t("My collections")}<ArrowRight className="size-3.5" /></Link>
        <Link href="/staff/account#my-shift" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><UserRound className="size-3.5" />{t("My shifts")}</Link>
        <form action={logoutAction}>
          <button type="submit" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-muted-foreground transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300"><LogOut className="size-3.5" />{t("Sign out")}</button>
        </form>
      </nav>
    </div>
  );
}
