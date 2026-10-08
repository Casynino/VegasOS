import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { deliveryPlace, orderHistory, ORDER_SOURCE, TYPE_LABEL } from "@/server/services/restaurant";
import { BackButton } from "../stay-bill/back-button";
import { PrintSlipButton } from "./print-slip-button";
import { getT } from "@/i18n/server";
import { orderItemName } from "@/i18n/content";
import { OrderNote } from "@/components/ordering/order-note";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Order slip"), robots: { index: false, follow: false } };
}
export const dynamic = "force-dynamic";

const TZ = "Africa/Dar_es_Salaam";

/**
 * The order slip — for preparing and delivering (no prices): the order number big, where it
 * goes, who for, every item with its quantity (the newest round marked), the note and the time.
 * Sized for an 80 mm slip printer; prints fine on A4 too.
 */
export default async function OrderSlipPage({ searchParams }: PageProps<"/staff/restaurant-slip">) {
  await requirePagePermission("restaurant.orders", "kitchen.orders", "restaurant.menu");
  const id = (await searchParams).order;
  const o = typeof id === "string" ? await orderHistory(id) : null;
  if (!o) notFound();
  const [s, t] = await Promise.all([getSettings(), getT()]);
  // In the staff member's own language: dish names as ordered, the customer's requests translated, their own words as typed.
  const time = (d: Date) => t.time(d, TZ);
  const date = (d: Date) => new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", year: "numeric", timeZone: TZ }).format(d);
  const place = deliveryPlace(o, t);
  const rounds = [...new Set(o.items.map((i) => i.round))].sort((a, b) => a - b);
  const newest = o.round > 1 ? o.items.filter((i) => i.round === o.round) : [];

  return (
    <main className="min-h-svh bg-[#e9e6e1] px-3 py-6 font-sans text-black print:bg-white print:p-0">
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } body { background: #fff !important; } }`}</style>
      <div className="mx-auto max-w-[340px] space-y-3">
        <div className="flex items-center justify-between gap-2 print:hidden">
          <BackButton fallback="/staff/restaurant" />
          <PrintSlipButton />
        </div>
        <article className="bg-white px-5 py-5 font-mono text-[13px] leading-snug shadow-[0_20px_40px_-26px_rgba(0,0,0,0.5)] print:px-0 print:py-0 print:shadow-none">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em]">{s.hotelName}</p>
          <p className="text-center text-[10px] uppercase tracking-[0.2em] text-black/60">{t("Order slip")}</p>
          <div className="my-3 border-y-2 border-dashed border-black py-2 text-center">
            <p className="text-[11px] uppercase tracking-widest text-black/60">{t("Order")}</p>
            <p className="text-3xl font-black tracking-tight">#{o.number.replace(/^ORD-\d{4}-0*/, "")}</p>
            <p className="text-[10px] text-black/60">{o.number}</p>
          </div>
          <p className="text-center text-xl font-black uppercase leading-tight">{place}</p>
          <p className="mt-1 text-center text-[12px]">{o.customerName ?? o.reservation?.guest.fullName ?? t("Walk-in customer")}</p>
          <p className="text-center text-[11px] text-black/60">{t(TYPE_LABEL[o.type])} · {t(ORDER_SOURCE[o.source] ?? o.source)}</p>

          {rounds.map((r) => {
            const items = o.items.filter((i) => i.round === r);
            return (
              <section key={r} className="mt-3 border-t border-dashed border-black/60 pt-2">
                {rounds.length > 1 && <p className="mb-1 text-[11px] font-bold uppercase">{r === o.round ? `★ ${t("New · added {time}", { time: time(items[0].addedAt) })}` : t("Round {n} · {time}", { n: r, time: time(items[0].addedAt) })}</p>}
                <ul className="space-y-1">
                  {items.map((i) => (
                    <li key={i.id} className={r < o.round ? "text-black/50 line-through" : "font-bold"}>
                      <span className="inline-block w-9 tabular-nums">{i.quantity}×</span>{orderItemName(i, t)}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {newest.length > 0 && <p className="mt-2 text-[11px] text-black/60">{t("Crossed out = served earlier.")}</p>}

          {(o.notes || o.noteCodes.length > 0) && (
            <div className="mt-3 border-2 border-black p-2">
              <p className="text-[11px] font-bold uppercase">{t("Special instructions")}</p>
              <OrderNote codes={o.noteCodes} notes={o.notes} t={t} tone="print" className="mt-1 border-0 px-0 py-0 text-[13px]" />
            </div>
          )}
          <div className="mt-3 border-t border-dashed border-black/60 pt-2 text-[11px]">
            <p>{t("Time: {time} · {date}", { time: time(o.createdAt), date: date(o.createdAt) })}</p>
            {o.createdBy && <p>{t("Placed by: {name}", { name: o.createdBy.fullName.replace(/\s*\(.*\)/, "") })}</p>}
            <p>{t("Printed: {time}", { time: time(new Date()) })}</p>
          </div>
        </article>
      </div>
    </main>
  );
}
