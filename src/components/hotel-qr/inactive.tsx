import Link from "next/link";
import { ArrowUpRight, MessageCircle, Phone, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { telHref, waHref } from "./lib";

/**
 * A QR that does not open the booking app (unknown, switched off, replaced by a new one), or a booking link that
 * does not match: an elegant page with the hotel's phone and the website, so the guest is never stuck.
 */
export function QrMessage({ hotel, title, message, website = true }: {
  hotel: { name: string; phone: string | null; whatsapp: string | null }; title: string; message: string; website?: boolean;
}) {
  const btn = "inline-flex h-12 items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition";
  return (
    <main className="vr relative grid min-h-svh place-items-center overflow-hidden bg-(--vr-dark) px-4 py-10 text-white">
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-28 size-80 rounded-full bg-(--vr-gold)/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-20 size-96 rounded-full bg-(--vr-gold)/[0.06] blur-3xl" />
      <div className="relative w-full max-w-sm text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-(--vr-dark) ring-[1.5px] ring-(--vr-gold)/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-192.png" alt="" className="size-12 rounded-full" />
        </span>
        <p className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.24em] text-white/55">{hotel.name}</p>
        <h1 className="mt-3 font-display text-[32px] font-semibold leading-[1.05]">{title}</h1>
        <p className="mx-auto mt-3 max-w-xs text-[14px] leading-relaxed text-white/70">{message}</p>
        <div className="mt-7 grid gap-2.5">
          {hotel.phone && <a href={telHref(hotel.phone)} className={cn(btn, "bg-(--vr-gold) text-(--vr-ink) hover:brightness-105")}><Phone className="size-4" />Call {hotel.phone}</a>}
          {hotel.whatsapp && (
            <a href={waHref(hotel.whatsapp, `Hello ${hotel.name}, I would like to book a room.`)} target="_blank" rel="noopener" className={cn(btn, "bg-white/[0.08] ring-1 ring-white/20 hover:bg-white/[0.14]")}>
              <MessageCircle className="size-4 text-(--vr-gold)" />WhatsApp us
            </a>
          )}
          {website && (
            <Link href="/book" className={cn(btn, "bg-white/[0.08] ring-1 ring-white/20 hover:bg-white/[0.14]")}>
              Book on our website<ArrowUpRight className="size-4 text-(--vr-gold)" />
            </Link>
          )}
        </div>
        <p className="mt-6 inline-flex items-center gap-1.5 text-[11.5px] text-white/45"><QrCode className="size-3.5" />Ask reception for the current QR code</p>
      </div>
    </main>
  );
}
