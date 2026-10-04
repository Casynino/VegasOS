import { Banknote, CreditCard, Landmark, Smartphone, Wallet } from "lucide-react";
import { prettyPhone } from "@/lib/guest-messages";

/** The shared look of every bill the hotel hands a guest (restaurant bill, room bill). */
export const money = (v: number) => v.toLocaleString("en-US");
export const GOLD = "#b08d4a";
const PAY_ICON: Record<string, typeof Wallet> = { MOBILE_MONEY: Smartphone, BANK: Landmark, CARD: CreditCard, CASH: Banknote };
export type Hotel = { name: string; address: string | null; phone: string | null; whatsapp: string | null; email: string | null; website?: string | null };
export type PayTo = { id: string; name: string; kind?: string; number: string | null; holder: string | null };

/** Dark band: logo, hotel name, what this is (Bill / Receipt), its number and date. */
export function FolioHeader({ hotel, sub, label, number, when }: { hotel: Hotel; sub: string; label: string; number: string; when: string }) {
  return (
    <>
      <header className="relative overflow-hidden bg-[#14110d] px-5 py-6 text-white sm:px-8">
        <div aria-hidden className="absolute -right-16 -top-20 size-56 rounded-full bg-[radial-gradient(circle,rgba(217,178,106,0.28),transparent_65%)]" />
        <div className="relative flex items-center justify-between gap-5">
          <div className="flex min-w-0 items-center gap-3.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-192.png" alt="" className="size-14 shrink-0 rounded-full ring-1 ring-[#d9b26a]/50" />
            <div className="min-w-0">
              <p className="font-display text-[24px] leading-none tracking-wide sm:text-[27px]">{hotel.name}</p>
              <p className="mt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.38em] text-[#d9b26a]">{sub}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.38em] text-white/55">{label}</p>
            <p className="text-[24px] font-semibold leading-tight tracking-tight text-[#e8c886] tabular-nums">{number}</p>
            <p className="text-[11px] text-white/60">{when}</p>
          </div>
        </div>
      </header>
      <div className="h-[3px] bg-linear-to-r from-[#8a6a2f] via-[#e8c886] to-[#8a6a2f]" />
    </>
  );
}

/** Label / value pairs under the header (guest, room, dates…). */
export function FolioDetails({ items }: { items: [string, string][] }) {
  return (
    <section className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-[#eee7da] px-5 py-5 sm:grid-cols-4 sm:px-8">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-black/45">{k}</p>
          <p className="mt-0.5 text-[13px] font-semibold leading-snug">{v}</p>
        </div>
      ))}
    </section>
  );
}

/** The rubber stamp once a bill is settled. */
export function Stamp({ title, sub, tone }: { title: string; sub: string; tone: "green" | "violet" }) {
  const c = tone === "green" ? { borderColor: "#0f7a47aa", color: "#0f7a47cc" } : { borderColor: "#5b3fc4aa", color: "#5b3fc4cc" };
  return (
    <div aria-hidden className="absolute left-8 top-7 hidden -rotate-12 rounded-lg border-[3px] px-3 py-1 text-center sm:block sm:left-12" style={c}>
      <p className="text-[20px] font-black uppercase leading-none tracking-[0.18em]">{title}</p>
      <p className="mt-0.5 text-[8.5px] font-semibold uppercase tracking-[0.2em]">{sub}</p>
    </div>
  );
}

/** The big dark "Amount due" / "Balance" bar. */
export function DueBar({ due, label }: { due: number; label?: string }) {
  return (
    <div className="mt-3 flex items-center justify-between rounded-xl bg-[#14110d] px-4 py-3 text-white [print-color-adjust:exact]">
      <dt className="text-[9.5px] font-semibold uppercase tracking-[0.28em] text-[#d9b26a]">{label ?? (due > 0 ? "Amount due" : "Balance")}</dt>
      <dd className="text-[22px] font-bold leading-none tracking-tight tabular-nums">TZS {money(due)}</dd>
    </div>
  );
}

/** How to pay: each payment account as a small card, plus cash / card at the desk. */
export function PayMethods({ payTo, reference }: { payTo: PayTo[]; reference: string }) {
  return (
    <section className="mx-5 mt-6 rounded-2xl border border-[#eee7da] bg-[#faf7f1] p-4 sm:mx-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8a6a2f]">How to pay</p>
        <p className="text-[11px] text-black/55">Reference: <span className="font-semibold text-black/80">{reference}</span></p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {payTo.slice(0, 5).map((a) => {
          const Icon = PAY_ICON[a.kind ?? ""] ?? Wallet;
          return (
            <div key={a.id} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-[#eee7da]">
              <p className="flex items-center gap-2 text-[11px] font-semibold"><span className="grid size-6 place-items-center rounded-full bg-[#14110d] text-[#e8c886]"><Icon className="size-3.5" /></span>{a.name}</p>
              <p className="mt-1.5 font-mono text-[15px] font-semibold tracking-wider tabular-nums">{a.number}</p>
              {a.holder && <p className="truncate text-[10px] uppercase tracking-wide text-black/50">{a.holder}</p>}
            </div>
          );
        })}
        <div className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-[#eee7da]">
          <p className="flex items-center gap-2 text-[11px] font-semibold"><span className="grid size-6 place-items-center rounded-full bg-[#14110d] text-[#e8c886]"><Banknote className="size-3.5" /></span>Cash or card</p>
          <p className="mt-1.5 text-[13px] font-semibold">At the restaurant or reception</p>
          <p className="text-[10px] uppercase tracking-wide text-black/50">Ask for your receipt</p>
        </div>
      </div>
    </section>
  );
}

/** Thank-you line and the hotel's contacts. */
export function FolioFooter({ hotel, thanks, note }: { hotel: Hotel; thanks: string; note?: string | null }) {
  const phone = prettyPhone(hotel.whatsapp || hotel.phone);
  return (
    <footer className="mt-6 border-t border-[#eee7da] px-5 pb-6 pt-5 text-center sm:px-8">
      <p className="font-display text-[20px] italic leading-tight">{thanks}</p>
      {note && <p className="mt-1 text-[11px] text-black/50">{note}</p>}
      <p className="mt-2 text-[10px] leading-relaxed tracking-wide text-black/50">{[hotel.address, phone, hotel.email, hotel.website].filter(Boolean).join("  ·  ")}</p>
    </footer>
  );
}
