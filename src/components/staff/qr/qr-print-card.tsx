"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toJpeg, toPng } from "html-to-image";
import {
  BedDouble, BellRing, CalendarCheck, CalendarDays, Coffee, ConciergeBell, Download, ExternalLink, Loader2, Plus, Printer, Receipt, ShoppingBag, Store, Tag, UtensilsCrossed, Wine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A room / the meeting room / the public menu card — or a restaurant place: a table, the counter, the main restaurant QR —
 * or a Hotel booking QR ("Scan to book your stay"; its place, e.g. Entrance, stays off the card).
 */
export type Printable = { id: string; kind: "room" | "meeting" | "public" | "table" | "counter" | "restaurant" | "booking"; title: string; url: string; qr: string; table?: string; area?: string };
const GOLD = "#e3bd6a";

/** A card as a sharp JPEG, whatever size it is shown at (≈1050 px wide, A6 proportions). */
export function snapQrCard(node: HTMLElement) {
  return toJpeg(node, { pixelRatio: 1050 / Math.max(1, node.offsetWidth), quality: 0.93, cacheBust: true, backgroundColor: "#0b1026" });
}
/** The same card as a PNG (sharp edges for print shops and social media). */
export function snapQrCardPng(node: HTMLElement) {
  return toPng(node, { pixelRatio: 1050 / Math.max(1, node.offsetWidth), cacheBust: true, backgroundColor: "#0b1026" });
}
export function saveFile(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

/**
 * One card with its buttons — in a room's window, on the room page, in the restaurant:
 * download it (image), print it (opens the print sheet), see what a scan shows.
 */
export function QrPreview({ card, hotel, phone, printHref, fileName, className }: {
  card: Printable; hotel: string; phone: string | null; printHref: string; fileName: string; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    const node = document.getElementById(`qr-${card.id}`);
    if (!node) return;
    setBusy(true);
    try { saveFile(await snapQrCard(node), `${fileName}.jpg`); } catch { toast.error("Could not make the image — try again."); } finally { setBusy(false); }
  };
  return (
    <div className={cn("@container", className)}>
    <div className="flex flex-col items-center gap-3 @[30rem]:flex-row @[30rem]:items-start">
      <div className="w-[220px] shrink-0"><QrPrintCard card={card} hotel={hotel} phone={phone} /></div>
      <div className="w-full min-w-0 space-y-2 text-center @[30rem]:text-left">
        <p className="text-sm text-muted-foreground">{card.kind === "public"
          ? "Put it on restaurant tables, the bar and reception — anyone can order (dine in, takeaway, pickup)."
          : card.kind === "booking"
            ? "Put it at reception, the entrance, in rooms and on flyers — guests see our rooms, pick their dates, book and pay."
            : "Put it in the room. Scanning it opens the guest checked in to this room right now — their stay, bill and ordering. When the room is free it shows the room and the menu."}</p>
        <div className="flex flex-wrap justify-center gap-2 @[30rem]:justify-start">
          <Button size="sm" disabled={busy} onClick={download}>{busy ? <Loader2 className="animate-spin" /> : <Download />}Download</Button>
          <a href={printHref} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"><Printer className="size-4" />Print</a>
          <a href={card.kind === "public" || card.kind === "booking" ? card.url : `${card.url}?view=guest`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"><ExternalLink className="size-4" />See what guests see</a>
        </div>
      </div>
    </div>
    </div>
  );
}

/**
 * The printed card — a hotel amenity card, not a QR page: "Scan to order", the QR as the
 * hero (gold frame, logo in the middle), what you can order and how, and the room small.
 * Every size follows the card's width (cqw), so screen, print and download look the same.
 */
export function QrPrintCard({ card, hotel, phone }: { card: Printable; hotel: string; phone: string | null }) {
  const place = card.kind === "table" || card.kind === "counter" || card.kind === "restaurant";
  const copy = card.kind === "booking"
    // The Hotel QR: only what is always true (no payment way — the Admin can switch those on and off).
    ? { head: "Scan to book", sub: "your stay with us", items: [[BedDouble, "Our rooms"], [CalendarDays, "Your dates"], [Tag, "Live prices"], [CalendarCheck, "Book now"]] as const, tag: "Book your stay", foot: "Book direct with the hotel" }
    : place
    ? {
      head: card.title, sub: card.area ?? "order food & drinks",
      items: card.kind === "restaurant"
        ? [[UtensilsCrossed, "Dine in"], [ShoppingBag, "Takeaway"], [Wine, "Drinks"], [Receipt, "Your bill"]] as const
        : [[UtensilsCrossed, "Food"], [Wine, "Drinks"], [Plus, "Order more"], [Receipt, "Your bill"]] as const,
      tag: card.kind === "restaurant" ? "Restaurant & bar" : `${card.title}${card.area ? ` · ${card.area}` : ""}`,
      foot: "Scan to view our menu and place your order",
    }
    : card.kind === "meeting"
    ? { head: "Scan to order", sub: "refreshments & more", items: [[Coffee, "Coffee & tea"], [UtensilsCrossed, "Lunch"], [Wine, "Drinks"], [ConciergeBell, "Services"]] as const, tag: `Meeting Room ${card.title}`, foot: "Added to your meeting bill" }
    : card.kind === "public"
      ? { head: "Scan for our menu", sub: "order food & drinks", items: [[UtensilsCrossed, "Dine in"], [ShoppingBag, "Takeaway"], [Store, "Pickup"], [Wine, "Bar"]] as const, tag: card.table ?? "Restaurant & bar", foot: "Order and pay at the counter" }
      : { head: "Scan to order", sub: "food, drinks & more", items: [[UtensilsCrossed, "Food"], [Wine, "Drinks"], [BellRing, "Room service"], [ConciergeBell, "Hotel services"]] as const, tag: `Room ${card.title}`, foot: "Delivered to your room · added to your bill" };
  const steps = card.kind === "booking" ? ["Scan", "Choose", "Book"] : card.kind === "public" ? ["Scan", "Choose", "Enjoy"] : place ? ["Scan", "Order", "We serve you"] : ["Scan", "Choose", "We bring it"];
  return (
    <article id={`qr-${card.id}`} className="@container relative aspect-[105/148] w-full overflow-hidden rounded-[22px] bg-[#0b1026] text-center text-white shadow-[0_24px_50px_-28px_rgba(5,8,25,0.9)] [print-color-adjust:exact] print:rounded-none print:shadow-none">
      {/* Night-navy with a warm glow, fine gold lines and an inner gold border */}
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_50%_52%,rgba(227,189,106,0.22),transparent_46%),radial-gradient(circle_at_10%_95%,rgba(56,97,210,0.3),transparent_45%),radial-gradient(circle_at_92%_4%,rgba(56,97,210,0.22),transparent_40%)]" />
      <div aria-hidden className="absolute inset-0 opacity-[0.06] [background-image:repeating-linear-gradient(135deg,#e3bd6a_0_1px,transparent_1px_13px)]" />
      <div aria-hidden className="absolute inset-[2.4cqw] rounded-[4cqw] border border-[#e3bd6a]/40 print:rounded-none" />
      <div aria-hidden className="absolute inset-[3.4cqw] rounded-[3.2cqw] border border-[#e3bd6a]/15 print:rounded-none" />

      <div className="relative flex h-full flex-col items-center px-[8%] pb-[6%] pt-[7%]">
        {/* Brand */}
        <div className="flex items-center gap-[2cqw]">
          <span className="grid size-[8cqw] place-items-center rounded-full bg-[#0b1026] ring-1 ring-[#e3bd6a]/70">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-192.png" alt="" className="size-[85%] rounded-full" />
          </span>
          <span className="text-[2.3cqw] font-semibold uppercase tracking-[0.34em] text-white/85">{hotel}</span>
        </div>

        {/* The message */}
        <p className="mt-[5cqw] font-display text-[9.4cqw] font-semibold leading-[0.95]">{copy.head}</p>
        <p className="mt-[1cqw] font-display text-[6.4cqw] italic leading-none" style={{ color: GOLD }}>{copy.sub}</p>

        {/* The QR — the hero */}
        <div className="relative mt-[5.5cqw]">
          {/* gold scanner corners */}
          {["-left-[3cqw] -top-[3cqw] border-l-2 border-t-2 rounded-tl-[3cqw]", "-right-[3cqw] -top-[3cqw] border-r-2 border-t-2 rounded-tr-[3cqw]", "-bottom-[3cqw] -left-[3cqw] border-b-2 border-l-2 rounded-bl-[3cqw]", "-bottom-[3cqw] -right-[3cqw] border-b-2 border-r-2 rounded-br-[3cqw]"].map((pos) => (
            <span key={pos} aria-hidden className={cn("absolute size-[9cqw] border-[#e3bd6a]", pos)} />
          ))}
          <div className="relative rounded-[4cqw] bg-white p-[3.2cqw] shadow-[0_0_0_1px_rgba(227,189,106,0.5),0_18px_40px_-14px_rgba(227,189,106,0.55)]">
            <span className="block size-[47cqw] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: card.qr }} />
            {/* the logo in the middle (the QR is made to tolerate it) */}
            <span className="absolute left-1/2 top-1/2 grid size-[11cqw] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[2.4cqw] bg-white p-[0.8cqw] shadow-[0_0_0_1px_rgba(11,16,38,0.08)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-192.png" alt="" className="size-full rounded-[1.8cqw]" />
            </span>
          </div>
        </div>

        {/* What you can order */}
        <div className="mt-[6.5cqw] grid w-full grid-cols-4 gap-[1.5cqw]">
          {copy.items.map(([Icon, label]) => (
            <span key={label} className="flex flex-col items-center gap-[1.2cqw]">
              <span className="grid size-[8.5cqw] place-items-center rounded-full bg-[#e3bd6a]/12 ring-1 ring-[#e3bd6a]/45"><Icon className="size-[4.2cqw]" style={{ color: GOLD }} /></span>
              <span className="text-[2.3cqw] font-medium leading-tight text-white/85">{label}</span>
            </span>
          ))}
        </div>

        {/* How */}
        <div className="mt-[4.5cqw] flex items-center gap-[1.6cqw] text-[2.4cqw] text-white/70">
          {steps.map((step, i) => (
            <span key={step} className="flex items-center gap-[1.6cqw]">
              <span className="grid size-[4.2cqw] place-items-center rounded-full text-[2.2cqw] font-bold text-[#1a1206]" style={{ background: GOLD }}>{i + 1}</span>
              <span className="font-medium">{step}</span>
              {i < steps.length - 1 && <span aria-hidden className="h-px w-[4cqw] bg-[#e3bd6a]/50" />}
            </span>
          ))}
        </div>

        {/* The room — small */}
        <div className="mt-auto flex flex-col items-center gap-[1.2cqw]">
          <span className="rounded-full border border-[#e3bd6a]/50 bg-[#e3bd6a]/10 px-[3cqw] py-[0.8cqw] text-[2.3cqw] font-semibold uppercase tracking-[0.25em]" style={{ color: GOLD }}>{copy.tag}</span>
          <span className="text-[2.1cqw] text-white/50">{copy.foot}{phone ? ` · Reception ${phone}` : ""}</span>
        </div>
      </div>
    </article>
  );
}
