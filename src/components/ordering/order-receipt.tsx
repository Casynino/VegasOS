import type { OrderBill } from "@/server/services/restaurant";
import { deliveryPlace } from "@/lib/delivery-place";
import { DueBar, FolioDetails, FolioFooter, FolioHeader, GOLD, money, PayMethods, Stamp, type Hotel, type PayTo } from "./folio";

const TZ = "Africa/Dar_es_Salaam";
const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const short = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const SERVICE: Record<string, string> = { DINE_IN: "Dine in", ROOM_SERVICE: "Room service", TAKEAWAY: "Takeaway", PICKUP: "Pickup" };

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
export function OrderReceipt({ bill, leadId, hotel, payTo }: {
  bill: OrderBill; leadId: string;
  hotel: Hotel;
  payTo: PayTo[];
}) {
  const { lead, room, place } = billPlace(bill, leadId);
  const guest = lead.customerName ?? lead.reservation?.guest.fullName ?? "Walk-in guest";
  const t = bill.totals;
  const paidUp = t.due === 0;
  const single = bill.orders.length === 1;
  const billNo = single ? short(lead.number) : `${bill.orders.length} orders`;
  const servedBy = [...new Set(bill.orders.map((o) => (o.deliveredBy ?? o.createdBy)?.fullName.replace(/\s*\(.*\)/, "").split(" ")[0]).filter(Boolean))].join(", ");
  const paidWith = [...new Set(bill.orders.flatMap((o) => o.payments.map((p) => p.account.name)))];
  const roomStamp = t.onRoom > 0 && t.paid === 0;
  const details: [string, string][] = [
    ["Guest", guest],
    [bill.scope === "room" || lead.type === "ROOM_SERVICE" ? "Room" : lead.type === "DINE_IN" ? "Table" : "Collect at", bill.scope === "room" ? room ?? "—" : place.replace(/^(Room|Table)\s+/, "")],
    ["Service", bill.scope === "room" ? "Room stay" : SERVICE[lead.type] ?? "Restaurant"],
    [lead.reservation ? "Booking" : "Served by", lead.reservation ? lead.reservation.reference : servedBy || (lead.createdById ? "—" : "Online order")],
  ];

  return (
    <article id="bill" className="relative overflow-hidden bg-white font-sans text-[#1b1611] shadow-[0_30px_60px_-34px_rgba(40,25,5,0.6)] [print-color-adjust:exact] print:shadow-none">
      <FolioHeader hotel={hotel} sub="Restaurant & Bar" label={paidUp && t.onRoom === 0 ? "Receipt" : "Bill"} number={billNo}
        when={`${date(single ? lead.createdAt : new Date())} · ${time(single ? lead.createdAt : new Date())}`} />
      <FolioDetails items={details} />

      {/* What was ordered */}
      <section className="px-5 pt-5 sm:px-8">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-[#14110d] text-[9.5px] uppercase tracking-[0.2em] text-black/55">
              <th className="pb-2 text-left font-semibold">Item</th>
              <th className="w-12 pb-2 text-center font-semibold">Qty</th>
              <th className="w-24 pb-2 text-right font-semibold">Unit price</th>
              <th className="w-24 pb-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.orders.flatMap((o) => {
              const food = o.items.filter((i) => i.type !== "DRINK"), drinks = o.items.filter((i) => i.type === "DRINK");
              const groups: [string | null, typeof o.items][] = food.length && drinks.length ? [["Food", food], ["Drinks", drinks]] : [[null, o.items]];
              const rows: React.ReactNode[] = [];
              if (!single) rows.push(
                <tr key={`${o.id}-h`}>
                  <td colSpan={4} className="pb-1 pt-4 text-[11px]">
                    <span className="font-semibold">Order {short(o.number)}</span><span className="text-black/50"> · {time(o.createdAt)}</span>
                    <span className="ml-2 rounded-full px-2 py-px text-[9.5px] font-semibold uppercase tracking-wider"
                      style={o.settlement === "ROOM" ? { background: "#efeafc", color: "#5b3fc4" } : o.paidAmount >= o.total ? { background: "#e7f6ee", color: "#0f7a47" } : { background: "#fdecec", color: "#b42318" }}>
                      {o.settlement === "ROOM" ? "On room bill" : o.paidAmount >= o.total ? "Paid" : o.paidAmount > 0 ? "Part-paid" : "To pay"}
                    </span>
                  </td>
                </tr>,
              );
              for (const [label, items] of groups) {
                if (label) rows.push(<tr key={`${o.id}-${label}`}><td colSpan={4} className="pb-0.5 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.24em]" style={{ color: GOLD }}>{label}</td></tr>);
                for (const i of items) rows.push(
                  <tr key={i.id} className="border-b border-[#f1ece3]">
                    <td className="py-2 pr-2 align-top">{i.name}</td>
                    <td className="py-2 text-center align-top tabular-nums">{i.quantity}</td>
                    <td className="py-2 text-right align-top tabular-nums text-black/55">{money(i.unitPrice)}</td>
                    <td className="py-2 text-right align-top font-medium tabular-nums">{money(i.lineTotal)}</td>
                  </tr>,
                );
              }
              if (o.serviceFee > 0) rows.push(
                <tr key={`${o.id}-fee`} className="border-b border-[#f1ece3] text-black/70">
                  <td className="py-2 pr-2">Room service delivery</td><td className="py-2 text-center tabular-nums">1</td>
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
        {paidUp && <Stamp title={roomStamp ? "Room bill" : "Paid"} sub={roomStamp ? "Settle at check-out" : "Thank you"} tone={roomStamp ? "violet" : "green"} />}
        <dl className="w-full max-w-[290px] text-[13px]">
          {t.food > 0 && <div className="flex justify-between py-0.5"><dt className="text-black/60">Food</dt><dd className="tabular-nums">{money(t.food)}</dd></div>}
          {t.drinks > 0 && <div className="flex justify-between py-0.5"><dt className="text-black/60">Drinks</dt><dd className="tabular-nums">{money(t.drinks)}</dd></div>}
          {t.fee > 0 && <div className="flex justify-between py-0.5"><dt className="text-black/60">Room service</dt><dd className="tabular-nums">{money(t.fee)}</dd></div>}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-[#14110d] pt-2"><dt className="text-[11px] font-bold uppercase tracking-[0.2em]">Total</dt><dd className="text-[16px] font-bold tabular-nums">TZS {money(t.total)}</dd></div>
          {t.paid > 0 && <div className="flex justify-between py-0.5 text-[#0f7a47]"><dt>Paid{paidWith.length ? ` · ${paidWith.join(", ")}` : ""}</dt><dd className="tabular-nums">− {money(t.paid)}</dd></div>}
          {t.onRoom > 0 && <div className="flex justify-between py-0.5 text-[#5b3fc4]"><dt>On the room bill{room ? ` · Room ${room}` : ""}</dt><dd className="tabular-nums">− {money(t.onRoom)}</dd></div>}
          <DueBar due={t.due} />
        </dl>
      </section>

      {/* Each payment received (who took it, how, the reference) */}
      {bill.orders.some((o) => o.payments.length) && (
        <section className="px-5 pt-4 sm:px-8">
          <p className="border-b border-[#f1ece3] pb-1 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-black/50">Payments received</p>
          <ul className="text-[11.5px]">
            {bill.orders.flatMap((o) => o.payments.map((p, i) => (
              <li key={`${o.id}-${i}`} className="flex justify-between gap-3 border-b border-[#f7f3ec] py-1.5">
                <span className="text-black/70">{date(p.collectedAt)} · {time(p.collectedAt)} · {p.account.name}{p.reference ? ` · Ref ${p.reference}` : ""}{p.atCounter ? " · Restaurant Counter" : p.collectedBy ? ` · ${p.collectedBy.fullName.replace(/\s*\(.*\)/, "").split(" ")[0]}` : ""}</span>
                <span className="shrink-0 font-medium tabular-nums">{money(p.amount)}</span>
              </li>
            )))}
          </ul>
        </section>
      )}

      {/* How to pay */}
      {t.due > 0 && <PayMethods payTo={payTo} reference={single ? short(lead.number) : place} />}
      {t.onRoom > 0 && t.due === 0 && <p className="mx-5 mt-5 rounded-xl bg-[#f4f1fd] px-4 py-2.5 text-center text-[12px] text-[#4a33a8] sm:mx-8">Added to your room bill — settle everything at check-out.</p>}

      <FolioFooter hotel={hotel} thanks="Asante sana — thank you for dining with us" note={servedBy && lead.reservation ? `Served by ${servedBy}` : null} />
    </article>
  );
}
