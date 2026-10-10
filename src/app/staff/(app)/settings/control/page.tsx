import type { Metadata } from "next";
import Link from "next/link";
import {
  Armchair, BedDouble, BookOpenText, Boxes, ChefHat, ChevronRight, ClipboardList, FileChartColumn, Globe, History, Hotel, KeyRound, Landmark, Languages, Layers, Bell,
  NotebookText, Percent, QrCode, ScrollText, ShieldCheck, Sofa, Tags, UserCheck, UserCog, type LucideIcon,
} from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { addDays, toDbDate } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";
import { LOCALE_META, isLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Control centre") };
}

type Row = { href: string; icon: LucideIcon; title: string; sub: string; stat?: string; warn?: boolean; show: boolean };

/**
 * The MD's control centre — the system and the business rules in one place: people and
 * permissions, business settings, money set-up, rooms and restaurant set-up, the stores and
 * assets, and the records that keep everyone honest. Managers run the day; this is where the
 * hotel is configured and governed.
 */
export default async function ControlCentrePage() {
  const user = await requirePagePermission("settings.manage", "users.manage", "inventory.manage");
  const t = await getT();
  const today = await businessToday();
  const s = await getSettings();
  const [users, roles, perms, auditToday, accounts, expenseTypes, promos, rooms, roomTypes, tables, menuItems, menuCats, stock, invCats, invDepts, suppliers, recipes, assets, lastReport] = await Promise.all([
    db.user.count({ where: { isActive: true } }), db.role.count(), db.permission.count(),
    db.auditLog.count({ where: { businessDate: toDbDate(today) } }),
    db.moneyAccount.count({ where: { isActive: true } }), db.expenseCategory.count({ where: { isActive: true } }), db.promotion.count({ where: { isActive: true } }),
    db.room.count({ where: { isActive: true } }), db.roomType.count(),
    db.restaurantLocation.count({ where: { isActive: true } }),
    db.menuItem.count({ where: { isActive: true } }), db.menuCategory.count(),
    db.inventoryItem.count({ where: { isActive: true } }), db.inventoryCategory.count({ where: { isActive: true } }), db.inventoryDepartment.count({ where: { isActive: true } }),
    db.supplier.count({ where: { isActive: true } }),
    db.recipeLine.groupBy({ by: ["menuItemId"] }).then((x) => x.length),
    db.asset.count({ where: { status: { notIn: ["DISPOSED", "LOST"] } } }),
    db.dailyReport.findFirst({ orderBy: { businessDate: "desc" }, select: { deliveries: { select: { status: true } } } }),
  ]);
  // The Hotel QR: codes working now and bookings made from it in the last 30 days.
  const [qrCodes, qrBookings30] = can(user, "hotel_qr.manage") ? await Promise.all([
    db.bookingQrCode.count({ where: { isActive: true, active: true } }),
    db.reservation.count({ where: { source: { code: "HOTEL_QR" }, businessDate: { gte: toDbDate(addDays(today, -29)) } } }),
  ]) : [0, 0];
  const recipients = Array.isArray(s.reportRecipients) ? s.reportRecipients.length : 0;
  const tax = s.taxRatePercent ? `${s.taxName || t("Tax")} ${Number(s.taxRatePercent)}%${s.taxIncludedInRates ? ` ${t("incl.")}` : ""}` : t("Not set");
  const reportFailed = lastReport?.deliveries.some((d) => d.status === "FAILED") ?? false;
  const differentApprover = s.purchaseApproverMustDiffer ? t("Different approver: on") : t("Different approver: off");
  // The languages guests are offered (each person picks their own on their account).
  const languages = s.enabledLanguages.filter(isLocale).map((l) => LOCALE_META[l].label).join(" · ");

  const groups: { title: string; sub: string; rows: Row[] }[] = [
    {
      title: t("People & access"), sub: t("Who can sign in and what each role may do"),
      rows: [
        { href: "/staff/users", icon: UserCog, title: t("Staff accounts"), sub: t("Add staff, reset passwords, switch accounts off"), stat: t("{n} active", { n: users }), show: can(user, "users.manage") },
        { href: "/staff/users", icon: KeyRound, title: t("Roles & permissions"), sub: t("What reception, waiters, the Mpishi, managers can do"), stat: t("{roles} roles · {perms} rights", { roles, perms }), show: can(user, "users.manage") },
        { href: "/staff/activity", icon: ScrollText, title: t("Audit history"), sub: t("Every important action — who, what, old → new, why, when"), stat: t("{n} today", { n: auditToday }), show: can(user, "staff.activity.view") },
      ],
    },
    {
      title: t("Business settings"), sub: t("How the hotel works"),
      rows: [
        { href: "/staff/settings", icon: Hotel, title: t("Hotel details & policies"), sub: t("Name, contacts, check-in/out times, hotel day, booking rules"), show: can(user, "settings.manage") },
        { href: "/staff/settings/languages", icon: Languages, title: t("Languages"), sub: t("English and Chinese for guests; rooms, menu and services in each language"), stat: languages, show: can(user, "settings.manage") },
        { href: "/staff/settings#taxName", icon: Percent, title: t("Tax / VAT"), sub: t("Name and rate shown on bills and invoices"), stat: tax, show: can(user, "settings.manage") },
        { href: "/staff/settings#reportRecipients", icon: Bell, title: t("Notifications"), sub: t("Daily report at 21:00, who receives it, guest messages"), stat: recipients ? t.plural(recipients, "{n} recipient", "{n} recipients") : t("No recipients"), warn: !recipients || reportFailed, show: can(user, "settings.manage") },
        { href: "/staff/website", icon: Globe, title: t("Website"), sub: t("Pages, photos and hotel services online"), show: can(user, "website.manage") },
      ],
    },
    {
      title: t("Money set-up"), sub: t("Prices, where money goes, what it is spent on"),
      rows: [
        { href: "/staff/settings/pricing", icon: Tags, title: t("Room pricing & promotions"), sub: t("Prices per room type, seasons, discounts"), stat: t.plural(promos, "{n} promotion on", "{n} promotions on"), show: can(user, "pricing.manage") },
        { href: "/staff/finance/accounts", icon: Landmark, title: t("Payment accounts"), sub: t("Cash, M-Pesa, bank — where each payment lands"), stat: t("{n} accounts", { n: accounts }), show: can(user, "finance.view") || can(user, "ledger.view") },
        { href: "/staff/settings/expenses", icon: Layers, title: t("Expense types"), sub: t("Categories staff choose when they spend"), stat: t("{n} types", { n: expenseTypes }), show: can(user, "settings.manage") },
        { href: "/staff/stock-requests", icon: ClipboardList, title: t("Stock purchasing"), sub: t("Requests reviewed, bought, then approved — one expense each"), stat: differentApprover, show: can(user, "expenses.approve") || can(user, "settings.manage") },
        { href: "/staff/settings#purchaseApproverMustDiffer", icon: UserCheck, title: t("Who approves a purchase"), sub: t("Whether the buyer may give their own purchase the final approval"), stat: s.purchaseApproverMustDiffer ? t("Someone else") : t("Any manager"), show: can(user, "settings.manage") },
        { href: "/staff/finance/history", icon: History, title: t("Financial corrections"), sub: t("Every changed payment or charge, with the reason"), show: can(user, "finance.view") },
      ],
    },
    {
      title: t("Rooms & restaurant"), sub: t("What the hotel sells"),
      rows: [
        { href: "/staff/rooms/manage", icon: BedDouble, title: t("Rooms & room types"), sub: t("Add rooms, types, photos and amenities"), stat: t("{rooms} rooms · {types} types", { rooms, types: roomTypes }), show: can(user, "rooms.manage") },
        { href: "/staff/restaurant/menu", icon: BookOpenText, title: t("Menu & categories"), sub: t("Dishes, drinks, prices and photos"), stat: t("{items} items · {categories} categories", { items: menuItems, categories: menuCats }), show: can(user, "restaurant.menu") },
        { href: "/staff/restaurant/tables", icon: Armchair, title: t("Tables & table QR codes"), sub: t("Add or switch off tables; print their QR cards"), stat: t("{n} places", { n: tables }), show: can(user, "restaurant.menu") || can(user, "restaurant.orders") },
        { href: "/staff/rooms/qr", icon: QrCode, title: t("Room QR codes"), sub: t("The card in each room for ordering and the guest's stay"), show: can(user, "rooms.view") },
        { href: "/staff/hotel-qr", icon: QrCode, title: t("Hotel booking QR"), sub: t("The card guests scan to book a room and pay — codes, switches, numbers"), stat: `${s.hotelQrEnabled ? t("Booking on") : t("Booking off")} · ${t.plural(qrCodes, "{n} code", "{n} codes")} · ${t.plural(qrBookings30, "{n} booking (30 days)", "{n} bookings (30 days)")}`, warn: !s.hotelQrEnabled || qrCodes === 0, show: can(user, "hotel_qr.manage") },
      ],
    },
    {
      title: t("Stores & assets"), sub: t("Stock structure and the hotel's property"),
      rows: [
        { href: "/staff/inventory?v=setup", icon: Boxes, title: t("Inventory set-up"), sub: t("Departments, categories, suppliers, units"), stat: t("{items} items · {categories} categories · {departments} departments · {suppliers} suppliers", { items: stock, categories: invCats, departments: invDepts, suppliers }), show: can(user, "inventory.manage") },
        { href: "/staff/inventory?v=recipes", icon: ChefHat, title: t("Recipes"), sub: t("What each dish takes from the stores when sold"), stat: t("{done} of {total} dishes", { done: recipes, total: menuItems }), show: can(user, "inventory.manage") },
        { href: "/staff/assets", icon: Sofa, title: t("Assets"), sub: t("Furniture, equipment and electronics — where, condition, moves"), stat: t("{n} records", { n: assets }), show: can(user, "assets.view") },
      ],
    },
    {
      title: t("Reports & oversight"), sub: t("What the Boss and management read"),
      rows: [
        { href: "/staff/reports", icon: FileChartColumn, title: t("Reports centre"), sub: t("Sales, payments, outstanding, stock & waste, staff… print or PDF"), show: can(user, "reports.view") },
        { href: "/staff/reports/daily", icon: NotebookText, title: t("Daily business reports"), sub: t("Made automatically at 21:00 and sent to the Boss"), stat: reportFailed ? t("Last send failed") : undefined, warn: reportFailed, show: can(user, "reports.view") },
      ],
    },
  ];

  return (
    <div className="w-full space-y-4">
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex min-w-0 items-center gap-3.5 px-4 py-4 sm:px-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-slate-500 to-slate-800 text-white shadow-[0_10px_24px_-12px_rgb(30_41_59)]"><ShieldCheck className="size-6" /></span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t("Control centre")} · {t(user.roleName)}</p>
            <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{t("The system & the business rules")}</h1>
            <p className="text-xs text-muted-foreground">{t("Staff do the work, managers run the day — here the hotel is set up and governed. Every change is recorded.")}</p>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {groups.map((g) => {
          const rows = g.rows.filter((r) => r.show);
          if (!rows.length) return null;
          return (
            <section key={g.title} className="overflow-hidden rounded-3xl border border-border/70 bg-card">
              <p className="border-b border-border/70 px-4 py-3 text-sm font-semibold">{g.title}<span className="font-normal text-muted-foreground"> · {g.sub}</span></p>
              <ul className="divide-y divide-border/50">
                {rows.map((r) => (
                  <li key={r.title}>
                    <Link href={r.href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-muted [&_svg]:size-4", r.warn && "bg-amber-500/15 text-amber-600")}><r.icon /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{r.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{r.sub}</span>
                      </span>
                      {r.stat && <span className={cn("hidden max-w-[45%] truncate text-right text-[11px] tabular-nums sm:block", r.warn ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{r.stat}</span>}
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
