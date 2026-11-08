import Link from "next/link";
import { cookies, headers } from "next/headers";
import { Clock } from "lucide-react";
import { can, getMyOpenShift, requireUser } from "@/server/auth";
import { isRestaurantDevice, needsOwnShift, worksWaiterShift } from "@/lib/permissions";
import { businessToday, getSettings } from "@/server/settings";
import { newRequestCount } from "@/server/services/booking-requests";
import { newStockRequestCount } from "@/server/services/stock-requests";
import { staffHome } from "@/lib/staff-home";
import { navFor } from "@/components/staff/nav-config";
import { PhoneMenuButton, PhoneMenuProvider } from "@/components/staff/phone-menu";
import { MobileBack } from "@/components/staff/mobile-back";
import { StaffFrame } from "@/components/staff/staff-frame";
import { AtWidth } from "@/components/staff/at-width";
import type { SidebarProps } from "@/components/staff/glass-sidebar";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { StaffBottomBar } from "@/components/staff/bottom-bar";
import { StaffDarkMode } from "@/components/staff/theme-switch";
import { stopWorkAsAction } from "@/app/staff/(app)/developer/access/actions";
import { IdentityBanner, stripVars, type Identity } from "./identity-banner";
import { cn } from "@/lib/utils";
import { ReceptionSearch } from "./reception/search";
import { StaffAlerts } from "./staff-alerts";
import { QuietProvider } from "./quiet";
import { sessionIsQuiet } from "@/lib/quiet";
import { StackTableLabels } from "./stack-table-labels";
import { WaiterPinProvider } from "./waiter-pin";
import { CustomerFinderAccess } from "./customer-finder";
import { CheckoutThanksHost } from "./reception/checkout-thanks";
import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/client";
import { Toaster } from "@/components/ui/sonner";
import { clientCatalog, getT } from "@/i18n/server";
import { toLocale, DEFAULT_LOCALE, LOCALE_META } from "@/i18n/config";

/**
 * The one staff application shell (sidebar, top bar, auth gate) used by
 * /staff, /admin, /manager and /reception — a single app with one login.
 * Soft light design: floating rounded sidebar and top bar; on phones a
 * floating bottom tab bar replaces the sidebar.
 */
