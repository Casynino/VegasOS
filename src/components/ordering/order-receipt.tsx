import type { OrderBill } from "@/server/services/restaurant";
import { deliveryPlace } from "@/lib/delivery-place";
import { DueBar, FolioDetails, FolioFooter, FolioHeader, GOLD, money, PayMethods, Stamp, type Hotel, type PayTo } from "./folio";
import { englishT, type T } from "@/i18n/translate";
import { orderItemName } from "@/i18n/content";
import { msg } from "@/i18n/msg";

const TZ = "Africa/Dar_es_Salaam";
const short = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const SERVICE: Record<string, string> = { DINE_IN: msg("Dine in"), ROOM_SERVICE: msg("Room service"), TAKEAWAY: msg("Takeaway"), PICKUP: msg("Pickup") };

/** Where the bill is for: "Table 4", "Room 305", "Counter". */
export function billPlace(bill: OrderBill, leadId: string) {
  const lead = bill.orders.find((o) => o.id === leadId) ?? bill.orders[0];
  const room = lead.reservation?.rooms.map((r) => r.room.number).join(", ") || lead.roomNumber;
  return { lead, room, place: bill.scope === "room" ? `Room ${room ?? ""}` : deliveryPlace(lead) };
}

/**
 * The bill / receipt (what is printed and downloaded) — the same for staff and for the
 * customer's own link, laid out like a hotel folio: the hotel, who and where, every line in
 * a table (item · qty · unit price · amount), totals, what is paid or on the room bill,
 * the amount due and how to pay it.
 */
