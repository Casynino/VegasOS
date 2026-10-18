import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { Clock, Globe, LogOut } from "lucide-react";
import { can, getMyOpenShift, requireUser } from "@/server/auth";
import { isRestaurantDevice, needsOwnShift, worksWaiterShift } from "@/lib/permissions";
import { businessToday, getSettings } from "@/server/settings";
import { newRequestCount } from "@/server/services/booking-requests";
import { newStockRequestCount } from "@/server/services/stock-requests";
import { staffHome } from "@/lib/staff-home";
import { guideBooksFor } from "@/lib/guide-books";
import { guideStorageReady, uploadedGuideFiles } from "@/server/services/guide-books";
import { GuideBookStrip } from "@/components/staff/guide-book-strip";
import { OnlyOnPath } from "@/components/staff/guide-book-strip-gate";
import { navFor } from "@/components/staff/nav-config";
import { StaffNav } from "@/components/staff/staff-nav";
import { StaffBottomBar } from "@/components/staff/bottom-bar";
import { StaffDarkMode } from "@/components/staff/theme-switch";
import { Initials } from "@/components/dashboard/kit";
import { logoutAction } from "@/app/staff/(auth)/login/actions";
import { stopWorkAsAction } from "@/app/staff/(app)/developer/access/actions";
import { IdentityBanner, IdentityCard, IdentityChip, stripVars, type Identity } from "./identity-banner";
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
import { LanguageSwitch } from "@/components/i18n/language-switch";

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
  // The person's own department guide book(s), as a slim strip on their own home page only (owner, 2026-10-19). Not in the Developer's console.
  // The layout is not drawn again when somebody moves between pages, so the page check is made in the browser (OnlyOnPath), not here.
  const guides = !consoleMode ? guideBooksFor(user.permissions) : null;
  const guideStrip = guides && guides.files.length > 0 && guideStorageReady() ? await uploadedGuideFiles().catch(() => null) : undefined;
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
    const money = finance ? { ...finance, items: finance.items.filter((i) => i.href === "/staff/collections") } : null;
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

  return (
    <I18nProvider locale={locale} catalog={catalog}>
    <QuietProvider quiet={quiet}>
    <div id="staff-root" lang={LOCALE_META[locale].html} className={cn("dark flex min-h-svh flex-1 flex-col bg-canvas text-foreground", stripVars(identity))}>
      {/* A Developer: one unmistakable strip across every page (nothing for staff) — while working as someone, a taller one that says whom,
          for how long, and has Stop. Its height is the offset of the sticky parts below. */}
      <IdentityBanner identity={identity} t={t} stopWorkAs={stopWorkAsAction} now={new Date()} />
      <div className="flex min-w-0 flex-1">
      <StaffDarkMode />
      <StackTableLabels />
      <aside className="sticky top-[var(--dev-strip,0px)] hidden h-[calc(100svh-var(--dev-strip,0px))] w-72 shrink-0 p-3 lg:block print:!hidden">
        <div className="flex h-full flex-col rounded-[1.75rem] border border-border/70 bg-card p-4 shadow-[0_2px_4px_rgba(15,23,42,0.03),0_20px_40px_-24px_rgba(15,23,42,0.25)]">
          <Link href={home} className="mb-6 flex items-center gap-3 rounded-2xl px-1 py-1">
            <Image src="/brand/logo-192.png" alt="" width={44} height={44} className="rounded-full shadow-[0_6px_14px_-6px_rgba(0,0,0,0.5)]" />
            <div className="leading-tight">
              <p className="font-display text-lg font-semibold text-foreground">{settings.hotelName}</p>
              <p className="text-[11px] text-muted-foreground">{t("Hotel management")}</p>
            </div>
          </Link>
          <div className="-mx-1 flex-1 overflow-y-auto px-1 pb-2 [scrollbar-width:thin]">
            <StaffNav sections={sections} home={consoleMode ? undefined : home} />
          </div>
          {/* Sign out — the same plain button for everyone, the Restaurant Counter too (owner, 2026-10-04). */}
          <div className="mt-3 space-y-2.5 border-t border-dashed border-border pt-3">
            {/* Who is signed in, at laptop width where the top bar shows the name only (from xl the top bar shows name and role). */}
            <IdentityCard identity={identity} t={t} className={consoleMode ? "xl:flex" : undefined}><Initials name={user.fullName} className={cn("size-9 text-xs", developer && "ring-2 ring-fuchsia-500")} /></IdentityCard>
            {/* The Developer's console keeps the language switch here too (name, role, language, sign out — like ORA's console). */}
            {consoleMode && <LanguageSwitch staff tone="light" languages={settings.enabledLanguages} className="w-full" />}
            <form action={logoutAction}>
              <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-300">
                <LogOut className="size-3.5" />{t("Sign out")}
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-[var(--dev-strip,0px)] z-30 px-3 pt-3 lg:pl-0 print:hidden">
          <div className="flex h-16 items-center gap-3 rounded-[1.5rem] border border-border/70 bg-card/85 px-3 shadow-[0_10px_30px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:px-4">
            <Link href={home} className="shrink-0 lg:hidden"><Image src="/brand/logo-192.png" alt={settings.hotelName} width={36} height={36} className="rounded-full" /></Link>
            <div className="min-w-0 shrink">
              <p className="truncate text-sm font-semibold text-foreground"><span className="sm:hidden">{new Date(`${today}T12:00:00Z`).toLocaleDateString(t.intl, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span><span className="hidden sm:inline">{t.date(today, true)}</span></p>
              <p className="hidden text-xs text-muted-foreground sm:block">{t("Hotel day 04:00 → 04:00")}</p>
            </div>
            <div className="flex min-w-0 flex-1 justify-center">
              {!consoleMode && can(user, "reservations.view") && <ReceptionSearch className="hidden w-full max-w-md md:block" />}
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
            {/* EN | 中文 — this person's own language (saved on their account; nobody else's changes). Not while a Developer works as someone: it would change THEIR account. */}
            {!workAs && <LanguageSwitch staff tone="light" languages={settings.enabledLanguages} className={cn("shrink-0", consoleMode && "lg:hidden")} />}
            <a href="/" target="_blank" rel="noopener" title={t("The hotel website (opens in a new tab)")} aria-label={t("The hotel website (opens in a new tab)")}
              className="hidden size-10 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:grid">
              <Globe className="size-4" />
            </a>
            {/* The bell: rings for what is waiting for this person (bookings, requests, orders, bills…) on every page. Not drawn for a Developer (quiet). */}
            <StaffAlerts sound={{ enabled: settings.orderSoundsEnabled, volume: settings.orderSoundVolume, newSound: settings.newOrderSound, readySound: settings.readyOrderSound }}
              soundOff={user.soundOff} quiet={quiet} />
            {/* Who is signed in: the real name and role, always. Top bar: name + role from xl, the name alone at lg (role in the tooltip and the side menu's card), hidden below lg — the bottom bar's Menu shows both on a tablet and a phone. */}
            {/* While a Developer works as someone, this shows that person and goes nowhere: their account page is theirs. */}
            {workAs ? (
              <div title={t("{name} · {role} — your account", { name: user.fullName, role: t(user.roleName) })} className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-full">
                <Initials name={user.fullName} className="size-10 text-xs ring-2 ring-fuchsia-500" />
                <IdentityChip identity={identity} t={t} className="pr-2" />
              </div>
            ) : (
              <Link href="/staff/account" title={t("{name} · {role} — your account", { name: user.fullName, role: t(user.roleName) })} aria-label={t("Your account — {name}, {role}", { name: user.fullName, role: t(user.roleName) })}
                className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-full ring-2 ring-transparent transition hover:ring-border">
                <Initials name={user.fullName} className={cn("size-10 text-xs", developer && "ring-2 ring-fuchsia-500")} />
                <IdentityChip identity={identity} t={t} className="pr-2" />
              </Link>
            )}
            <form action={logoutAction} className="hidden shrink-0 sm:block">
              <button type="submit" aria-label={t("Sign out")} title={t("Sign out")} className="grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </header>
        {/* On the shared restaurant screen, money and taking charge ask the waiter's PIN. */}
        <main className="flex-1 px-3 pb-28 pt-5 sm:px-4 lg:pb-8 lg:pl-2 lg:pr-5 print:p-0">{guides && guideStrip !== undefined && <OnlyOnPath path={home}><GuideBookStrip t={t} access={guides} uploaded={guideStrip} /></OnlyOnPath>}<WaiterPinProvider device={device}><CustomerFinderAccess allowed={!consoleMode && can(user, "guests.view")}>{children}</CustomerFinderAccess></WaiterPinProvider></main>
      </div>

      <StaffBottomBar home={home} sections={sections} requests={newRequests} canBook={!consoleMode && can(user, "reservations.view")} console={consoleMode}
        user={{ name: user.fullName, role: user.roleName, developer, workAs: !!workAs }} signOut />
      </div>
    </div>
    {/* After a check-out done in place: the thank-you message, ready to send (opened by showCheckoutThanks). */}
    <CheckoutThanksHost />
    <Toaster richColors position="top-center" />
    </QuietProvider>
    </I18nProvider>
  );
}
