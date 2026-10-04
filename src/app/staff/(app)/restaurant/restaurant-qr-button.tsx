"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Download, ExternalLink, Loader2, MapPin, Printer, QrCode, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { QrPrintCard, saveFile, snapQrCard, type Printable } from "@/components/staff/qr/qr-print-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type RestaurantQr = { id: string; url: string; qr: string; active: boolean; hotel: string; phone: string | null };

/**
 * "Restaurant QR" on the Restaurant page, for everyone (reception too): the restaurant's own
 * card for the entrance, the bar and reception — show it, download it or print it right here.
 */
export function RestaurantQrButton({ qr }: { qr: RestaurantQr }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const card: Printable = { id: `restaurant-${qr.id}`, kind: "restaurant", title: "Restaurant", url: qr.url, qr: qr.qr };

  const download = async () => {
    const node = document.getElementById(`qr-${card.id}`);
    if (!node) return;
    setBusy(true);
    try { saveFile(await snapQrCard(node), "Restaurant-QR.jpg"); } catch { toast.error("Could not make the image — try again."); } finally { setBusy(false); }
  };
  // Print: only the card goes to the printer (once its pictures are ready).
  useEffect(() => {
    if (!printing) return;
    const done = () => { setPrinting(false); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    const imgs = [...document.querySelectorAll("#qr-print-area img")] as HTMLImageElement[];
    const t = setTimeout(() => { void Promise.all(imgs.map((i) => i.decode().catch(() => null))).then(() => window.print()); }, 120);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printing]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[oklch(0.72_0.12_80/0.45)] bg-card pl-1 pr-3 text-xs font-medium text-foreground/90 sm:h-9 sm:gap-2 sm:pl-1.5 sm:pr-3.5 sm:text-sm transition-colors hover:bg-[oklch(0.72_0.12_80/0.08)] hover:text-foreground">
        <span className="grid size-6 place-items-center rounded-full bg-linear-to-br from-[oklch(0.85_0.1_84)] to-[oklch(0.68_0.12_76)] text-[oklch(0.2_0.03_60)] transition-transform group-hover:scale-105 sm:size-7"><QrCode className="size-3.5" /></span>
        Restaurant QR
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out. */}
          <DialogHeader icon={<QrCode />} eyebrow="The restaurant's own QR" tone="gold" className="mx-0 mt-0">
            <DialogTitle>Restaurant QR</DialogTitle>
            <DialogDescription>Anyone scans it to see the menu and order.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 p-5 sm:grid-cols-[230px_minmax(0,1fr)]">
            <div className="relative mx-auto w-full max-w-[230px]">
              <QrPrintCard card={card} hotel={qr.hotel} phone={qr.phone} />
              {!qr.active && <div className="absolute inset-0 grid place-items-center rounded-[22px] bg-black/65 px-6 text-center text-sm font-semibold text-white">Switched off — a manager can switch it on in Tables &amp; QR</div>}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Put it at</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["The entrance", "The bar", "Reception", "Flyers & menus"].map((x) => (
                    <span key={x} className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1 text-xs"><MapPin className="size-3 text-[oklch(0.8_0.11_82)]" />{x}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Customers can</p>
                <ul className="mt-2 space-y-2 text-sm">
                  <li className="flex gap-2.5"><UtensilsCrossed className="mt-0.5 size-4 shrink-0 text-[oklch(0.8_0.11_82)]" /><span><b className="font-semibold">Eat here</b> <span className="text-muted-foreground">— say where they sit; the bill comes to them.</span></span></li>
                  <li className="flex gap-2.5"><ShoppingBag className="mt-0.5 size-4 shrink-0 text-[oklch(0.8_0.11_82)]" /><span><b className="font-semibold">Take out</b> <span className="text-muted-foreground">— with a delivery address, paid first with a payment screenshot.</span></span></li>
                </ul>
              </div>
              <div className="mt-auto grid grid-cols-2 gap-2">
                <Button disabled={busy || !qr.active} onClick={download} className="h-10">{busy ? <Loader2 className="animate-spin" /> : <Download />}Download</Button>
                <Button variant="outline" disabled={!qr.active || printing} onClick={() => setPrinting(true)} className="h-10"><Printer />Print</Button>
                <a href={qr.url} target="_blank" rel="noopener"
                  className={cn("col-span-2 flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground", !qr.active && "pointer-events-none opacity-50")}>
                  <ExternalLink className="size-4" />See what customers see
                </a>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {printing && createPortal(
        <div id="qr-print-area" className="hidden print:block">
          <style>{`@media print { @page { size: A4; margin: 12mm; } body > *:not(#qr-print-area) { display: none !important; } }`}</style>
          <div className="mx-auto w-[120mm]"><QrPrintCard card={{ ...card, id: `print-${qr.id}` }} hotel={qr.hotel} phone={qr.phone} /></div>
        </div>, document.body)}
    </>
  );
}
