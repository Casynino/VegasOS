import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ChevronRight, Clock, KeyRound, Languages, Laptop, Lock, LogOut, Mail, MonitorSmartphone, Phone, ShieldCheck, Smartphone, UserRound, Wallet } from "lucide-react";
import { currentSessionTokenHash, getMyOpenShift, requireUser, type CurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { getShiftOverview, shiftHistory } from "@/server/services/shifts";
import { isRestaurantDevice, needsOwnShift } from "@/lib/permissions";
import { shiftLabel } from "@/lib/shift-label";
import { fromDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Initials, Panel } from "@/components/dashboard/kit";
import { ShiftControls } from "@/components/staff/shift-controls";
import { buttonVariants } from "@/components/ui/button";
import { ChangePasswordForm } from "./change-password-form";
import { ProfileForm, SignOutOthersButton } from "./profile-form";
import { logoutAction } from "@/app/staff/(auth)/login/actions";
import { deviceLabel } from "@/lib/device-label";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("My account") };
}

export default async function AccountPage() {
  const user = await requireUser();
  const t = await getT();
  // A person's first sign-in: choose their own password (the restaurant screen's login never is — it is the MD's).
  const first = user.mustChangePassword && !isRestaurantDevice(user.permissions);
  const [me, sessions, current] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true, createdAt: true, lastLoginAt: true } }),
    db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } }),
    currentSessionTokenHash(),
  ]);

  return (
    <div className="w-full space-y-6">
      {first && (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {t("Please choose your own password before continuing.")}
        </p>
      )}

      {/* Profile header */}
      <section className="relative isolate overflow-hidden rounded-[1.75rem] bg-linear-to-br from-[#1b1611] via-[#2a2016] to-[#3a2a17] p-5 text-white shadow-[0_24px_60px_-30px_rgba(40,25,5,0.75)] sm:p-7">
        <div aria-hidden className="absolute -right-16 -top-24 -z-10 size-72 rounded-full bg-[radial-gradient(circle,oklch(0.78_0.13_80/0.35),transparent_65%)]" />
        <div className="flex flex-wrap items-center gap-4 sm:gap-5">
          <Initials name={user.fullName} className="size-16 text-xl ring-4 ring-white/10 sm:size-20 sm:text-2xl" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{user.fullName}</h1>
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[oklch(0.72_0.12_80/0.2)] px-2.5 py-0.5 text-xs font-medium text-[#f2d28c]"><ShieldCheck className="size-3.5" />{t(user.roleName)}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/70">
              <span className="inline-flex min-w-0 items-center gap-1.5"><Mail className="size-4 shrink-0" /><span className="truncate">{user.email}</span></span>
              <span className="inline-flex items-center gap-1.5"><Phone className="size-4" />{me.phone ?? t("No phone added")}</span>
            </div>
          </div>
        </div>
      </section>

      {needsOwnShift(user.permissions) && <MyShiftPanel user={user} />}

      {/* The shared restaurant screen: one login for the whole restaurant; waiters pick their name on it. It signs out like any account. */}
      {isRestaurantDevice(user.permissions) && (
        <section className="flex flex-wrap items-center gap-4 rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[oklch(0.72_0.12_80/0.15)] text-[oklch(0.55_0.11_75)] dark:text-[#f2d28c]"><MonitorSmartphone className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{t("This is the restaurant's screen")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("One login for the whole restaurant. Waiters never sign in here: they pick their name from the list to make an order, seat a customer or serve an order.")}</p>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-300">
              <LogOut className="size-4" />{t("Sign out")}
            </button>
          </form>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title={<span className="flex items-center gap-2"><UserRound className="size-4 text-muted-foreground" />{t("Personal details")}</span>} subtitle={t("Your name, email and phone as the team sees them")}>
          <ProfileForm fullName={user.fullName} email={user.email} phone={me.phone} />
        </Panel>
        <Panel title={<span className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" />{t("Password")}</span>} subtitle={t("Changing it signs you out on your other devices")}>
          <ChangePasswordForm first={first} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title={<span className="flex items-center gap-2"><Laptop className="size-4 text-muted-foreground" />{t("Signed-in devices")}</span>}
          subtitle={t("Where your account is signed in right now")}>
          <ul className="divide-y divide-border">
            {sessions.map((s) => {
              const d = deviceLabel(s.userAgent, t);
              const here = s.tokenHash === current;
              const Icon = d.phone ? Smartphone : Laptop;
              return (
                <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">{d.label}{here && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{t("This device")}</span>}</span>
                    <span className="block truncate text-xs text-muted-foreground">{t("Last active {time}", { time: t.dateTime(s.lastSeenAt) })}{s.ipAddress ? ` · ${s.ipAddress}` : ""}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {/* The restaurant screen's login may be on more than one screen — the MD signs those out (Staff & roles). */}
          {!isRestaurantDevice(user.permissions) && <div className="mt-4"><SignOutOthersButton disabled={sessions.length <= 1} /></div>}
        </Panel>
        <div className="space-y-6">
          <Panel title={t("Account")}>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("Role")}</dt><dd className="font-medium">{t(user.roleName)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("Last sign-in")}</dt><dd className="font-medium">{me.lastLoginAt ? t.dateTime(me.lastLoginAt) : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("Account created")}</dt><dd className="font-medium">{t.dateTime(me.createdAt)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{t("Your role and permissions are set by the owner in Staff & roles.")}</p>
          </Panel>
          {/* This person's own language for the staff app — saved on their account (every device); nobody else's changes. */}
          <Panel title={<span className="flex items-center gap-2"><Languages className="size-4 text-muted-foreground" />{t("Language")}</span>}
            subtitle={t("The language the staff app uses for you, on every device")}>
            <LanguageSwitch variant="menu" staff tone="light" />
            <p className="mt-3 text-xs text-muted-foreground">{t("Only for you: guests and other staff keep their own language. Nothing else changes.")}</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Minutes from then until this request (a server page: rendered once per request). */
function minutesSince(start: Date) {
  return Math.max(0, Math.round((Date.now() - start.getTime()) / 60000));
}

/** 185 → "3 h 05 min"; 40 → "40 min". */
function duration(minutes: number, t: T) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? t("{h} h {m} min", { h, m: String(m).padStart(2, "0") }) : t("{m} min", { m });
}

/** "A and B" (in the reader's language). */
const andList = (items: string[], t: T) => (items.length ? items.reduce((all, x) => t("{a} and {b}", { a: all, b: x })) : "");

/**
 * MY SHIFT — a receptionist's own shift: running or not, start / close it, what they collected
 * and did in it, and their last shifts. Open off shift too (this page needs no shift).
 */
async function MyShiftPanel({ user }: { user: CurrentUser }) {
  const t = await getT();
  const today = await businessToday();
  const [mine, overview, history] = await Promise.all([getMyOpenShift(user.id), getShiftOverview(today), shiftHistory({ userId: user.id, take: 10 })]);
  // Locked only when two others are already on reception.
  const lockedBy = !mine && overview.full ? andList(overview.openAll.map((o) => o.user.fullName.split(" ")[0]), t) : null;
  const current = mine ? history.find((h) => h.id === mine.id) : undefined;
  const minutes = mine ? minutesSince(mine.startedAt) : 0;
  const link = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <div id="my-shift" className="scroll-mt-24">
      <Panel title={<span className="flex items-center gap-2"><Clock className="size-4 text-muted-foreground" />{t("My shift")}</span>}
        subtitle={t("Everything you do and collect is kept under your own shift")}>
        <div className={cn("rounded-2xl border px-4 py-3.5", mine ? "border-emerald-500/30 bg-emerald-500/[0.05]" : "border-amber-500/30 bg-amber-500/[0.05]")}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="relative flex size-2.5 shrink-0">
              {mine && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
              <span className={cn("relative inline-flex size-2.5 rounded-full", mine ? "bg-emerald-500" : "bg-amber-500")} />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              {mine ? (
                <>
                  <p className="text-sm font-semibold">{t("On shift since {time} · {shift}", { time: t.time(mine.startedAt), shift: t(shiftLabel(mine.startedAt)) })}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("Hotel day {date} · running {duration}", { date: t.date(fromDbDate(mine.businessDate)), duration: duration(minutes, t) })}{current ? ` · ${t("collected so far {amount}", { amount: formatTZS(current.collected) })}` : ""}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold">{t("No active shift")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("Start your shift before you do reception work.")}</p>
                </>
              )}
            </div>
            <ShiftControls variant="switch" since={mine ? t.time(mine.startedAt) : null} myShiftOpen={!!mine} otherOpenBy={lockedBy}
              scheduledName={overview.scheduledToday?.scheduledUser.fullName ?? null} isScheduled={overview.scheduledToday?.scheduledUserId === user.id} />
          </div>
          {!mine && overview.full && (
            <p className="mt-3 flex gap-2 text-xs text-amber-900 dark:text-amber-100">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              <span>{t("Two receptionists are on shift: {names}. Please contact one of them to end their shift, or contact the Manager if you need authorized access.", { names: andList(overview.openAll.map((o) => t("{name} (since {time})", { name: o.user.fullName, time: t.time(o.startedAt) })), t) })}</span>
            </p>
          )}
          {mine && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/staff/collections?shift=${mine.id}`} className={link}><Wallet />{t("What I collected this shift")}</Link>
              <Link href={`/staff/shifts/${mine.id}`} className={link}><Activity />{t("My activity this shift")}</Link>
            </div>
          )}
        </div>

        <h3 className="mt-5 text-sm font-semibold">{t("My shifts")}</h3>
        {history.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t("No shifts worked yet.")}</p> : (
          <ul className="mt-1 divide-y divide-border">
            {history.map((s) => (
              <li key={s.id}>
                <Link href={`/staff/shifts/${s.id}`} className="group flex items-center gap-3 py-3 text-sm">
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="flex flex-wrap items-center gap-x-2 font-semibold text-foreground">
                      {t(s.label)} · {t.date(s.businessDate)}
                      {s.open && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{t("Open now")}</span>}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{t.time(s.startedAt)} → {s.endedAt ? t.time(s.endedAt) : t("now")}{s.replacement ? ` · ${t("replacement")}` : ""}</span>
                    {s.closedBy && <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">{t("Closed by {name}", { name: s.closedBy })}{s.closeReason ? `: ${s.closeReason}` : ""}</span>}
                  </span>
                  <span className="shrink-0 text-right leading-tight">
                    <span className="block font-semibold tabular-nums">{formatTZS(s.collected)}</span>
                    <span className="block text-[11px] text-muted-foreground">{t("collected")}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
