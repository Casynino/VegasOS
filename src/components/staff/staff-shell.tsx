import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Clock, Globe, LogOut } from "lucide-react";
import { can, getMyOpenShift, requireUser } from "@/server/auth";
import { isRestaurantDevice, needsOwnShift, worksWaiterShift } from "@/lib/permissions";
import { businessToday, getSettings } from "@/server/settings";
import { newRequestCount } from "@/server/services/booking-requests";
import { newStockRequestCount } from "@/server/services/stock-requests";
import { staffHome } from "@/lib/staff-home";
import { visibleNav } from "@/components/staff/nav-config";
import { StaffNav } from "@/components/staff/staff-nav";
import { StaffBottomBar } from "@/components/staff/bottom-bar";
import { StaffDarkMode } from "@/components/staff/theme-switch";
import { Initials } from "@/components/dashboard/kit";
import { logoutAction } from "@/app/staff/(auth)/login/actions";
import { ReceptionSearch } from "./reception/search";
import { StaffAlerts } from "./staff-alerts";
import { StackTableLabels } from "./stack-table-labels";
import { WaiterPinProvider } from "./waiter-pin";
import { CustomerFinderAccess } from "./customer-finder";
import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/client";
import { Toaster } from "@/components/ui/sonner";
import { clientCatalog, getT } from "@/i18n/server";
import { toLocale, DEFAULT_LOCALE, LOCALE_META } from "@/i18n/config";
import { LanguageSwitch } from "@/components/i18n/language-switch";

/**
 * The one staff application shell (sidebar, top bar, auth gate) used by
 * /staff, /admin, /manager and /reception — a single app with one login.
 * Soft light design: floating rounded sidebar and top bar; on phones a
 * floating bottom tab bar replaces the sidebar.
 */
