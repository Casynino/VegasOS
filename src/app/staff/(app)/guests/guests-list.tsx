import Link from "next/link";
import { BedDouble, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, MessageCircle, Search, UtensilsCrossed } from "lucide-react";
import { can, getCurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { fromDbDate, toDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { internationalPhone } from "@/lib/guest-messages";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { Initials } from "@/components/dashboard/kit";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { shownName } from "./[id]/everything-with-us";

const PAGE = 40;
const LIVE: Prisma.ReservationWhereInput = { status: { notIn: ["CANCELLED", "NO_SHOW"] } };
const ORDERED: Prisma.RestaurantOrderWhereInput = { status: { not: "CANCELLED" } };
const OPEN_ORDER = ["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] as const;
/** At a table right now: their own table, or someone else's they joined. */
const AT_TABLE: Prisma.GuestWhereInput = { OR: [{ diningSessions: { some: { openAtId: { not: null } } } }, { diningMemberships: { some: { session: { openAtId: { not: null } } } } }] };

const FILTERS = [
  { key: "all", label: msg("All") },
  { key: "inhouse", label: msg("In the hotel") },
  { key: "table", label: msg("At a table now") },
  { key: "coming", label: msg("Coming") },
  { key: "restaurant", label: msg("Restaurant") },
  { key: "returning", label: msg("Returning") },
  { key: "new", label: msg("New this month") },
] as const;
type Filter = (typeof FILTERS)[number]["key"];
const SORTS = {
  "": { updatedAt: "desc" }, name: { fullName: "asc" }, "-name": { fullName: "desc" },
  stays: { reservations: { _count: "desc" } }, "-stays": { reservations: { _count: "asc" } },
  orders: { restaurantOrders: { _count: "desc" } }, "-orders": { restaurantOrders: { _count: "asc" } },
} satisfies Record<string, Prisma.GuestOrderByWithRelationInput>;
type Sort = keyof typeof SORTS;

/** Customer · Phone · Stays · Orders · Owes · Last visit · actions — fewer columns on smaller screens. */
const COLS = "grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-x-4 md:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1fr)_11.5rem] xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_11.5rem] xl:gap-x-6";

/**
 * Every customer — whoever booked a room, ordered food or sat at a table — as one tidy list that
 * stays neat with thousands of them. The phone number is the key: the same number is always the
 * same customer. Find anyone by name, phone, email, ID, G-reference or company, filter, sort,
 * and open them to see everything.
 */
export async function GuestsList({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const t = await getT();
  // "12 Oct 2026" / "2026年10月12日" — a business date without the weekday.
  const dayFmt = new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const day = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
  const filter: Filter = FILTERS.find((f) => f.key === sp.filter)?.key ?? "all";
  const sort: Sort = typeof sp.sort === "string" && sp.sort in SORTS ? (sp.sort as Sort) : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const todayStr = await businessToday();
  const today = toDbDate(todayStr);
  const monthStart = toDbDate(`${todayStr.slice(0, 7)}-01`);
  // Room balances are for reception and managers; a waiter sees what is owed at the restaurant.
  const user = await getCurrentUser();
  const roomMoney = can(user, "reservations.view") || can(user, "reports.view");

  // Came back: two stays or more, or two orders or more.
  const [repeatStays, repeatOrders] = await Promise.all([
    db.reservation.groupBy({ by: ["guestId"], where: LIVE, _count: { _all: true }, having: { guestId: { _count: { gt: 1 } } } }),
    db.restaurantOrder.groupBy({ by: ["guestId"], where: { ...ORDERED, guestId: { not: null } }, _count: { _all: true }, having: { guestId: { _count: { gt: 1 } } } }),
  ]);
  const repeatIds = [...new Set([...repeatStays.map((g) => g.guestId), ...repeatOrders.map((g) => g.guestId).filter((x): x is string => !!x)])];
  const byFilter: Record<Filter, Prisma.GuestWhereInput> = {
    all: {},
    inhouse: { reservations: { some: { status: "CHECKED_IN" } } },
    table: AT_TABLE,
    coming: { reservations: { some: { status: { in: ["RESERVED", "CONFIRMED"] }, arrivalDate: { gte: today } } } },
    restaurant: { restaurantOrders: { some: ORDERED } },
    returning: { id: { in: repeatIds } },
    new: { createdAt: { gte: monthStart } },
  };
  const digits = q.replace(/\D/g, "");
  const search: Prisma.GuestWhereInput = q ? {
    OR: [
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { idNumber: { contains: q, mode: "insensitive" } },
      { corporateCustomer: { companyName: { contains: q, mode: "insensitive" } } },
      ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-9) } }, { altPhone: { contains: digits.slice(-9) } }] : []),
      ...(/^(g-?)?[0-9a-f]{4,6}$/i.test(q) ? [{ reference: { contains: q.replace(/^g-?/i, "").toUpperCase() } }] : []),
    ],
  } : {};
  const where: Prisma.GuestWhereInput = { AND: [{ deletedAt: null }, byFilter[filter], search] };

  const [guests, total, counts] = await Promise.all([
    db.guest.findMany({
      where, orderBy: [SORTS[sort], { createdAt: "desc" }], take: PAGE, skip: (page - 1) * PAGE,
      include: {
        corporateCustomer: { select: { companyName: true } },
        _count: { select: { restaurantOrders: { where: ORDERED } } },
        restaurantOrders: { where: ORDERED, orderBy: { createdAt: "desc" }, take: 3, select: { createdAt: true, status: true } },
        reservations: {
          where: LIVE, orderBy: { arrivalDate: "desc" },
          select: { id: true, status: true, billTo: true, arrivalDate: true, departureDate: true, balanceAmount: true, rooms: { where: { status: "CHECKED_IN" }, select: { room: { select: { number: true } } } } },
        },
        diningSessions: { where: { openAtId: { not: null } }, take: 1, select: { location: { select: { name: true } } } },
        diningMemberships: { where: { session: { openAtId: { not: null } } }, take: 1, select: { session: { select: { location: { select: { name: true } } } } } },
      },
    }),
    db.guest.count({ where }),
    Promise.all(FILTERS.map((f) => db.guest.count({ where: { AND: [{ deletedAt: null }, byFilter[f.key], search] } }))),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  // What each customer on this page still owes the restaurant (bills not on a room).
  const foodDue = roomMoney ? new Map<string, number>() : new Map((await db.restaurantOrder.groupBy({
    by: ["guestId"], where: { ...ORDERED, guestId: { in: guests.map((g) => g.id) }, settlement: { not: "ROOM" }, paymentStatus: { not: "PAID" } }, _sum: { total: true, paidAmount: true },
  })).map((x) => [x.guestId ?? "", Math.max(0, (x._sum.total ?? 0) - (x._sum.paidAmount ?? 0))]));
  const href = (params: { filter?: Filter; sort?: Sort; page?: number }) => {
    const u = new URLSearchParams();
    const f = params.filter ?? filter, so = params.sort ?? sort;
    if (f !== "all") u.set("filter", f);
    if (q) u.set("q", q);
    if (so) u.set("sort", so);
    if (params.page && params.page > 1) u.set("page", String(params.page));
    return `?${u}`;
  };
  const from = total ? (page - 1) * PAGE + 1 : 0;

  return (
    <div className="w-full space-y-4">
      <PageHeader title={t("Customers")} description={t("Everyone who has stayed, booked or ordered with us — their phone number finds them.")} />

      {/* Find */}
      <form className="rounded-2xl border border-border/70 bg-card p-3">
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        <div className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">{t("Find a customer")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input name="q" defaultValue={q} placeholder={t("Name, phone, email, ID, G-reference or company")}
              className="h-10 w-full rounded-xl border border-input bg-background/60 pl-9 pr-3 text-sm outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/30" />
          </label>
          <Button type="submit" variant="outline" className="h-10 px-4">{t("Search")}</Button>
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground">{t("Searches every customer on file, however long ago they came.")}</p>
      </form>

      {/* Groups + count */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("Customer groups")} className="flex flex-wrap gap-1.5">
          {FILTERS.map((f, i) => {
            const on = filter === f.key;
            return (
              <Link key={f.key} href={href({ filter: f.key, page: 1 })} aria-current={on ? "page" : undefined}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                  on ? "border-foreground/15 bg-foreground text-background" : "border-border/70 bg-card text-muted-foreground hover:bg-muted hover:text-foreground")}>
                {t(f.label)}<span className={cn("tabular-nums", on ? "opacity-70" : "text-muted-foreground/80")}>{counts[i]}</span>
              </Link>
            );
          })}
        </nav>
        <p className="text-xs text-muted-foreground">{total ? t.plural(total, "Showing {from}–{to} of {n} customer", "Showing {from}–{to} of {n} customers", { from, to: from + guests.length - 1 }) : t("No customers")}</p>
      </div>

      {guests.length === 0 ? (
        <EmptyState title={q ? t("No customers match \"{q}\"", { q }) : t("No customers here")} description={q ? t("Try the phone number, or part of the name.") : t("Customers are added automatically when they book or order.")} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          <div role="row" className={cn(COLS, "border-b border-border/70 bg-muted/30 px-4 py-2.5 text-xs font-semibold text-muted-foreground")}>
            <SortHead label={t("Customer")} field="name" sort={sort} href={href} />
            <span className="hidden xl:block">{t("Phone")}</span>
            <SortHead label={t("Stays")} field="stays" sort={sort} href={href} className="hidden md:flex" desc />
            <SortHead label={t("Orders")} field="orders" sort={sort} href={href} className="hidden xl:flex" desc />
            <span className="hidden text-right md:block">{roomMoney ? t("Owes") : t("Owes food")}</span>
            <span className="hidden xl:block">{t("Last visit")}</span>
            <span className="sr-only">{t("Actions")}</span>
          </div>
          <ul className="divide-y divide-border/60">
            {guests.map((g) => {
              const stays = g.reservations.length;
              const owes = roomMoney ? g.reservations.filter((r) => r.billTo === "GUEST").reduce((s, r) => s + Math.max(0, r.balanceAmount), 0) : foodDue.get(g.id) ?? 0;
              const table = g.diningSessions[0]?.location.name ?? g.diningMemberships[0]?.session.location.name ?? null;
              const here = g.reservations.find((r) => r.status === "CHECKED_IN");
              const next = [...g.reservations].reverse().find((r) => ["RESERVED", "CONFIRMED"].includes(r.status) && fromDbDate(r.arrivalDate) >= todayStr);
              const last = g.reservations.find((r) => r.status === "CHECKED_OUT");
              const lastVisit = [last ? fromDbDate(last.departureDate) : null, g.restaurantOrders[0]?.createdAt.toISOString().slice(0, 10) ?? null].filter((x): x is string => !!x).sort().at(-1);
              const ordering = g.restaurantOrders.some((o) => (OPEN_ORDER as readonly string[]).includes(o.status));
              const orders = g._count.restaurantOrders;
              const nextDay = next ? fromDbDate(next.arrivalDate) : null;
              const phone = internationalPhone(g.phone);
              return (
                <li key={g.id} className={cn(COLS, "relative px-4 py-3 transition-colors hover:bg-muted/40")}>
                  <div className="flex min-w-0 items-center gap-3">
                    <Initials name={g.fullName} className="size-9 shrink-0 text-xs" />
                    <div className="min-w-0 leading-tight">
                      <Link href={`/staff/guests/${g.id}`} className="flex items-center gap-1.5 font-medium after:absolute after:inset-0 after:content-['']">
                        <span className="truncate">{shownName(t, g.fullName)}</span>
                        {g.vip && <span className="shrink-0 rounded-full bg-[oklch(0.75_0.13_80)]/20 px-1.5 text-[9px] font-bold text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]">VIP</span>}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        <span className="font-mono">{g.reference}</span>
                        {g.corporateCustomer && <> · {g.corporateCustomer.companyName}</>}
                        <span className="xl:hidden">{g.phone && <> · {g.phone}</>}</span>
                      </p>
                    </div>
                  </div>
                  <span className="hidden truncate text-sm tabular-nums xl:block">{g.phone ?? <Dash />}</span>
                  <div className="hidden leading-tight md:block">
                    <p className="text-sm font-medium tabular-nums">{stays}</p>
                    {here ? <p className="truncate text-xs text-emerald-600 dark:text-emerald-400">{t("in house")}</p>
                      : nextDay ? <p className="truncate text-xs text-violet-600 dark:text-violet-300">{nextDay === todayStr ? t("arrives today") : t("arrives {date}", { date: t.date(nextDay) })}</p>
                      : stays > 1 ? <p className="text-xs text-amber-600 dark:text-amber-400">{t("returning")}</p> : null}
                  </div>
                  <div className="hidden leading-tight xl:block">
                    <p className="text-sm font-medium tabular-nums">{orders}</p>
                    {ordering && <p className="truncate text-xs text-amber-600 dark:text-amber-400">{t("ordering now")}</p>}
                  </div>
                  <span className={cn("hidden text-right text-sm tabular-nums md:block", owes > 0 ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{owes > 0 ? formatTZS(owes) : "—"}</span>
                  <span className="hidden text-sm text-muted-foreground xl:block">{here || table || ordering ? t("Now") : lastVisit ? day(lastVisit) : <Dash />}</span>
                  <div className="relative z-10 flex flex-wrap items-center justify-end gap-1.5">
                    {phone && (
                      <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" aria-label={t("WhatsApp {name}", { name: shownName(t, g.fullName) })} title="WhatsApp"
                        className="grid size-8 place-items-center rounded-lg border border-emerald-500/30 text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400">
                        <MessageCircle className="size-4" />
                      </a>
                    )}
                    {here && (
                      <Link href={`/staff/reservations/${here.id}`} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-emerald-500/30 px-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-300">
                        <BedDouble className="size-3.5" />{here.rooms.map((x) => x.room.number).join(", ") || t("In house")}
                      </Link>
                    )}
                    {table ? (
                      <Link href="/staff/restaurant/tables" title={t("At {place} now", { place: t(table) })} className="inline-flex h-8 min-w-0 max-w-full items-center gap-1 rounded-lg border border-amber-500/30 px-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300">
                        <UtensilsCrossed className="size-3.5 shrink-0" /><span className="truncate">{t(table)}</span>
                      </Link>
                    ) : here ? null : next && nextDay ? (
                      <Link href={`/staff/reservations/${next.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-violet-500/30 px-2 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-500/10 dark:text-violet-300">
                        <CalendarClock className="size-3.5" />{nextDay === todayStr ? t("Today") : day(nextDay)}
                      </Link>
                    ) : ordering ? (
                      <Link href="/staff/restaurant" className="inline-flex h-8 items-center gap-1 rounded-lg border border-amber-500/30 px-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"><UtensilsCrossed className="size-3.5" />{t("Order")}</Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("Page {page} of {pages}", { page, pages })}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href({ page: page - 1 })}><ChevronLeft />{t.ctx("page", "Previous")}</Link>}
            {page < pages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href({ page: page + 1 })}>{t.ctx("page", "Next")}<ChevronRight /></Link>}
          </div>
        </div>
      )}
    </div>
  );
}

const Dash = () => <span className="text-muted-foreground/60">—</span>;

/** A column heading that sorts the list — tap again to turn the order round. */
function SortHead({ label, field, sort, href, className, desc = false }: {
  label: string; field: "name" | "stays" | "orders"; sort: Sort; href: (p: { sort?: Sort; page?: number }) => string; className?: string;
  /** The first tap sorts biggest first. */
  desc?: boolean;
}) {
  const on = sort === field || sort === `-${field}`;
  const next: Sort = sort === field ? (`-${field}` as Sort) : field;
  const up = desc ? sort === `-${field}` : sort === field;
  const Icon = !on ? ChevronsUpDown : up ? ChevronUp : ChevronDown;
  return (
    <Link href={href({ sort: next, page: 1 })} className={cn("inline-flex items-center gap-1 hover:text-foreground", on && "text-foreground", className)}>
      {label}<Icon className="size-3.5" />
    </Link>
  );
}