export function OrderReceipt({ bill, leadId, hotel, payTo, t = englishT }: {
  bill: OrderBill; leadId: string;
  hotel: Hotel;
  payTo: PayTo[];
  /** The reader's language (the customer's on their link, the staff member's when printed); dish names as ordered. */
  t?: T;
}) {
  const date = (d: Date) => new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(d);
  const time = (d: Date) => t.time(d, TZ);
  const { lead, room, place: where } = billPlace(bill, leadId);
  // "Room 305" / "Table 4" in the reader's language (other places — a table's name, "Counter" — as the hotel named them).
  const place = where.replace(/^Room (.*)$/, (_m, r: string) => t("Room {room}", { room: r })).replace(/^Table (.*)$/, (_m, n: string) => t("Table {table}", { table: n }));
  const guest = lead.customerName ?? lead.reservation?.guest.fullName ?? t("Walk-in guest");
  const sum = bill.totals;
  const paidUp = sum.due === 0;
  const single = bill.orders.length === 1;
  const billNo = single ? short(lead.number) : t.plural(bill.orders.length, "{n} order", "{n} orders");
  const servedBy = [...new Set(bill.orders.map((o) => (o.deliveredBy ?? o.createdBy)?.fullName.replace(/\s*\(.*\)/, "").split(" ")[0]).filter(Boolean))].join(", ");
  const paidWith = [...new Set(bill.orders.flatMap((o) => o.payments.map((p) => p.account.name)))];
  const roomStamp = sum.onRoom > 0 && sum.paid === 0;
  const details: [string, string][] = [
    [t("Guest"), guest],
    [bill.scope === "room" || lead.type === "ROOM_SERVICE" ? t("Room") : lead.type === "DINE_IN" ? t("Table") : t("Collect at"), bill.scope === "room" ? room ?? "—" : where.replace(/^(Room|Table)\s+/, "")],
    [t("Service"), bill.scope === "room" ? t("Room stay") : t(SERVICE[lead.type] ?? "Restaurant")],
    [lead.reservation ? t("Booking") : t("Served by"), lead.reservation ? lead.reservation.reference : servedBy || (lead.createdById ? "—" : t("Online order"))],
  ];

  return (
    <article id="bill" className="relative overflow-hidden bg-white font-sans text-[#1b1611] shadow-[0_30px_60px_-34px_rgba(40,25,5,0.6)] [print-color-adjust:exact] print:shadow-none">
      <FolioHeader hotel={hotel} sub={t("Restaurant & Bar")} label={paidUp && sum.onRoom === 0 ? t("Receipt") : t("Bill")} number={billNo}
        when={`${date(single ? lead.createdAt : new Date())} · ${time(single ? lead.createdAt : new Date())}`} />
      <FolioDetails items={details} />

      {/* What was ordered */}
      <section className="px-5 pt-5 sm:px-8">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-[#14110d] text-[9.5px] uppercase tracking-[0.2em] text-black/55">
              <th className="pb-2 text-left font-semibold">{t("Item")}</th>
              <th className="w-12 pb-2 text-center font-semibold">{t("Qty")}</th>
              <th className="w-24 pb-2 text-right font-semibold">{t("Unit price")}</th>
              <th className="w-24 pb-2 text-right font-semibold">{t("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {bill.orders.flatMap((o) => {
              const food = o.items.filter((i) => i.type !== "DRINK"), drinks = o.items.filter((i) => i.type === "DRINK");
              const groups: [string | null, typeof o.items][] = food.length && drinks.length ? [[t("Food"), food], [t("Drinks"), drinks]] : [[null, o.items]];
              const rows: React.ReactNode[] = [];
              if (!single) rows.push(
                <tr key={`${o.id}-h`}>
                  <td colSpan={4} className="pb-1 pt-4 text-[11px]">
                    <span className="font-semibold">{t("Order {number}", { number: short(o.number) })}</span><span className="text-black/50"> · {time(o.createdAt)}</span>
                    <span className="ml-2 rounded-full px-2 py-px text-[9.5px] font-semibold uppercase tracking-wider"
                      style={o.settlement === "ROOM" ? { background: "#efeafc", color: "#5b3fc4" } : o.paidAmount >= o.total ? { background: "#e7f6ee", color: "#0f7a47" } : { background: "#fdecec", color: "#b42318" }}>
                      {o.settlement === "ROOM" ? t("On room bill") : o.paidAmount >= o.total ? t("Paid") : o.paidAmount > 0 ? t("Part-paid") : t("To pay")}
                    </span>
                  </td>
                </tr>,
              );
              for (const [label, items] of groups) {
                if (label) rows.push(<tr key={`${o.id}-${label}`}><td colSpan={4} className="pb-0.5 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.24em]" style={{ color: GOLD }}>{label}</td></tr>);
                for (const i of items) rows.push(
                  <tr key={i.id} className="border-b border-[#f1ece3]">
                    <td className="py-2 pr-2 align-top">{orderItemName(i, t)}</td>
                    <td className="py-2 text-center align-top tabular-nums">{i.quantity}</td>
                    <td className="py-2 text-right align-top tabular-nums text-black/55">{money(i.unitPrice)}</td>
                    <td className="py-2 text-right align-top font-medium tabular-nums">{money(i.lineTotal)}</td>
                  </tr>,
                );
              }
              if (o.serviceFee > 0) rows.push(
                <tr key={`${o.id}-fee`} className="border-b border-[#f1ece3] text-black/70">
                  <td className="py-2 pr-2">{t("Room service delivery")}</td><td className="py-2 text-center tabular-nums">1</td>
                  <td className="py-2 text-right tabular-nums text-black/55">{money(o.serviceFee)}</td><td className="py-2 text-right font-medium tabular-nums">{money(o.serviceFee)}</td>
                </tr>,
              );
              return rows;
            })}
          </tbody>
        </table>
      </section>

      {/* Totals (and a stamp once it is settled) */}
      <section className="relative flex justify-end px-5 pt-4 sm:px-8">
        {paidUp && <Stamp title={roomStamp ? t("Room bill") : t("Paid")} sub={roomStamp ? t("Settle at check-out") : t("Thank you")} tone={roomStamp ? "violet" : "green"} />}
        <dl className="w-full max-w-[290px] text-[13px]">
          {sum.food > 0 && <div className="flex justify-between py-0.5"><dt className="text-black/60">{t("Food")}</dt><dd className="tabular-nums">{money(sum.food)}</dd></div>}
          {sum.drinks > 0 && <div className="flex justify-between py-0.5"><dt className="text-black/60">{t("Drinks")}</dt><dd className="tabular-nums">{money(sum.drinks)}</dd></div>}
          {sum.fee > 0 && <div className="flex justify-between py-0.5"><dt className="text-black/60">{t("Room service")}</dt><dd className="tabular-nums">{money(sum.fee)}</dd></div>}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-[#14110d] pt-2"><dt className="text-[11px] font-bold uppercase tracking-[0.2em]">{t("Total")}</dt><dd className="text-[16px] font-bold tabular-nums">TZS {money(sum.total)}</dd></div>
          {sum.paid > 0 && <div className="flex justify-between py-0.5 text-[#0f7a47]"><dt>{t("Paid")}{paidWith.length ? ` · ${paidWith.map((a) => t(a)).join(", ")}` : ""}</dt><dd className="tabular-nums">− {money(sum.paid)}</dd></div>}
          {sum.onRoom > 0 && <div className="flex justify-between py-0.5 text-[#5b3fc4]"><dt>{t("On the room bill")}{room ? ` · ${t("Room {room}", { room })}` : ""}</dt><dd className="tabular-nums">− {money(sum.onRoom)}</dd></div>}
          <DueBar due={sum.due} t={t} />
        </dl>
      </section>

      {/* Each payment received (who took it, how, the reference) */}
      {bill.orders.some((o) => o.payments.length) && (
        <section className="px-5 pt-4 sm:px-8">
          <p className="border-b border-[#f1ece3] pb-1 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-black/50">{t("Payments received")}</p>
          <ul className="text-[11.5px]">
            {bill.orders.flatMap((o) => o.payments.map((p, i) => (
              <li key={`${o.id}-${i}`} className="flex justify-between gap-3 border-b border-[#f7f3ec] py-1.5">
                <span className="text-black/70">{date(p.collectedAt)} · {time(p.collectedAt)} · {t(p.account.name)}{p.reference ? ` · ${t("Ref {reference}", { reference: p.reference })}` : ""}{p.atCounter ? ` · ${t("Restaurant Counter")}` : p.collectedBy ? ` · ${p.collectedBy.fullName.replace(/\s*\(.*\)/, "").split(" ")[0]}` : ""}</span>
                <span className="shrink-0 font-medium tabular-nums">{money(p.amount)}</span>
              </li>
            )))}
          </ul>
        </section>
      )}

      {/* How to pay */}
      {sum.due > 0 && <PayMethods payTo={payTo} reference={single ? short(lead.number) : place} t={t} />}
      {sum.onRoom > 0 && sum.due === 0 && <p className="mx-5 mt-5 rounded-xl bg-[#f4f1fd] px-4 py-2.5 text-center text-[12px] text-[#4a33a8] sm:mx-8">{t("Added to your room bill — settle everything at check-out.")}</p>}

      <FolioFooter hotel={hotel} thanks={t("Asante sana — thank you for dining with us")} note={servedBy && lead.reservation ? t("Served by {name}", { name: servedBy }) : null} />
    </article>
  );
}