export async function StaffShell({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const pathname = (await headers()).get("x-pathname") ?? "";
  // A person chooses their own password at first sign-in; the restaurant screen's login is the MD's own — never asked.
  if (user.mustChangePassword && !isRestaurantDevice(user.permissions) && !pathname.startsWith("/staff/account")) {
    redirect("/staff/account?first=1");
  }

  // Stock requests to review and purchases to approve: counted for the managers who decide them.
  const reviewsStock = can(user, "expenses.approve");
  const [settings, today, newRequests, newStock, myShift] = await Promise.all([
    getSettings(), businessToday(), can(user, "booking_requests.view") ? newRequestCount() : Promise.resolve(0),
    reviewsStock ? newStockRequestCount() : Promise.resolve(0),
    needsOwnShift(user.permissions) ? getMyOpenShift(user.id) : Promise.resolve(undefined),
  ]);
  // A receptionist without their own open shift: a small reminder in the top bar (the pages themselves are gated in auth.ts).
  const noShift = myShift === null && !pathname.startsWith("/staff/start-shift");
  const home = staffHome(user.permissions);
  // The shared restaurant screen (one login for the restaurant) — it signs out like any account.
  const device = isRestaurantDevice(user.permissions);
  const grouped = visibleNav(user.permissions, { badges: { "/staff/booking-requests": newRequests, "/staff/stock-requests": newStock }, home });
  // The main restaurant screen: one plain list under Home — no "Finance" or "Restaurant & Bar" headings —
  // ending with Collections, then Customers.
  const LAST = ["/staff/collections", "/staff/guests"];
  const flat = grouped.flatMap((s) => s.items);
  // A waiter's own account: the same one plain list (no "Restaurant & Bar" heading), names from short to long
  // (owner, 2026-10-04) — no History for them: managers and the MD see each waiter's history on the Waiters page.
  const waiterList = flat.filter((i) => i.href !== "/staff/restaurant/history").map((item, n) => ({ item, n }))
    .sort((a, b) => a.item.label.length - b.item.label.length || a.n - b.n).map((x) => x.item);
  // Reception (not management): the desk's own work first — Finance last with Collections only, and Companies
  // with the bookings (owner, 2026-10-04: Income and Expenses are managers').
  const desk = user.permissions.has("dashboard.front_desk") && !["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => user.permissions.has(p as never));
  const deskSections = desk ? (() => {
    const finance = grouped.find((g) => g.title === "Finance");
    const companies = finance?.items.filter((i) => i.href === "/staff/corporate") ?? [];
    const rest = grouped.filter((g) => g !== finance).map((g) => (g.title === "Bookings" ? { ...g, items: [...g.items, ...companies] } : g));
    const money = finance ? { ...finance, items: finance.items.filter((i) => i.href === "/staff/collections") } : null;
    // Collections just above People (Shifts) — after the hotel's and the restaurant's work (owner, 2026-10-04).
    const people = rest.findIndex((g) => g.title === "People");
    const at = people >= 0 ? people : rest.length;
    return [...rest.slice(0, at), ...(money?.items.length ? [money] : []), ...rest.slice(at)];
  })() : null;
  const sections = deskSections ?? (device && grouped.length
    ? [{ ...grouped[0], items: [...flat.filter((i) => !LAST.includes(i.href)), ...LAST.flatMap((h) => flat.filter((i) => i.href === h))] }]
    : worksWaiterShift(user.permissions) && !device && grouped.length ? [{ ...grouped[0], items: waiterList }] : grouped);

  // This person's own language (their account) — the strings their browser needs, none for English.
  const locale = toLocale(user.locale) ?? DEFAULT_LOCALE;
  const [catalog, t] = await Promise.all([clientCatalog(locale, ["staff"]), getT()]);

  return (
    <I18nProvider locale={locale} catalog={catalog}>
    <div id="staff-root" lang={LOCALE_META[locale].html} className="dark flex min-h-svh flex-1 bg-canvas text-foreground">
      <StaffDarkMode />
      <StackTableLabels />
      <aside className="sticky top-0 hidden h-svh w-72 shrink-0 p-3 lg:block print:!hidden">
        <div className="flex h-full flex-col rounded-[1.75rem] border border-border/70 bg-card p-4 shadow-[0_2px_4px_rgba(15,23,42,0.03),0_20px_40px_-24px_rgba(15,23,42,0.25)]">
          <Link href={home} className="mb-6 flex items-center gap-3 rounded-2xl px-1 py-1">
            <Image src="/brand/logo-192.png" alt="" width={44} height={44} className="rounded-full shadow-[0_6px_14px_-6px_rgba(0,0,0,0.5)]" />
            <div className="leading-tight">
              <p className="font-display text-lg font-semibold text-foreground">{settings.hotelName}</p>
              <p className="text-[11px] text-muted-foreground">{t("Hotel management")}</p>
            </div>
          </Link>
          <div className="-mx-1 flex-1 overflow-y-auto px-1 pb-2 [scrollbar-width:thin]">
            <StaffNav sections={sections} home={home} />
          </div>
          {/* Sign out — the same plain button for everyone, the Restaurant Counter too (owner, 2026-10-04). */}
          <div className="mt-3 border-t border-dashed border-border pt-3">
            <form action={logoutAction}>
              <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-300">
                <LogOut className="size-3.5" />{t("Sign out")}
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 px-3 pt-3 lg:pl-0 print:hidden">
          <div className="flex h-16 items-center gap-3 rounded-[1.5rem] border border-border/70 bg-card/85 px-3 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:px-4">
            <Link href={home} className="shrink-0 lg:hidden"><Image src="/brand/logo-192.png" alt={settings.hotelName} width={36} height={36} className="rounded-full" /></Link>
            <div className="min-w-0 shrink">
              <p className="truncate text-sm font-semibold text-foreground"><span className="sm:hidden">{new Date(`${today}T12:00:00Z`).toLocaleDateString(t.intl, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span><span className="hidden sm:inline">{t.date(today, true)}</span></p>
              <p className="hidden text-xs text-muted-foreground sm:block">{t("Hotel day 04:00 → 04:00")}</p>
            </div>
            <div className="flex min-w-0 flex-1 justify-center">
              {can(user, "reservations.view") && <ReceptionSearch className="hidden w-full max-w-md md:block" />}
            </div>
            {/* On shift: one small pill to her shift (what she did and collected so far) */}
            {myShift && (
              <Link href={`/staff/shifts/${myShift.id}`} title={t("Your shift — what you did and collected so far")}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-500/20 dark:text-emerald-200">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /><span className="sm:hidden">{t("My shift")}</span><span className="hidden tabular-nums sm:inline">{t("On shift · since {time}", { time: t.time(myShift.startedAt, settings.timezone) })}</span>
              </Link>
            )}
            {noShift && (
              <Link href="/staff/start-shift" title={t("You have no active shift — start it to do reception work")}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/12 px-3 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-500/20 dark:text-amber-200">
                <Clock className="size-3.5" /><span className="sm:hidden">{t("Start shift")}</span><span className="hidden sm:inline">{t("No active shift · Start")}</span>
              </Link>
            )}
            {/* EN | 中文 — this person's own language (saved on their account; nobody else's changes). */}
            <LanguageSwitch staff tone="light" languages={settings.enabledLanguages} className="shrink-0" />
            <a href="/" target="_blank" rel="noopener" title={t("The hotel website (opens in a new tab)")} aria-label={t("The hotel website (opens in a new tab)")}
              className="hidden size-10 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:grid">
              <Globe className="size-4" />
            </a>
            {/* The bell: rings for what is waiting for this person (bookings, requests, orders, bills…) on every page */}
            <StaffAlerts sound={{ enabled: settings.orderSoundsEnabled, volume: settings.orderSoundVolume, newSound: settings.newOrderSound, readySound: settings.readyOrderSound }}
              soundOff={user.soundOff} />
            <Link href="/staff/account" title={t("{name} · {role} — your account", { name: user.fullName, role: t(user.roleName) })} aria-label={t("Your account — {name}, {role}", { name: user.fullName, role: t(user.roleName) })}
              className="shrink-0 rounded-full ring-2 ring-transparent transition hover:ring-border">
              <Initials name={user.fullName} className="size-10 text-xs" />
            </Link>
            <form action={logoutAction} className="hidden shrink-0 sm:block">
              <button type="submit" aria-label={t("Sign out")} title={t("Sign out")} className="grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </header>
        {/* On the shared restaurant screen, money and taking charge ask the waiter's PIN. */}
        <main className="flex-1 px-3 pb-28 pt-5 sm:px-4 lg:pb-8 lg:pl-2 lg:pr-5 print:p-0"><WaiterPinProvider device={device}><CustomerFinderAccess allowed={can(user, "guests.view")}>{children}</CustomerFinderAccess></WaiterPinProvider></main>
      </div>

      <StaffBottomBar home={home} sections={sections} requests={newRequests} canBook={can(user, "reservations.view")} user={{ name: user.fullName, role: user.roleName }} signOut />
    </div>
    <Toaster richColors position="top-center" />
    </I18nProvider>
  );
}
