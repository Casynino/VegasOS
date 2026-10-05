"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toJpeg, toPng } from "html-to-image";
import { Download, ExternalLink, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NETWORK_MARKS } from "@/components/payments/networks";

/**
 * A room / the meeting room / the public menu card — or a restaurant place: a table, the counter, the main restaurant QR —
 * or a Hotel booking QR ("Scan to book your stay"; its place, e.g. Entrance, stays off the card).
 */
export type Printable = { id: string; kind: "room" | "meeting" | "public" | "table" | "counter" | "restaurant" | "booking"; title: string; url: string; qr: string; table?: string; area?: string };
const GOLD = "#e3bd6a";

/** A card as a sharp JPEG, whatever size it is shown at (≈1050 px wide, A6 proportions). */
export function snapQrCard(node: HTMLElement) {
  return toJpeg(node, { pixelRatio: 1050 / Math.max(1, node.offsetWidth), quality: 0.93, cacheBust: true, backgroundColor: "#ffffff" });
}
/** The same card as a PNG (sharp edges for print shops and social media). */
export function snapQrCardPng(node: HTMLElement) {
  return toPng(node, { pixelRatio: 1050 / Math.max(1, node.offsetWidth), cacheBust: true, backgroundColor: "#ffffff" });
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
 * The printed card (owner, 2026-10-05: "the best look — and the payment logos on it"). A6, two calm zones:
 * espresso above — the hotel, one big serif title for the place, the QR as the hero on a white tile with the logo —
 * and a cream band below that says how to pay: the mobile-money networks (nTZS) in their own colours. No icon rows,
 * no numbered steps, no pills. Every size follows the card's width (cqw), so screen, print and download match.
 */
export function QrPrintCard({ card, hotel, phone }: { card: Printable; hotel: string; phone: string | null }) {
  const c = cardCopy(card);
  return (
    <article id={`qr-${card.id}`} className="@container relative flex aspect-[105/148] w-full flex-col overflow-hidden rounded-[22px] bg-[#17110c] text-center text-white shadow-[0_24px_50px_-28px_rgba(10,7,4,0.9)] [print-color-adjust:exact] print:rounded-none print:shadow-none">
      {/* ── Espresso: the hotel and the place ── */}
      <div className="relative flex flex-1 flex-col items-center px-[8cqw] pt-[7cqw]">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_58%,rgba(227,189,106,0.20),transparent_70%),radial-gradient(ellipse_60%_35%_at_50%_0%,rgba(227,189,106,0.10),transparent_70%)]" />
        <div aria-hidden className="absolute inset-x-[3cqw] top-[3cqw] bottom-0 rounded-t-[3.4cqw] border border-b-0 border-[#e3bd6a]/30 print:rounded-none" />

        <div className="relative flex items-center gap-[2.2cqw]">
          <span className="grid size-[8.5cqw] place-items-center rounded-full bg-[#17110c] ring-1 ring-[#e3bd6a]/70">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-192.png" alt="" className="size-[86%] rounded-full" />
          </span>
          <span className="text-left leading-none">
            <span className="block text-[2.5cqw] font-semibold uppercase tracking-[0.32em] text-white/90">{hotel}</span>
            <span className="mt-[0.9cqw] block text-[1.9cqw] uppercase tracking-[0.3em] text-[#e3bd6a]/80">Dar es Salaam</span>
          </span>
        </div>

        <p className="relative mt-[6cqw] text-[2.3cqw] font-semibold uppercase tracking-[0.34em]" style={{ color: GOLD }}>{c.eyebrow}</p>
        <p className="relative mt-[1.6cqw] font-display text-[11cqw] font-semibold leading-[0.92] tracking-tight">{c.title}</p>
        {c.sub && <p className="relative mt-[1.6cqw] text-[2.6cqw] tracking-wide text-white/60">{c.sub}</p>}

        {/* The QR — the hero: a white tile, the logo in the middle (the QR tolerates it), one thin gold frame */}
        <div className="relative mt-[5cqw] rounded-[5cqw] p-[1.4cqw] ring-1 ring-[#e3bd6a]/55 shadow-[0_22px_44px_-18px_rgba(227,189,106,0.45)]">
          <div className="relative rounded-[3.8cqw] bg-white p-[3.4cqw]">
            <span className="block size-[44cqw] [&_path[stroke]]:stroke-[#17110c] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: card.qr }} />
            <span className="absolute left-1/2 top-1/2 grid size-[11.5cqw] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white p-[0.9cqw] shadow-[0_0_0_1px_rgba(23,17,12,0.10)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-192.png" alt="" className="size-full rounded-full" />
            </span>
          </div>
        </div>

        <p className="relative mt-[4.2cqw] font-display text-[4.6cqw] italic leading-none" style={{ color: GOLD }}>{c.call}</p>
        <p className="relative mt-[1.8cqw] pb-[5cqw] text-[2.35cqw] tracking-wide text-white/65">{c.does.join("   ·   ")}</p>
      </div>

      {/* ── Cream: how to pay — the networks in their own colours ── */}
      <div className="relative bg-[#f6f0e6] px-[6cqw] pb-[4.4cqw] pt-[3.8cqw] text-[#1d1712]">
        <p className="text-[2.1cqw] font-bold uppercase tracking-[0.3em] text-[#1d1712]/70">{c.pay}</p>
        <ul className="mt-[2.4cqw] flex items-center justify-center gap-[1.6cqw]" aria-label="Mobile-money networks">
          {NETWORK_MARKS.map((m) => (
            <li key={m.key} title={m.label}
              className={cn("inline-flex h-[6.6cqw] shrink-0 items-center gap-[0.3em] whitespace-nowrap rounded-[1.6cqw] px-[2.2cqw] text-[3.4cqw] font-extrabold lowercase leading-none tracking-tight shadow-[0_1px_2px_rgba(0,0,0,0.12)]", m.className)}>
              {m.body}
            </li>
          ))}
        </ul>
        <p className="mt-[2.4cqw] flex items-center justify-center gap-[1.2cqw] text-[2.1cqw] text-[#1d1712]/60">
          <span>Secure payment by <b className="font-bold tracking-wide text-[#1d1712]/85">NTZS</b></span>
          {phone && <><span aria-hidden className="size-[0.8cqw] rounded-full bg-[#b8913e]" /><span>Reception {phone}</span></>}
        </p>
      </div>
    </article>
  );
}

