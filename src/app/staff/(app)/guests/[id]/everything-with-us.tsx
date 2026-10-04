import Link from "next/link";
import { BedDouble, ConciergeBell, Receipt, UtensilsCrossed, Wallet } from "lucide-react";
import type { CustomerHistory, OrderBilling } from "@/server/services/guests";
import { formatBusinessDate, formatDateTime, formatNumber, formatTZS } from "@/lib/format";
import { fromDbDate } from "@/lib/time/business-date";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const day = (d: Date) => formatBusinessDate(fromDbDate(d)).replace(/^\w+,?\s*/, "");
const dayMonth = (d: Date) => day(d).replace(/\s\d{4}$/, "");
const BILL_TONE: Record<OrderBilling["tone"], string> = {
  room: "text-violet-600 dark:text-violet-300", paid: "text-emerald-600 dark:text-emerald-400",
  waiting: "text-amber-600 dark:text-amber-400", due: "text-rose-600 dark:text-rose-400",
};

/**
 * Everything this customer has had with us, in one card: Hotel · Restaurant · Room service ·
 * Payments · Charges — each a short list, newest first. Room money (room-bill payments, charges,
 * stay amounts) only for reception and managers (`roomMoney`); a waiter sees the restaurant side.
 */
export function EverythingWithUs({ h, roomMoney, canStays }: { h: CustomerHistory; roomMoney: boolean; canStays: boolean }) {
  const payments = h.payments.restaurant.length + (roomMoney ? h.payments.room.length : 0);
  // Opens on the restaurant when they ate with us (their stays are listed just above), else the hotel.
  const first = h.restaurant.orders.length || h.tables.length ? "restaurant" : h.roomService.orders.length ? "room-service" : "hotel";
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="px-4 pt-3">
        <h2 className="text-base font-semibold">Everything with us</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Stays, tables, room service and money — each counted once.</p>
      </div>
      <Tabs defaultValue={first} className="gap-0">
        <div className="overflow-x-auto px-2 pb-1.5 pt-2">
          <TabsList variant="line">
            <TabsTrigger value="hotel" className="flex-none px-2.5"><BedDouble />Hotel<Count n={h.stays.length} /></TabsTrigger>
            <TabsTrigger value="restaurant" className="flex-none px-2.5"><UtensilsCrossed />Restaurant<Count n={h.restaurant.count} /></TabsTrigger>
            <TabsTrigger value="room-service" className="flex-none px-2.5"><ConciergeBell />Room service<Count n={h.roomService.count} /></TabsTrigger>
            <TabsTrigger value="payments" className="flex-none px-2.5"><Wallet />Payments<Count n={payments} /></TabsTrigger>
            {roomMoney && h.charges && <TabsTrigger value="charges" className="flex-none px-2.5"><Receipt />Charges</TabsTrigger>}
          </TabsList>
        </div>

        {/* Hotel: their stays — booked by them, or sharing someone else's room. */}
        <TabsContent value="hotel">
          {h.stays.length === 0 ? <Empty>No stays yet.</Empty> : (
            <ul className="divide-y divide-border/60 border-t border-border/70">
              {h.stays.slice(0, 10).map((s) => {
                const meta = RESERVATION_STATUS_META[s.status];
                const done = s.status === "CANCELLED" || s.status === "NO_SHOW";
                const title = s.rooms ? `Room ${s.rooms}` : s.kind === "MEETING" ? "Meeting room" : "Room not given yet";
                return (
                  <Row key={s.id} href={canStays ? `/staff/reservations/${s.id}` : undefined} title={title}
                    sub={[`${dayMonth(s.arrival)} → ${day(s.departure)}`, s.reference, s.bookedBy ? `sharing — booked by ${s.bookedBy}` : null].filter(Boolean).join(" · ")}
                    end={
                      <>
                        <span className={cn("inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.className)}>{meta.label}</span>
                        {roomMoney && !s.bookedBy && !done && (
                          <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                            {formatTZS(s.net)}
                            {s.billTo !== "GUEST" ? <> · {s.billTo === "GROUP" ? "group pays" : "company pays"}</>
                              : s.balance > 0 ? <span className="font-medium text-rose-600 dark:text-rose-400"> · owes {formatNumber(s.balance)}</span>
                              : s.net > 0 ? <span className="text-emerald-600 dark:text-emerald-400"> · paid</span> : null}
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
          {h.tables.length + h.restaurant.orders.length === 0 ? <Empty>No restaurant visits yet.</Empty> : (
            <>
              {h.tables.length > 0 && (
                <>
                  <Group>At our tables</Group>
                  <ul className="divide-y divide-border/60">
                    {h.tables.map((t) => (
                      <Row key={t.id} title={<>{t.table}{t.open && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-700 dark:text-amber-300">Now</span>}</>}
                        sub={[formatDateTime(t.at), `Session ${t.visit}`, `${t.money.orders} order${t.money.orders === 1 ? "" : "s"}`, t.withName ? `with ${t.withName}` : null].filter(Boolean).join(" · ")}
                        end={
                          <>
                            <span className="block tabular-nums">{formatTZS(t.money.total)}</span>
                            <span className="block text-xs text-muted-foreground">
                              {[t.money.paid ? `paid ${formatNumber(t.money.paid)}` : null, t.money.onRoom ? `on a room ${formatNumber(t.money.onRoom)}` : null].filter(Boolean).join(" · ")}
                              {t.money.due > 0 && <span className="font-medium text-rose-600 dark:text-rose-400">{t.money.paid || t.money.onRoom ? " · " : ""}due {formatNumber(t.money.due)}</span>}
                            </span>
                          </>
                        } />
                    ))}
                  </ul>
                </>
              )}
              {h.restaurant.orders.length > 0 && (
                <>
                  <Group>Orders{h.restaurant.count > h.restaurant.orders.length ? ` · last ${h.restaurant.orders.length} of ${h.restaurant.count}` : ""}</Group>
                  <OrderList orders={h.restaurant.orders} />
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* Room service: brought to their room — kept apart from the restaurant's tables. */}
        <TabsContent value="room-service">
          {h.roomService.orders.length === 0 ? <Empty>No room service yet.</Empty> : (
            <>
              {h.roomService.count > h.roomService.orders.length && <Group>Last {h.roomService.orders.length} of {h.roomService.count}</Group>}
              <OrderList orders={h.roomService.orders} top={h.roomService.count <= h.roomService.orders.length} />
            </>
          )}
        </TabsContent>

        {/* Payments: on their room bills, and at the restaurant — two lists, never added together. */}
        <TabsContent value="payments">
          {payments === 0 ? <Empty>No payments yet.</Empty> : (
            <>
              {roomMoney && h.payments.room.length > 0 && (
                <>
                  <Group>On their room bills</Group>
                  <ul className="divide-y divide-border/60">
                    {h.payments.room.map((p) => (
                      <Row key={p.id} href={canStays && p.stayId ? `/staff/reservations/${p.stayId}#money` : undefined} title={`${p.refund ? "Refund" : "Payment"} · ${p.how}`}
                        sub={[formatDateTime(p.at), p.stay, p.reference ? `ref ${p.reference}` : null].filter(Boolean).join(" · ")}
                        end={
                          <>
                            <span className={cn("block tabular-nums", p.reversed && "text-muted-foreground line-through")}>{p.refund ? "− " : ""}{formatTZS(p.amount)}</span>
                            {p.reversed ? <span className="block text-xs text-rose-600 dark:text-rose-400">Reversed{p.why ? ` — ${p.why}` : ""}</span>
                              : p.refund ? <span className="block text-xs text-amber-600 dark:text-amber-400">Given back</span> : null}
                          </>
                        } />
                    ))}
                  </ul>
                </>
              )}
              {h.payments.restaurant.length > 0 && (
                <>
                  <Group>Paid at the restaurant</Group>
                  <ul className="divide-y divide-border/60">
                    {h.payments.restaurant.map((p) => (
                      <Row key={p.id} href={`/staff/restaurant/orders/${p.orderId}`} title={`Order ${p.order} · ${p.place}`}
                        sub={[formatDateTime(p.at), p.account, p.reference ? `ref ${p.reference}` : null].filter(Boolean).join(" · ")}
                        end={
                          <>
                            <span className={cn("block tabular-nums", p.reversed && "text-muted-foreground line-through")}>{formatTZS(p.amount)}</span>
                            {p.reversed ? <span className="block text-xs text-rose-600 dark:text-rose-400">Reversed{p.why ? ` — ${p.why.replace(/^Payment reversed:\s*/, "")}` : ""}</span>
                              : !p.confirmed ? <span className="block text-xs text-amber-600 dark:text-amber-400">Waiting for reception</span> : null}
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
                  <dt className="truncate text-xs text-muted-foreground">{k}</dt>
                  <dd className={cn("text-sm font-semibold tabular-nums", !v && "text-muted-foreground")}>{formatTZS(v)}</dd>
                </div>
              ))}
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">All charges</dt>
                <dd className="text-sm font-semibold tabular-nums">{formatTZS(h.charges.total)}</dd>
              </div>
            </dl>
            <p className="border-t border-border/70 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">Stays they booked. Restaurant and room service on a room count as restaurant income — the room only collects them.</p>
            {h.charges.lines.length === 0 ? <Empty>Nothing charged besides the nights.</Empty> : (
              <ul className="divide-y divide-border/60 border-t border-border/70">
                {h.charges.lines.map((l) => (
                  <Row key={l.key} href={l.orderId ? `/staff/restaurant/orders/${l.orderId}` : canStays ? `/staff/reservations/${l.stayId}#money` : undefined} title={l.label}
                    sub={[formatDateTime(l.at), l.stay, l.bucket].join(" · ")} end={<span className="block tabular-nums">{formatTZS(l.amount)}</span>} />
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
function OrderList({ orders, top = false }: { orders: OrderRow[]; top?: boolean }) {
  return (
    <ul className={cn("divide-y divide-border/60", top && "border-t border-border/70")}>
      {orders.map((o) => (
        <Row key={o.id} href={`/staff/restaurant/orders/${o.id}`}
          title={<>{o.number} <span className="font-normal text-muted-foreground">· {o.items} item{o.items === 1 ? "" : "s"}</span></>}
          sub={[formatDateTime(o.at), o.place, o.visit ? `Session ${o.visit}` : null, o.forOther ? `for ${o.forOther}` : null].filter(Boolean).join(" · ")}
          end={
            <>
              <span className="block tabular-nums">{formatTZS(o.total)}</span>
              <span className={cn("block text-xs font-medium", BILL_TONE[o.billing.tone])}>{o.cooking ? "Cooking · " : ""}{o.billing.text}</span>
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
