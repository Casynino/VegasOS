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

/** A card as a sharp JPEG, whatever size it is shown at (≈1240 px wide ≈ A6 at 300 dpi). The background colour is the
 * card's own espresso — html-to-image paints it on the card itself, so a light colour would hide the white words. */
export function snapQrCard(node: HTMLElement) {
  return toJpeg(node, { pixelRatio: 1240 / Math.max(1, node.offsetWidth), quality: 0.95, cacheBust: true, backgroundColor: "#0c0806" });
}
/** The same card as a PNG (sharp edges for print shops and social media). */
export function snapQrCardPng(node: HTMLElement) {
  return toPng(node, { pixelRatio: 1240 / Math.max(1, node.offsetWidth), cacheBust: true, backgroundColor: "#0c0806" });
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
 * The printed card — a hotel doorway (owner, 2026-10-05: "new, very nice cards, fewer words — people should see it
 * and say wow"). Deep espresso with fine art-deco rays; a gold arch, like the entrance, frames the QR (white tile,
 * the logo in its middle, the crest at the arch's top); under it only the place in big serif type and one short
 * line; at the foot "We accept" and the mobile-money networks, small. Every size follows the card's width (cqw), so
 * screen, print and download are the same picture.
 */
export function QrPrintCard({ card, hotel }: { card: Printable; hotel: string; phone?: string | null }) {
  const c = cardCopy(card);
  return (
    <article id={`qr-${card.id}`} className="@container relative aspect-[105/148] w-full overflow-hidden rounded-[22px] bg-[#0c0806] text-center text-white shadow-[0_24px_50px_-28px_rgba(10,7,4,0.9)] [print-color-adjust:exact] print:rounded-none print:shadow-none">
      {/* Light falls from the arch: a warm glow, art-deco rays, a double gold frame */}
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_85%_60%_at_50%_40%,#2b2015_0%,#17100b_55%,#0c0806_100%)]" />
      <div aria-hidden className="absolute inset-0 opacity-[0.28] [background:repeating-conic-gradient(from_-90deg_at_50%_36%,rgba(227,189,106,0.6)_0deg_0.5deg,transparent_0.5deg_6deg)] [mask-image:radial-gradient(ellipse_75%_58%_at_50%_36%,#000_25%,transparent_72%)]" />
      <div aria-hidden className="absolute inset-[3cqw] rounded-[3cqw] border border-[#e3bd6a]/50 print:rounded-none" />
      <div aria-hidden className="absolute inset-[4.3cqw] rounded-[2cqw] border border-[#e3bd6a]/15 print:rounded-none" />
      {/* art-deco corner marks */}
      {["left-[3cqw] top-[3cqw]", "right-[3cqw] top-[3cqw] rotate-90", "bottom-[3cqw] right-[3cqw] rotate-180", "bottom-[3cqw] left-[3cqw] -rotate-90"].map((p) => (
        <span key={p} aria-hidden className={cn("absolute size-[6cqw] border-l-[0.5cqw] border-t-[0.5cqw] border-[#e3bd6a]", p)} />
      ))}

      <div className="relative flex h-full flex-col items-center px-[9cqw] pb-[7.5cqw] pt-[8.5cqw]">
        <p className="text-[2.2cqw] font-semibold uppercase tracking-[0.5em] text-[#e3bd6a]/85">{hotel}</p>

        {/* The arch — the QR is the doorway */}
        <div className="relative mt-[7cqw]">
          <span aria-hidden className="absolute -inset-x-[1.8cqw] -top-[1.8cqw] bottom-0 rounded-t-full border-[0.2cqw] border-b-0 border-[#e3bd6a]/40" />
          <div className="relative w-[62cqw] rounded-t-full border-[0.55cqw] border-b-0 border-[#e3bd6a] px-[4cqw] pt-[17cqw] shadow-[inset_0_10cqw_14cqw_-10cqw_rgba(227,189,106,0.25)]">
            {/* the crest at the top of the arch */}
            <span className="absolute left-1/2 top-[3.2cqw] grid size-[11cqw] -translate-x-1/2 place-items-center rounded-full bg-[#0c0806] ring-[0.4cqw] ring-[#e3bd6a]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-192.png" alt="" className="size-[88%] rounded-full" />
            </span>
            <div className="relative rounded-[3cqw] bg-white p-[2.8cqw] shadow-[0_2cqw_6cqw_-1cqw_rgba(0,0,0,0.6)]">
              <span className="block aspect-square w-full [&_path[stroke]]:stroke-[#120d09] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: card.qr }} />
              <span className="absolute left-1/2 top-1/2 grid size-[10.5cqw] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white p-[0.8cqw]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/logo-192.png" alt="" className="size-full rounded-full" />
              </span>
            </div>
          </div>
          {/* the threshold: a gold line with a diamond at each end */}
          <span aria-hidden className="absolute -inset-x-[5cqw] -bottom-[1.6cqw] flex items-center">
            <span className="size-[1.6cqw] rotate-45 bg-[#e3bd6a]" /><span className="h-[0.3cqw] flex-1 bg-[#e3bd6a]" /><span className="size-[1.6cqw] rotate-45 bg-[#e3bd6a]" />
          </span>
        </div>

        {c.eyebrow && <p className="mt-[6cqw] text-[2.2cqw] font-semibold uppercase tracking-[0.4em] text-white/55">{c.eyebrow}</p>}
        <p className={cn("font-display text-[10.5cqw] font-semibold leading-[0.95] tracking-tight [font-feature-settings:'lnum'_1] lining-nums", c.eyebrow ? "mt-[1.4cqw]" : "mt-[6.5cqw]")}>{c.title}</p>
        <p className="mt-[1.8cqw] font-display text-[4.6cqw] italic leading-none" style={{ color: GOLD }}>{c.call}</p>

        {/* We accept — small, at the foot */}
        <div className="mt-auto w-full">
          <p className="flex items-center justify-center gap-[2cqw] text-[1.9cqw] font-semibold uppercase tracking-[0.42em] text-white/55">
            <span aria-hidden className="h-px w-[8cqw] bg-[#e3bd6a]/45" />We accept<span aria-hidden className="h-px w-[8cqw] bg-[#e3bd6a]/45" />
          </p>
          <ul className="mt-[2.2cqw] flex items-center justify-center gap-[1.3cqw]" aria-label="Mobile-money networks">
            {NETWORK_MARKS.map((m) => (
              <li key={m.key} title={m.label}
                className={cn("inline-flex h-[4.8cqw] shrink-0 items-center gap-[0.3em] whitespace-nowrap rounded-[1.1cqw] px-[1.6cqw] text-[2.45cqw] font-extrabold lowercase leading-none tracking-tight", m.className)}>
                {m.body}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

/** Few words: the place in big type, one short line — and, for tables and the counter, where it is. */
function cardCopy(card: Printable): { eyebrow: string | null; title: string; call: string } {
  switch (card.kind) {
    case "booking": return { eyebrow: null, title: "Book your stay", call: "Scan to book" };
    case "room": return { eyebrow: null, title: `Room ${card.title}`, call: "Scan to order" };
    case "meeting": return { eyebrow: null, title: "Meeting Room", call: "Scan to order" };
    case "table": return { eyebrow: card.area ?? null, title: card.title, call: "Scan to order" };
    case "counter": return { eyebrow: card.area ?? null, title: card.title, call: "Scan to order" };
    case "restaurant": return { eyebrow: null, title: "Restaurant & Bar", call: "Scan for the menu" };
    default: return { eyebrow: card.table ?? null, title: "Our Menu", call: "Scan to order" };
  }
}