/** What each card says: the place in big type, the call to scan, what you can do, and how paying works there. */
function cardCopy(card: Printable): { eyebrow: string; title: string; sub: string | null; call: string; does: string[]; pay: string } {
  switch (card.kind) {
    case "booking":
      return { eyebrow: "Book direct", title: "Your stay", sub: null, call: "Scan to book your stay", does: ["Choose a room", "Book", "Pay now"], pay: "Pay by mobile money" };
    case "room":
      return { eyebrow: "Welcome to", title: `Room ${card.title}`, sub: null, call: "Scan to order", does: ["Food & drinks", "Your bill", "Ask reception"], pay: "Pay your bill by mobile money" };
    case "meeting":
      return { eyebrow: "Meeting room", title: card.title.toLowerCase().includes("meeting") ? card.title : "Meeting Room", sub: null, call: "Scan to order", does: ["Coffee & tea", "Lunch", "Drinks"], pay: "Pay by mobile money" };
    case "table":
      return { eyebrow: card.area ?? "Restaurant", title: card.title, sub: null, call: "Scan to order", does: ["Menu", "Order", "Pay"], pay: "Pay by mobile money" };
    case "counter":
      return { eyebrow: card.area ?? "Restaurant & bar", title: card.title, sub: null, call: "Scan to order", does: ["Menu", "Order", "Pay"], pay: "Pay by mobile money" };
    case "restaurant":
      return { eyebrow: "Restaurant & bar", title: "Our menu", sub: null, call: "Scan to order", does: ["Dine in", "Takeaway", "Drinks"], pay: "Pay by mobile money" };
    default:
      return { eyebrow: card.table ?? "Restaurant & bar", title: "Our menu", sub: null, call: "Scan to order", does: ["Dine in", "Takeaway", "Pickup"], pay: "Pay by mobile money" };
  }
}