export async function StaffShell({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // Who is signed in — from the session (the account's role in the database), never from the page or the browser.
  // While a Developer works as someone, name and role are THAT person's (what the Developer sees is exactly their screen) and
  // `workAs` says who is really signed in and since when — the strip on every page is drawn from it.
  const workAs = user.workAs;
  const identity: Identity = { actorType: user.actorType, name: user.fullName, role: user.roleName, workAs: workAs ? { developerName: user.actorName, startedAt: workAs.startedAt } : undefined };
  const developer = identity.actorType === "DEVELOPER";
  // A Developer's session is a QUIET one — in its console and while working as someone: no bell, no polling, no page that refreshes itself
  // (each would count as use and keep the 30-minute idle rule from ever ending the session). See src/lib/quiet.ts.
  const quiet = sessionIsQuiet(user);
  // A Developer signed in as itself lives in its console: its own menu, none of the hotel's desks, counters or searches.
  const consoleMode = developer && !workAs;
  const pathname = (await headers()).get("x-pathname") ?? "";
  // Stock requests to review and purchases to approve: counted for the managers who decide them.
  const reviewsStock = !consoleMode && can(user, "expenses.approve");
  const [settings, today, newRequests, newStock, myShift] = await Promise.all([
    getSettings(), businessToday(), !consoleMode && can(user, "booking_requests.view") ? newRequestCount() : Promise.resolve(0),
    reviewsStock ? newStockRequestCount() : Promise.resolve(0),
    !consoleMode && needsOwnShift(user.permissions) ? getMyOpenShift(user.id) : Promise.resolve(undefined),
  ]);
  // A receptionist without their own open shift: a small reminder in the top bar (the pages themselves are gated in auth.ts).
  // Not while a Developer works as them: the shift gate is skipped then, and the Developer starts no shift for anybody.
  const noShift = !workAs && myShift === null && !pathname.startsWith("/staff/start-shift");
  const home = staffHome(user.permissions);
  // The shared restaurant screen (one login for the restaurant) — it signs out like any account.
  const device = isRestaurantDevice(user.permissions);
  const grouped = navFor(user, { badges: { "/staff/booking-requests": newRequests, "/staff/stock-requests": newStock }, home });
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
  const desk = !consoleMode && user.permissions.has("dashboard.front_desk") && !["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => user.permissions.has(p as never));
  const deskSections = desk ? (() => {
    const finance = grouped.find((g) => g.title === "Finance");
    const companies = finance?.items.filter((i) => i.href === "/staff/corporate") ?? [];
    const rest = grouped.filter((g) => g !== finance).map((g) => (g.title === "Bookings" ? { ...g, items: [...g.items, ...companies] } : g));
    const money = finance ? { ...finance, items: finance.items.filter((i) => i.href === "/staff/collections" || i.href === "/staff/expenses") } : null;
    // Collections just above People (Shifts) — after the hotel's and the restaurant's work (owner, 2026-10-04).
    const people = rest.findIndex((g) => g.title === "People");
    const at = people >= 0 ? people : rest.length;
    return [...rest.slice(0, at), ...(money?.items.length ? [money] : []), ...rest.slice(at)];
  })() : null;
  const sections = consoleMode ? grouped : deskSections ?? (device && grouped.length
    ? [{ ...grouped[0], items: [...flat.filter((i) => !LAST.includes(i.href)), ...LAST.flatMap((h) => flat.filter((i) => i.href === h))] }]
    : worksWaiterShift(user.permissions) && !device && grouped.length ? [{ ...grouped[0], items: waiterList }] : grouped);

  // This person's own language (their account) — the strings their browser needs, none for English.
  const locale = toLocale(user.locale) ?? DEFAULT_LOCALE;
  const [catalog, t] = await Promise.all([clientCatalog(locale, ["staff"]), getT()]);

  // The side menu (a computer's floating panel and the phone's drawer): the same panel, the same words.
  // Folded to the icon rail by default (owner, 2026-11-08): the menu opens only when the person opens it, and then stays as they left it.
  const sidebarFolded = (await cookies()).get(SIDEBAR_COOKIE)?.value !== "open";
  const sidebar: SidebarProps = {
    sections, home: consoleMode ? undefined : home, find: !consoleMode && can(user, "reservations.view"), hotelName: settings.hotelName,
    user: { name: user.fullName, role: user.roleName, developer, workAs: !!workAs },
    // The receptionist's own shift as one small line under the search (the top bar of a phone has it too).
    shift: myShift ? { href: `/staff/shifts/${myShift.id}`, label: t("On shift · since {time}", { time: t.time(myShift.startedAt, settings.timezone) }), on: true }
      : noShift ? { href: "/staff/start-shift", label: t("No active shift · Start"), on: false } : null,
    languages: settings.enabledLanguages,
  };
  // The bell rings for what is waiting for this person (bookings, requests, orders, bills…) on every page. Not drawn for a Developer (quiet).
  // ONE live bell: in the top bar of a phone, in the side menu of a computer (AtWidth mounts only the one that is on screen).
  const bell = <StaffAlerts sound={{ enabled: settings.orderSoundsEnabled, volume: settings.orderSoundVolume, newSound: settings.newOrderSound, readySound: settings.readyOrderSound }} soundOff={user.soundOff} quiet={quiet} />;

  return (
    <I18nProvider locale={locale} catalog={catalog}>
    <QuietProvider quiet={quiet}>
    <PhoneMenuProvider>
    <div id="staff-root" lang={LOCALE_META[locale].html} className={cn("dark flex min-h-svh flex-1 flex-col bg-canvas text-foreground", stripVars(identity))}>
      {/* A Developer: one unmistakable strip across every page (nothing for staff) — while working as someone, a taller one that says whom,
          for how long, and has Stop. Its height is the offset of the sticky parts below. */}
      <IdentityBanner identity={identity} t={t} stopWorkAs={stopWorkAsAction} now={new Date()} />
      <div className="flex min-w-0 flex-1">
      <StaffDarkMode />
      <StackTableLabels />
      <StaffFrame initialCollapsed={sidebarFolded} sidebar={sidebar} bell={bell}>
        {/* THE TOP BAR, on a phone and a tablet only (owner, 2026-11-08, as in his Target console): a floating rounded bar with the menu button, the date and the bell.
            A computer has none — its side menu holds the search, the bell, the language, the account and Sign out. */}
        <header className="sticky top-0 z-30 px-3 pt-3 lg:hidden print:hidden">
          <div className="flex h-14 items-center gap-3 rounded-[1.5rem] border border-border/70 bg-card/85 px-3 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:px-4">
            <PhoneMenuButton label={t("Open menu")} />
            <div className="min-w-0 max-md:flex-1 shrink">
              {/* A department's home shows the date; every other page shows "‹ Back" (a phone has no back button of its own in an app or a link). */}
              <MobileBack home={home} roots={[home, "/staff", "/staff/developer", "/staff/start-shift"]} owner={user.actorId} label={t("Back")}>
                <p className="truncate text-sm font-semibold text-foreground"><span className="sm:hidden">{new Date(`${today}T12:00:00Z`).toLocaleDateString(t.intl, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span><span className="hidden sm:inline">{t.date(today, true)}</span></p>
                <p className="hidden text-xs text-muted-foreground sm:block">{t("Hotel day 04:00 → 04:00")}</p>
              </MobileBack>
            </div>
            <div className="flex min-w-0 flex-1 justify-center max-md:hidden">
              {!consoleMode && can(user, "reservations.view") && <ReceptionSearch className="w-full max-w-md" />}
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
            <AtWidth wide={false}>{bell}</AtWidth>
          </div>
        </header>
        {/* On the shared restaurant screen, money and taking charge ask the waiter's PIN. */}
        <main className="flex-1 px-3 pb-[calc(7rem+var(--work-pad,0px))] pt-5 sm:px-4 lg:px-6 lg:pb-[calc(2rem+var(--work-pad,0px))] lg:pt-3 print:p-0"><WaiterPinProvider device={device}><CustomerFinderAccess allowed={!consoleMode && can(user, "guests.view")}>{children}</CustomerFinderAccess></WaiterPinProvider></main>
      </StaffFrame>

      <StaffBottomBar home={home} sidebar={sidebar} requests={newRequests} canBook={!consoleMode && can(user, "reservations.view")} console={consoleMode}
        user={{ name: user.fullName, role: user.roleName, developer, workAs: !!workAs }} />
      </div>
    </div>
    {/* After a check-out done in place: the thank-you message, ready to send (opened by showCheckoutThanks). */}
    <CheckoutThanksHost />
    <Toaster richColors position="top-center" />
    </PhoneMenuProvider>
    </QuietProvider>
    </I18nProvider>
  );
}
