import type { StayBill } from "@/server/services/stay-bill";
import { DueBar, FolioDetails, FolioFooter, FolioHeader, GOLD, money, PayMethods, Stamp, type Hotel, type PayTo } from "@/components/ordering/folio";
import { getT } from "@/i18n/server";

type Charge = StayBill["charges"][number];

const TZ = "Africa/Dar_es_Salaam";
/** "2026-09-27" → "27 Sep 2026" (in the reader's language: `intl` from their translator). */
const day = (intl: string, d: string, year = true) => new Date(`${d}T00:00:00Z`).toLocaleDateString(intl, { day: "numeric", month: "short", ...(year && { year: "numeric" }), timeZone: "UTC" });
const stampOf = (intl: string, d: Date) => d.toLocaleString(intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });

/**
 * The room bill (folio) of a stay, laid out like the restaurant bill: the stay, each room's
 * nights, everything added to the room (restaurant orders by table and order, room service,
 * bar, extras), payments, and the balance — with how to pay while something is still owed.
 */
export async function StayBillDoc({ bill, hotel, payTo }: { bill: StayBill; hotel: Hotel; payTo: PayTo[] }) {
  // The reader's language: the staff member's own, or the guest's on their own bill page.
  const t = await getT();
  const date = (d: string, year = true) => day(t.intl, d, year);
  const stamp = (d: Date) => stampOf(t.intl, d);
  const tot = bill.totals;
  const nights = bill.rooms.reduce((n, r) => n + r.nights, 0);
  const settled = tot.balance <= 0 && tot.total > 0;
  const toCompany = tot.company > 0;
  const sections = ["Restaurant", "Room service", "Bar", "Services & extras"].map((name) => ({ name, lines: bill.charges.filter((c) => c.section === name) })).filter((s) => s.lines.length);
  const meeting = bill.kind === "MEETING";
  const company = bill.company ?? t("the company");
  const details: [string, string][] = [
    [t("Guest"), bill.company ? `${bill.guest.fullName} · ${bill.company}` : bill.guest.fullName],
    [bill.rooms.length > 1 ? t("Rooms") : meeting ? t("Meeting room") : t("Room"), bill.rooms.map((r) => r.number).join(", ") || "—"],
    [meeting ? t("Date") : t("Stay"), meeting ? date(bill.arrival) : `${date(bill.arrival, false)} → ${date(bill.departure)}${nights ? ` · ${t.plural(nights, "{n} night", "{n} nights")}` : ""}`],
    [bill.group ? t("Group") : t("Booking"), bill.group ? `${bill.group.name}` : bill.reference],
  ];

  const row = (key: string, desc: React.ReactNode, qty: string, rate: string, amount: string, dim = false) => (
    <tr key={key} className={dim ? "border-b border-[#f1ece3] text-black/65" : "border-b border-[#f1ece3]"}>
      <td className="py-2 pr-2 align-top">{desc}</td>
      <td className="py-2 text-center align-top tabular-nums">{qty}</td>
      <td className="py-2 text-right align-top tabular-nums text-black/55">{rate}</td>
      <td className="py-2 text-right align-top font-medium tabular-nums">{amount}</td>
    </tr>
  );
  const group = (label: string) => <tr key={`g-${label}`}><td colSpan={4} className="pb-0.5 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.24em]" style={{ color: GOLD }}>{label}</td></tr>;
  /** A section's lines: each restaurant order's items together under the order ("Restaurant — Outside 3 · Order #184"), with its subtotal. */
  const lines = (list: Charge[]) => {
    const blocks: { key: string; order: Charge["order"]; lines: Charge[] }[] = [];
    for (const c of list) {
      const same = c.order && blocks.find((b) => b.order?.id === c.order!.id);
      if (same) same.lines.push(c); else blocks.push({ key: c.id, order: c.order, lines: [c] });
    }
    return blocks.flatMap((b) => {
      if (!b.order) return b.lines.map((c) => row(c.id, <>{c.description}<span className="block text-[11px] text-black/45">{date(c.date, false)}</span></>, "", "", money(c.amount)));
      const subtotal = b.lines.reduce((sum, c) => sum + c.amount, 0);
      return [
        <tr key={`o-${b.key}`}><td colSpan={4} className="pb-0.5 pt-2.5 align-top"><span className="font-medium">{b.order.heading}</span><span className="text-[11px] text-black/45"> · {date(b.lines[0].date, false)}</span></td></tr>,
        ...b.lines.map((c) => row(c.id, <span className="block pl-3">{c.description}</span>, "", "", money(c.amount), b.lines.length > 1)),
        ...(b.lines.length > 1 ? [row(`s-${b.key}`, <span className="block pl-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-black/55">{t("Order subtotal")}</span>, "", "", money(subtotal))] : []),
      ];
    });
  };

  return (
    <article id="bill" className="relative overflow-hidden bg-white font-sans text-[#1b1611] shadow-[0_30px_60px_-34px_rgba(40,25,5,0.6)] [print-color-adjust:exact] print:shadow-none">
      <FolioHeader hotel={hotel} sub={meeting ? t("Meeting room bill") : t("Room bill")} label={settled ? t("Receipt") : t("Bill")} number={bill.reference} when={t("Printed {time}", { time: stamp(new Date()) })} />
      <FolioDetails items={details} />

      <section className="px-5 pt-5 sm:px-8">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-[#14110d] text-[9.5px] uppercase tracking-[0.2em] text-black/55">
              <th className="pb-2 text-left font-semibold">{t("Item")}</th>
              <th className="w-14 pb-2 text-center font-semibold">{meeting ? t("Qty") : t("Nights")}</th>
              <th className="w-24 pb-2 text-right font-semibold">{t("Rate")}</th>
              <th className="w-24 pb-2 text-right font-semibold">{t("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {bill.rooms.length > 0 && group(meeting ? t("Meeting room") : t("Accommodation"))}
            {bill.rooms.flatMap((r) => [
              row(r.id, <><span className="font-medium">{meeting ? t("Meeting room") : t("Room {room}", { room: r.number })}</span><span className="text-black/55"> · {t(r.type)}</span><span className="block text-[11px] text-black/45">{r.dayUse ? t("Short stay") : t("From {date}", { date: date(r.from, false) })}{r.dated ? ` · ${t("prices vary by date")}` : ""}</span></>,
                String(r.nights || 1), money(r.rate), money(r.gross)),
              ...(r.discount > 0 ? [row(`${r.id}-d`, <span className="text-[#0f7a47]">{t("Discount · Room {room}", { room: r.number })}</span>, "", "", `− ${money(r.discount)}`, true)] : []),
            ])}
            {sections.flatMap((s) => [group(t(s.name)), ...lines(s.lines)])}
          </tbody>
        </table>
      </section>

      <section className="relative flex justify-end px-5 pt-4 sm:px-8">
        {settled && <Stamp title={t("Paid")} sub={t("Thank you")} tone="green" />}
        <dl className="w-full max-w-[300px] text-[13px]">
          <div className="flex justify-between py-0.5"><dt className="text-black/60">{meeting ? t("Meeting room") : t("Accommodation")}</dt><dd className="tabular-nums">{money(tot.rooms)}</dd></div>
          {tot.discount > 0 && <div className="flex justify-between py-0.5 text-[#0f7a47]"><dt>{t("Discounts")}</dt><dd className="tabular-nums">− {money(tot.discount)}</dd></div>}
          {tot.charges > 0 && <div className="flex justify-between py-0.5"><dt className="text-black/60">{t("Food, drinks & extras")}</dt><dd className="tabular-nums">{money(tot.charges)}</dd></div>}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-[#14110d] pt-2"><dt className="text-[11px] font-bold uppercase tracking-[0.2em]">{t("Total")}</dt><dd className="text-[16px] font-bold tabular-nums">TZS {money(tot.total)}</dd></div>
          {tot.paid !== 0 && <div className="flex justify-between py-0.5 text-[#0f7a47]"><dt>{t("Paid")}</dt><dd className="tabular-nums">− {money(tot.paid)}</dd></div>}
          {toCompany && <div className="flex justify-between py-0.5 text-[#5b3fc4]"><dt>{t("Billed to {company}", { company })}</dt><dd className="tabular-nums">− {money(tot.company)}</dd></div>}
          <DueBar due={Math.max(0, tot.balance)} label={tot.balance > 0 ? t("Balance due") : t("Balance")} t={t} />
          {tot.balance < 0 && <p className="mt-1 text-right text-[11px] text-black/55">{t("In credit: TZS {amount}", { amount: money(-tot.balance) })}</p>}
        </dl>
      </section>

      {bill.payments.length > 0 && (
        <section className="px-5 pt-6 sm:px-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8a6a2f]">{t("Payments")}</p>
          <table className="mt-1.5 w-full border-collapse text-[12px]">
            <tbody>
              {bill.payments.map((p) => (
                <tr key={p.id} className="border-b border-[#f1ece3]">
                  <td className="py-1.5 pr-2 text-black/55 tabular-nums">{stamp(p.at)}</td>
                  <td className="py-1.5 pr-2">{p.refund ? `${t("Refund")} · ` : ""}{t(p.account)}{p.reference ? <span className="text-black/45"> · {p.reference}</span> : null}</td>
                  <td className={p.refund ? "py-1.5 text-right tabular-nums text-rose-700" : "py-1.5 text-right tabular-nums text-[#0f7a47]"}>{p.refund ? "+ " : "− "}{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tot.balance > 0 && <PayMethods payTo={payTo} reference={bill.reference} t={t} />}

      <FolioFooter hotel={hotel} thanks={meeting ? t("Asante sana — thank you for meeting with us") : t("Asante sana — thank you for staying with us")}
        note={toCompany ? t("Part of this stay is billed to {company} on its invoice.", { company }) : null} />
    </article>
  );
}
