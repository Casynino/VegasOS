import type { Metadata } from "next";
import Link from "next/link";
import {
  Armchair, BedDouble, BookOpenText, Boxes, ChefHat, ChevronRight, ClipboardList, FileChartColumn, Globe, History, Hotel, KeyRound, Landmark, Layers, Bell,
  NotebookText, Percent, QrCode, ScrollText, ShieldCheck, Sofa, Tags, UserCheck, UserCog, type LucideIcon,
} from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { toDbDate } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Control centre" };

type Row = { href: string; icon: LucideIcon; title: string; sub: string; stat?: string; warn?: boolean; show: boolean };

/**
 * The MD's control centre — the system and the business rules in one place: people and
 * permissions, business settings, money set-up, rooms and restaurant set-up, the stores and
 * assets, and the records that keep everyone honest. Managers run the day; this is where the
 * hotel is configured and governed.
 */
export default async function ControlCentrePage() {
  const user = await requirePagePermission("settings.manage", "users.manage", "inventory.manage");
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
  const recipients = Array.isArray(s.reportRecipients) ? s.reportRecipients.length : 0;
  const tax = s.taxRatePercent ? `${s.taxName || "Tax"} ${Number(s.taxRatePercent)}%${s.taxIncludedInRates ? " incl." : ""}` : "Not set";
  const reportFailed = lastReport?.deliveries.some((d) => d.status === "FAILED") ?? false;
  const differentApprover = `Different approver: ${s.purchaseApproverMustDiffer ? "on" : "off"}`;

  const groups: { title: string; sub: string; rows: Row[] }[] = [
    {
      title: "People & access", sub: "Who can sign in and what each role may do",
      rows: [
        { href: "/staff/users", icon: UserCog, title: "Staff accounts", sub: "Add staff, reset passwords, switch accounts off", stat: `${users} active`, show: can(user, "users.manage") },
        { href: "/staff/users", icon: KeyRound, title: "Roles & permissions", sub: "What reception, waiters, the Mpishi, managers can do", stat: `${roles} roles · ${perms} rights`, show: can(user, "users.manage") },
        { href: "/staff/activity", icon: ScrollText, title: "Audit history", sub: "Every important action — who, what, old → new, why, when", stat: `${auditToday} today`, show: can(user, "staff.activity.view") },
      ],
    },
    {
      title: "Business settings", sub: "How the hotel works",
      rows: [
        { href: "/staff/settings", icon: Hotel, title: "Hotel details & policies", sub: "Name, contacts, check-in/out times, hotel day, booking rules", show: can(user, "settings.manage") },
        { href: "/staff/settings#taxName", icon: Percent, title: "Tax / VAT", sub: "Name and rate shown on bills and invoices", stat: tax, show: can(user, "settings.manage") },
        { href: "/staff/settings#reportRecipients", icon: Bell, title: "Notifications", sub: "Daily report at 21:00, who receives it, guest messages", stat: recipients ? `${recipients} recipient${recipients === 1 ? "" : "s"}` : "No recipients", warn: !recipients || reportFailed, show: can(user, "settings.manage") },
        { href: "/staff/website", icon: Globe, title: "Website", sub: "Pages, photos and hotel services online", show: can(user, "website.manage") },
      ],
    },
    {
      title: "Money set-up", sub: "Prices, where money goes, what it is spent on",
      rows: [
        { href: "/staff/settings/pricing", icon: Tags, title: "Room pricing & promotions", sub: "Prices per room type, seasons, discounts", stat: `${promos} promotion${promos === 1 ? "" : "s"} on`, show: can(user, "pricing.manage") },
        { href: "/staff/finance/accounts", icon: Landmark, title: "Payment accounts", sub: "Cash, M-Pesa, bank — where each payment lands", stat: `${accounts} accounts`, show: can(user, "finance.view") || can(user, "ledger.view") },
        { href: "/staff/settings/expenses", icon: Layers, title: "Expense types", sub: "Categories staff choose when they spend", stat: `${expenseTypes} types`, show: can(user, "settings.manage") },
        { href: "/staff/stock-requests", icon: ClipboardList, title: "Stock purchasing", sub: "Requests reviewed, bought, then approved — one expense each", stat: differentApprover, show: can(user, "expenses.approve") || can(user, "settings.manage") },
        { href: "/staff/settings#purchaseApproverMustDiffer", icon: UserCheck, title: "Who approves a purchase", sub: "Whether the buyer may give their own purchase the final approval", stat: s.purchaseApproverMustDiffer ? "Someone else" : "Any manager", show: can(user, "settings.manage") },
        { href: "/staff/finance/history", icon: History, title: "Financial corrections", sub: "Every changed payment or charge, with the reason", show: can(user, "finance.view") },
      ],
    },
    {
      title: "Rooms & restaurant", sub: "What the hotel sells",
      rows: [
        { href: "/staff/rooms/manage", icon: BedDouble, title: "Rooms & room types", sub: "Add rooms, types, photos and amenities", stat: `${rooms} rooms · ${roomTypes} types`, show: can(user, "rooms.manage") },
        { href: "/staff/restaurant/menu", icon: BookOpenText, title: "Menu & categories", sub: "Dishes, drinks, prices and photos", stat: `${menuItems} items · ${menuCats} categories`, show: can(user, "restaurant.menu") },
        { href: "/staff/restaurant/tables", icon: Armchair, title: "Tables & table QR codes", sub: "Add or switch off tables; print their QR cards", stat: `${tables} places`, show: can(user, "restaurant.menu") || can(user, "restaurant.orders") },
        { href: "/staff/rooms/qr", icon: QrCode, title: "Room QR codes", sub: "The card in each room for ordering and the guest's stay", show: can(user, "rooms.view") },
      ],
    },
    {
      title: "Stores & assets", sub: "Stock structure and the hotel's property",
      rows: [
        { href: "/staff/inventory?v=setup", icon: Boxes, title: "Inventory set-up", sub: "Departments, categories, suppliers, units", stat: `${stock} items · ${invCats} categories · ${invDepts} departments · ${suppliers} suppliers`, show: can(user, "inventory.manage") },
        { href: "/staff/inventory?v=recipes", icon: ChefHat, title: "Recipes", sub: "What each dish takes from the stores when sold", stat: `${recipes} of ${menuItems} dishes`, show: can(user, "inventory.manage") },
        { href: "/staff/assets", icon: Sofa, title: "Assets", sub: "Furniture, equipment and electronics — where, condition, moves", stat: `${assets} records`, show: can(user, "assets.view") },
      ],
    },
    {
      title: "Reports & oversight", sub: "What the Boss and management read",
      rows: [
        { href: "/staff/reports", icon: FileChartColumn, title: "Reports centre", sub: "Sales, payments, outstanding, stock & waste, staff… print or PDF", show: can(user, "reports.view") },
        { href: "/staff/reports/daily", icon: NotebookText, title: "Daily business reports", sub: "Made automatically at 21:00 and sent to the Boss", stat: reportFailed ? "Last send failed" : undefined, warn: reportFailed, show: can(user, "reports.view") },
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">Control centre · {user.roleName}</p>
            <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">The system & the business rules</h1>
            <p className="text-xs text-muted-foreground">Staff do the work, managers run the day — here the hotel is set up and governed. Every change is recorded.</p>
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
