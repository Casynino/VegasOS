"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toJpeg, toPng } from "html-to-image";
import { Camera, Download, ExternalLink, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NETWORK_MARKS } from "@/components/payments/networks";
import { useT } from "@/i18n/client";

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
  const t = useT();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    const node = document.getElementById(`qr-${card.id}`);
    if (!node) return;
    setBusy(true);
    try { saveFile(await snapQrCard(node), `${fileName}.jpg`); } catch { toast.error(t("Could not make the image — try again.")); } finally { setBusy(false); }
  };
  return (
    <div className={cn("@container", className)}>
    <div className="flex flex-col items-center gap-3 @[30rem]:flex-row @[30rem]:items-start">
      <div className="w-[220px] shrink-0"><QrPrintCard card={card} hotel={hotel} phone={phone} /></div>
      <div className="w-full min-w-0 space-y-2 text-center @[30rem]:text-left">
        <p className="text-sm text-muted-foreground">{card.kind === "public"
          ? t("Put it on restaurant tables, the bar and reception — anyone can order (dine in, takeaway, pickup).")
          : card.kind === "booking"
            ? t("Put it at reception, the entrance, in rooms and on flyers — guests see our rooms, pick their dates, book and pay.")
            : t("Put it in the room. Scanning it opens the guest checked in to this room right now — their stay, bill and ordering. When the room is free it shows the room and the menu.")}</p>
        <div className="flex flex-wrap justify-center gap-2 @[30rem]:justify-start">
          <Button size="sm" disabled={busy} onClick={download}>{busy ? <Loader2 className="animate-spin" /> : <Download />}{t("Download")}</Button>
          <a href={printHref} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"><Printer className="size-4" />{t("Print")}</a>
          <a href={card.kind === "public" || card.kind === "booking" ? card.url : `${card.url}?view=guest`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"><ExternalLink className="size-4" />{t("See what guests see")}</a>
        </div>
      </div>
    </div>
    </div>
  );
}

/**
 * The printed card (owner, 2026-10-05: clean — "no funny stuff around the QR", few words, a small "use your camera"
 * line on every card). Deep espresso with a soft glow and faint art-deco rays; the crest and the hotel's name; the
 * place in big serif type and one short line; the QR alone on a clean white tile (the logo in its middle); a tiny
 * camera hint; and "We accept" with the mobile-money networks, small. Every size follows the card's width (cqw), so
 * screen, print and download are the same picture.
 */
export function QrPrintCard({ card, hotel }: { card: Printable; hotel: string; phone?: string | null }) {
  const t = useT();
  const c = cardCopy(card);
  return (
    <article id={`qr-${card.id}`} className="@container relative aspect-[105/148] w-full overflow-hidden rounded-[22px] bg-[#0c0806] text-center text-white shadow-[0_24px_50px_-28px_rgba(10,7,4,0.9)] [print-color-adjust:exact] print:rounded-none print:shadow-none">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_85%_55%_at_50%_58%,#2a1f14_0%,#17100b_55%,#0c0806_100%)]" />
      <div aria-hidden className="absolute inset-0 opacity-[0.16] [background:repeating-conic-gradient(from_-90deg_at_50%_58%,rgba(227,189,106,0.6)_0deg_0.5deg,transparent_0.5deg_6deg)] [mask-image:radial-gradient(ellipse_75%_55%_at_50%_58%,#000_30%,transparent_75%)]" />
      <div aria-hidden className="absolute inset-[3cqw] rounded-[3cqw] border border-[#e3bd6a]/45 print:rounded-none" />
      {["left-[3cqw] top-[3cqw]", "right-[3cqw] top-[3cqw] rotate-90", "bottom-[3cqw] right-[3cqw] rotate-180", "bottom-[3cqw] left-[3cqw] -rotate-90"].map((p) => (
        <span key={p} aria-hidden className={cn("absolute size-[6cqw] border-l-[0.5cqw] border-t-[0.5cqw] border-[#e3bd6a]", p)} />
      ))}

      <div className="relative flex h-full flex-col items-center px-[9cqw] pb-[7.5cqw] pt-[8cqw]">
        <span className="grid size-[10cqw] place-items-center rounded-full bg-[#0c0806] ring-[0.35cqw] ring-[#e3bd6a]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-192.png" alt="" className="size-[88%] rounded-full" />
        </span>
        <p className="mt-[2.4cqw] text-[2.1cqw] font-semibold uppercase tracking-[0.5em] text-[#e3bd6a]/85">{hotel}</p>

        {c.eyebrow && <p className="mt-[5cqw] text-[2.1cqw] font-semibold uppercase tracking-[0.4em] text-white/55">{c.eyebrow}</p>}
        {/* In capitals (owner, 2026-10-05), sized by length so every title sits well inside the frame */}
        <p className={cn("max-w-[84cqw] text-balance font-display font-semibold uppercase leading-[1.02] tracking-[0.07em] [font-feature-settings:'lnum'_1] lining-nums", c.eyebrow ? "mt-[1.4cqw]" : "mt-[5.5cqw]")}
          style={{ fontSize: `${titleSize(c.title)}cqw` }}>{c.title}</p>
        <p className="mt-[1.8cqw] font-display text-[4.4cqw] italic leading-none" style={{ color: GOLD }}>{c.call}</p>

        {/* The QR, clean: a white tile, the logo in the middle (the QR tolerates it) */}
        <div className="relative mt-[5.5cqw] w-[56cqw] rounded-[3.4cqw] bg-white p-[3cqw] shadow-[0_2.5cqw_7cqw_-2cqw_rgba(0,0,0,0.7)]">
          <span className="block aspect-square w-full [&_path[stroke]]:stroke-[#120d09] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: card.qr }} />
          <span className="absolute left-1/2 top-1/2 grid size-[11cqw] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white p-[0.8cqw]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-192.png" alt="" className="size-full rounded-full" />
          </span>
        </div>
        {/* How — very small */}
        <p className="mt-[2.6cqw] flex items-center justify-center gap-[1.2cqw] text-[2.05cqw] tracking-wide text-white/55">
          <Camera className="size-[2.6cqw] shrink-0" style={{ color: GOLD }} strokeWidth={1.6} />{t("Open your phone camera and point it here")}
        </p>

        <div className="mt-auto w-full">
          <p className="flex items-center justify-center gap-[2cqw] text-[1.9cqw] font-semibold uppercase tracking-[0.42em] text-white/55">
            <span aria-hidden className="h-px w-[8cqw] bg-[#e3bd6a]/45" />{t("We accept")}<span aria-hidden className="h-px w-[8cqw] bg-[#e3bd6a]/45" />
          </p>
          <ul className="mt-[2.2cqw] flex items-center justify-center gap-[1.3cqw]" aria-label={t("Mobile-money networks")}>
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

/** Title size (cqw) for capitals: big for "ROOM 101", smaller as the words get longer — never touching the frame. */
function titleSize(title: string) {
  const n = title.length;
  return n <= 8 ? 10.2 : n <= 11 ? 8.2 : n <= 14 ? 6.9 : n <= 17 ? 6 : 5;
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
