import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { deliveryPlace, orderHistory, ORDER_SOURCE, TYPE_LABEL } from "@/server/services/restaurant";
import { BackButton } from "../stay-bill/back-button";
import { PrintSlipButton } from "./print-slip-button";

export const metadata: Metadata = { title: "Order slip", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TZ = "Africa/Dar_es_Salaam";
const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });

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
  const s = await getSettings();
  const place = deliveryPlace(o);
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
          <p className="text-center text-[10px] uppercase tracking-[0.2em] text-black/60">Order slip</p>
          <div className="my-3 border-y-2 border-dashed border-black py-2 text-center">
            <p className="text-[11px] uppercase tracking-widest text-black/60">Order</p>
            <p className="text-3xl font-black tracking-tight">#{o.number.replace(/^ORD-\d{4}-0*/, "")}</p>
            <p className="text-[10px] text-black/60">{o.number}</p>
          </div>
          <p className="text-center text-xl font-black uppercase leading-tight">{place}</p>
          <p className="mt-1 text-center text-[12px]">{o.customerName ?? o.reservation?.guest.fullName ?? "Walk-in customer"}</p>
          <p className="text-center text-[11px] text-black/60">{TYPE_LABEL[o.type]} · {ORDER_SOURCE[o.source] ?? o.source}</p>

          {rounds.map((r) => {
            const items = o.items.filter((i) => i.round === r);
            return (
              <section key={r} className="mt-3 border-t border-dashed border-black/60 pt-2">
                {rounds.length > 1 && <p className="mb-1 text-[11px] font-bold uppercase">{r === o.round ? `★ New · added ${time(items[0].addedAt)}` : `Round ${r} · ${time(items[0].addedAt)}`}</p>}
                <ul className="space-y-1">
                  {items.map((i) => (
                    <li key={i.id} className={r < o.round ? "text-black/50 line-through" : "font-bold"}>
                      <span className="inline-block w-9 tabular-nums">{i.quantity}×</span>{i.name}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {newest.length > 0 && <p className="mt-2 text-[11px] text-black/60">Crossed out = served earlier.</p>}

          {o.notes && (
            <div className="mt-3 border-2 border-black p-2">
              <p className="text-[11px] font-bold uppercase">Special instructions</p>
              <p className="text-[13px] font-bold">{o.notes}</p>
            </div>
          )}
          <div className="mt-3 border-t border-dashed border-black/60 pt-2 text-[11px]">
            <p>Time: {time(o.createdAt)} · {date(o.createdAt)}</p>
            {o.createdBy && <p>Placed by: {o.createdBy.fullName.replace(/\s*\(.*\)/, "")}</p>}
            <p>Printed: {time(new Date())}</p>
          </div>
        </article>
      </div>
    </main>
  );
}
