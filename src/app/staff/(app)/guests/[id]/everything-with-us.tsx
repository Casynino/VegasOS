import Link from "next/link";
import { BedDouble, ConciergeBell, Receipt, UtensilsCrossed, Wallet } from "lucide-react";
import type { CustomerHistory, OrderBilling } from "@/server/services/guests";
import { formatNumber, formatTZS } from "@/lib/format";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

/** "12 Oct 2026" / "2026年10月12日", and without the year — business dates (stored at UTC midnight). */
const dates = (t: T) => {
  const full = new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const short = new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", timeZone: "UTC" });
  return { day: (d: Date) => full.format(d), dayMonth: (d: Date) => short.format(d) };
};

/**
 * The service's own English wording (where an order was served, where its bill went, a room-bill line for an order)
 * in the reader's language; anything else — hotel labels, table names — through t(), which falls back to itself.
 */
function phrase(t: T, text: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^On Room (.+)'s bill$/.exec(text))) return t("On Room {room}'s bill", { room: m[1] });
  if ((m = /^Unpaid · (.+)$/.exec(text))) return t("Unpaid · {amount}", { amount: m[1] });
  if ((m = /^Room service · Order (#\S+)$/.exec(text))) return t("Room service · Order {no}", { no: m[1] });
  if ((m = /^Restaurant — (.+) · Order (#\S+)$/.exec(text))) return t("Restaurant — {table} · Order {no}", { table: t(m[1]), no: m[2] });
  if ((m = /^Restaurant · Order (#\S+)$/.exec(text))) return t("Restaurant · Order {no}", { no: m[1] });
  if ((m = /^Room (\d[\w-]*)$/.exec(text))) return t("Room {room}", { room: m[1] });
  if (text === "Pick up") return t.ctx("order", "Pick up");
  return t(text);
}
/**
 * The stand-in names saved when a customer gave no name (a table QR, a quick order) or was removed — words of ours, so
 * in the reader's language. A real name is shown exactly as it is.
 */
const STAND_IN = new Set<string>([msg("Restaurant customer"), msg("Table guest"), msg("Customer"), msg("Guest"), msg("Removed customer")]);
export const shownName = (t: T, name: string) => (STAND_IN.has(name) ? t(name) : name);

const BILL_TONE: Record<OrderBilling["tone"], string> = {
  room: "text-violet-600 dark:text-violet-300", paid: "text-emerald-600 dark:text-emerald-400",
  waiting: "text-amber-600 dark:text-amber-400", due: "text-rose-600 dark:text-rose-400",
};

/**
 * Everything this customer has had with us, in one card: Hotel · Restaurant · Room service ·
 * Payments · Charges — each a short list, newest first. Room money (room-bill payments, charges,
 * stay amounts) only for reception and managers (`roomMoney`); a waiter sees the restaurant side.
 */
export async function EverythingWithUs({ h, roomMoney, canStays }: { h: CustomerHistory; roomMoney: boolean; canStays: boolean }) {
  const t = await getT();
  const { day, dayMonth } = dates(t);
  const payments = h.payments.restaurant.length + (roomMoney ? h.payments.room.length : 0);
  // Opens on the restaurant when they ate with us (their stays are listed just above), else the hotel.
  const first = h.restaurant.orders.length || h.tables.length ? "restaurant" : h.roomService.orders.length ? "room-service" : "hotel";
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="px-4 pt-3">
        <h2 className="text-base font-semibold">{t("Everything with us")}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("Stays, tables, room service and money — each counted once.")}</p>
      </div>
      <Tabs defaultValue={first} className="gap-0">
        <div className="overflow-x-auto px-2 pb-1.5 pt-2">
          <TabsList variant="line">
            <TabsTrigger value="hotel" className="flex-none px-2.5"><BedDouble />{t("Hotel")}<Count n={h.stays.length} /></TabsTrigger>
            <TabsTrigger value="restaurant" className="flex-none px-2.5"><UtensilsCrossed />{t("Restaurant")}<Count n={h.restaurant.count} /></TabsTrigger>
            <TabsTrigger value="room-service" className="flex-none px-2.5"><ConciergeBell />{t("Room service")}<Count n={h.roomService.count} /></TabsTrigger>
            <TabsTrigger value="payments" className="flex-none px-2.5"><Wallet />{t("Payments")}<Count n={payments} /></TabsTrigger>
            {roomMoney && h.charges && <TabsTrigger value="charges" className="flex-none px-2.5"><Receipt />{t("Charges")}</TabsTrigger>}
          </TabsList>
        </div>

        {/* Hotel: their stays — booked by them, or sharing someone else's room. */}
        <TabsContent value="hotel">
          {h.stays.length === 0 ? <Empty>{t("No stays yet.")}</Empty> : (
            <ul className="divide-y divide-border/60 border-t border-border/70">
              {h.stays.slice(0, 10).map((s) => {
                const meta = RESERVATION_STATUS_META[s.status];
                const done = s.status === "CANCELLED" || s.status === "NO_SHOW";
                const title = s.rooms ? t("Room {room}", { room: s.rooms }) : s.kind === "MEETING" ? t("Meeting room") : t("Room not given yet");
                return (
                  <Row key={s.id} href={canStays ? `/staff/reservations/${s.id}` : undefined} title={title}
                    sub={[`${dayMonth(s.arrival)} → ${day(s.departure)}`, s.reference, s.bookedBy ? t("sharing — booked by {name}", { name: shownName(t, s.bookedBy) }) : null].filter(Boolean).join(" · ")}
                    end={
                      <>
                        <span className={cn("inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.className)}>{t(meta.label)}</span>
                        {roomMoney && !s.bookedBy && !done && (
                          <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                            {formatTZS(s.net)}
                            {s.billTo !== "GUEST" ? <> · {s.billTo === "GROUP" ? t("group pays") : t("company pays")}</>
                              : s.balance > 0 ? <span className="font-medium text-rose-600 dark:text-rose-400"> · {t("owes {amount}", { amount: formatNumber(s.balance) })}</span>
                              : s.net > 0 ? <span className="text-emerald-600 dark:text-emerald-400"> · {t("paid")}</span> : null}
                          </span>
                        )}
                      </>
                    } />
                );
              })}
            </ul>
          )}
        </TabsContent>

        {/* Restaurant: their visits to our tables, then their orders with where each bill went. */}
        <TabsContent value="restaurant">
          {h.tables.length + h.restaurant.orders.length === 0 ? <Empty>{t("No restaurant visits yet.")}</Empty> : (
            <>
              {h.tables.length > 0 && (
                <>
                  <Group>{t("At our tables")}</Group>
                  <ul className="divide-y divide-border/60">
                    {h.tables.map((v) => (
                      <Row key={v.id} title={<>{t(v.table)}{v.open && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-700 dark:text-amber-300">{t("Now")}</span>}</>}
                        sub={[t.dateTime(v.at), t("Session {no}", { no: v.visit }), t.plural(v.money.orders, "{n} order", "{n} orders"), v.withName ? t("with {name}", { name: shownName(t, v.withName) }) : null].filter(Boolean).join(" · ")}
                        end={
                          <>
                            <span className="block tabular-nums">{formatTZS(v.money.total)}</span>
                            <span className="block text-xs text-muted-foreground">
                              {[v.money.paid ? t("paid {amount}", { amount: formatNumber(v.money.paid) }) : null, v.money.onRoom ? t("on a room {amount}", { amount: formatNumber(v.money.onRoom) }) : null].filter(Boolean).join(" · ")}
                              {v.money.due > 0 && <span className="font-medium text-rose-600 dark:text-rose-400">{v.money.paid || v.money.onRoom ? " · " : ""}{t("due {amount}", { amount: formatNumber(v.money.due) })}</span>}
                            </span>
                          </>
                        } />
                    ))}
                  </ul>
                </>
              )}
              {h.restaurant.orders.length > 0 && (
                <>
                  <Group>{t("Orders")}{h.restaurant.count > h.restaurant.orders.length ? ` · ${t("last {n} of {total}", { n: h.restaurant.orders.length, total: h.restaurant.count })}` : ""}</Group>
                  <OrderList t={t} orders={h.restaurant.orders} />
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* Room service: brought to their room — kept apart from the restaurant's tables. */}
        <TabsContent value="room-service">
          {h.roomService.orders.length === 0 ? <Empty>{t("No room service yet.")}</Empty> : (
            <>
              {h.roomService.count > h.roomService.orders.length && <Group>{t("Last {n} of {total}", { n: h.roomService.orders.length, total: h.roomService.count })}</Group>}
              <OrderList t={t} orders={h.roomService.orders} top={h.roomService.count <= h.roomService.orders.length} />
            </>
          )}
        </TabsContent>

        {/* Payments: on their room bills, and at the restaurant — two lists, never added together. */}
        <TabsContent value="payments">
          {payments === 0 ? <Empty>{t("No payments yet.")}</Empty> : (
            <>
              {roomMoney && h.payments.room.length > 0 && (
                <>
                  <Group>{t("On their room bills")}</Group>
                  <ul className="divide-y divide-border/60">
                    {h.payments.room.map((p) => (
                      <Row key={p.id} href={canStays && p.stayId ? `/staff/reservations/${p.stayId}#money` : undefined} title={`${p.refund ? t("Refund") : t.ctx("history", "Payment")} · ${t(p.how)}`}
                        sub={[t.dateTime(p.at), p.stay, p.reference ? t("ref {reference}", { reference: p.reference }) : null].filter(Boolean).join(" · ")}
                        end={
                          <>
                            <span className={cn("block tabular-nums", p.reversed && "text-muted-foreground line-through")}>{p.refund ? "− " : ""}{formatTZS(p.amount)}</span>
                            {p.reversed ? <span className="block text-xs text-rose-600 dark:text-rose-400">{t("Reversed")}{p.why ? ` — ${p.why}` : ""}</span>
                              : p.refund ? <span className="block text-xs text-amber-600 dark:text-amber-400">{t("Given back")}</span> : null}
                          </>
                        } />
                    ))}
                  </ul>
                </>
              )}
              {h.payments.restaurant.length > 0 && (
                <>
                  <Group>{t("Paid at the restaurant")}</Group>
                  <ul className="divide-y divide-border/60">
                    {h.payments.restaurant.map((p) => (
                      <Row key={p.id} href={`/staff/restaurant/orders/${p.orderId}`} title={t("Order {no} · {place}", { no: p.order, place: phrase(t, p.place) })}
                        sub={[t.dateTime(p.at), t(p.account), p.reference ? t("ref {reference}", { reference: p.reference }) : null].filter(Boolean).join(" · ")}
                        end={
                          <>
                            <span className={cn("block tabular-nums", p.reversed && "text-muted-foreground line-through")}>{formatTZS(p.amount)}</span>
                            {p.reversed ? <span className="block text-xs text-rose-600 dark:text-rose-400">{t("Reversed")}{p.why ? ` — ${p.why.replace(/^Payment reversed:\s*/, "")}` : ""}</span>
                              : !p.confirmed ? <span className="block text-xs text-amber-600 dark:text-amber-400">{t("Waiting for reception")}</span> : null}
                          </>
                        } />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* Charges: what the stays they booked were billed, by kind — food on a room is restaurant income. */}
        {roomMoney && h.charges && (
          <TabsContent value="charges">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/70 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(h.charges.buckets).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="truncate text-xs text-muted-foreground">{t(k)}</dt>
                  <dd className={cn("text-sm font-semibold tabular-nums", !v && "text-muted-foreground")}>{formatTZS(v)}</dd>
                </div>
              ))}
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t("All charges")}</dt>
                <dd className="text-sm font-semibold tabular-nums">{formatTZS(h.charges.total)}</dd>
              </div>
            </dl>
            <p className="border-t border-border/70 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">{t("Stays they booked. Restaurant and room service on a room count as restaurant income — the room only collects them.")}</p>
            {h.charges.lines.length === 0 ? <Empty>{t("Nothing charged besides the nights.")}</Empty> : (
              <ul className="divide-y divide-border/60 border-t border-border/70">
                {h.charges.lines.map((l) => (
                  <Row key={l.key} href={l.orderId ? `/staff/restaurant/orders/${l.orderId}` : canStays ? `/staff/reservations/${l.stayId}#money` : undefined} title={l.orderId ? phrase(t, l.label) : l.label}
                    sub={[t.dateTime(l.at), l.stay, t(l.bucket)].join(" · ")} end={<span className="block tabular-nums">{formatTZS(l.amount)}</span>} />
                ))}
              </ul>
            )}
          </TabsContent>
        )}
      </Tabs>
    </section>
  );
}

type OrderRow = CustomerHistory["restaurant"]["orders"][number];

/** Orders, each with where its bill went ("On Room 305's bill", "Paid at the restaurant"…). */
function OrderList({ t, orders, top = false }: { t: T; orders: OrderRow[]; top?: boolean }) {
  return (
    <ul className={cn("divide-y divide-border/60", top && "border-t border-border/70")}>
      {orders.map((o) => (
        <Row key={o.id} href={`/staff/restaurant/orders/${o.id}`}
          title={<>{o.number} <span className="font-normal text-muted-foreground">· {t.plural(o.items, "{n} item", "{n} items")}</span></>}
          sub={[t.dateTime(o.at), phrase(t, o.place), o.visit ? t("Session {no}", { no: o.visit }) : null, o.forOther ? t("for {name}", { name: o.forOther === "another customer" ? t("another customer") : shownName(t, o.forOther) }) : null].filter(Boolean).join(" · ")}
          end={
            <>
              <span className="block tabular-nums">{formatTZS(o.total)}</span>
              <span className={cn("block text-xs font-medium", BILL_TONE[o.billing.tone])}>{o.cooking ? `${t("Cooking")} · ` : ""}{phrase(t, o.billing.text)}</span>
            </>
          } />
      ))}
    </ul>
  );
}

function Row({ href, title, sub, end }: { href?: string; title: React.ReactNode; sub: string; end: React.ReactNode }) {
  return (
    <li className={cn("relative flex items-center justify-between gap-3 px-4 py-2.5 text-sm", href && "transition-colors hover:bg-muted/40")}>
      <span className="min-w-0 leading-tight">
        {href ? <Link href={href} className="block truncate font-medium after:absolute after:inset-0 after:content-['']">{title}</Link> : <span className="block truncate font-medium">{title}</span>}
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <span className="shrink-0 text-right leading-tight">{end}</span>
    </li>
  );
}

const Group = ({ children }: { children: React.ReactNode }) => (
  <p className="border-y border-border/70 bg-muted/30 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
);
const Count = ({ n }: { n: number }) => (n ? <span className="text-xs font-normal tabular-nums text-muted-foreground">{n}</span> : null);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="border-t border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
