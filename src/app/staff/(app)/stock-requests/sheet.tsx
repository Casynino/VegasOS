"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toJpeg } from "html-to-image";
import { FileDown, ImageDown, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { jpegFromDataUrl, jpegsToPdf } from "@/lib/jpeg-pdf";
import { FolioDetails, FolioHeader, Stamp } from "@/components/ordering/folio";
import { num, person, when } from "@/lib/stock-requests";
import type { Tile } from "./parts";

export type SheetLine = { name: string; quantity: number; unit: string };

/** The day the list was made (today for a new one). */
const dated = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });

/* ─────────────── The list on paper — to check, print or save ─────────────── */

export function StockSheet({ id, hotel, number, deptName, by, at, urgent, reason, note, lines, pics, status }: {
  id: string; hotel: string; number: string | null; deptName: string; by: string; at: string; urgent: boolean; reason: string | null; note: string | null;
  lines: SheetLine[]; pics: Map<string, Tile>; status?: string;
}) {
  const approved = status === "APPROVED" || status === "PURCHASING" || status === "PENDING_APPROVAL";
  const done = status === "COMPLETED";
  return (
    <div id={id} className="mx-auto w-full max-w-[680px] overflow-hidden rounded-2xl bg-white font-sans text-[#1b1611] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.7)] [print-color-adjust:exact]">
      <FolioHeader hotel={{ name: hotel, address: null, phone: null, whatsapp: null, email: null }} sub={`Stock request · ${deptName}`}
        label={number ? "Request" : "New request"} number={number ?? "Draft"} when={when(at)} />
      <FolioDetails items={[
        ["Requested by", person(by)], ["Department", deptName],
        ["Date", dated(at)], ["Priority", urgent ? "Urgent" : "Normal"],
      ]} />
      <section className="px-5 py-5 sm:px-8">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-b-2 border-[#1b1611] text-left text-[9.5px] uppercase tracking-[0.22em] text-black/50">
              <th className="w-10 pb-2 font-semibold">No.</th><th className="pb-2 font-semibold">Item</th><th className="pb-2 text-right font-semibold">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, n) => {
              const pic = pics.get(l.name);
              return (
                <tr key={`${l.name}-${n}`} className="border-b border-[#eee7da] odd:bg-[#fbf8f2]">
                  <td className="py-2.5 pl-1 tabular-nums text-black/40">{String(n + 1).padStart(2, "0")}</td>
                  <td className="py-2.5">
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-[#f3ecdf] text-[14px] leading-none">{pic?.emoji ?? "📦"}</span>
                      <span className="font-medium">{l.name}</span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-1 text-right"><span className="font-semibold tabular-nums">{num(l.quantity)}</span> <span className="text-black/55">{l.unit}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-[#14110d] px-4 py-3 text-white">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.28em] text-[#d9b26a]">Items to buy</span>
          <span className="text-[20px] font-bold leading-none tabular-nums">{lines.length}</span>
        </div>
        {(reason || note) && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {reason && (
              <div className="rounded-xl border border-[#eee7da] bg-[#fbf8f2] px-4 py-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-black/45">What it is for</p>
                <p className="mt-0.5 text-[13px]">{reason}</p>
              </div>
            )}
            {note && (
              <div className="rounded-xl border border-[#eee7da] bg-[#fbf8f2] px-4 py-3">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-black/45">Note</p>
                <p className="mt-0.5 text-[13px]">{note}</p>
              </div>
            )}
          </div>
        )}
        <div className="mt-12 grid grid-cols-2 gap-8 text-[11px]">
          <div className="border-t border-black/30 pt-1.5"><p className="font-semibold">{person(by)}</p><p className="text-black/50">Requested by</p></div>
          <div className="relative border-t border-black/30 pt-1.5">
            {(approved || done) && (
              <div className="absolute -top-[4.5rem] left-0 h-0 w-full">
                <Stamp title={done ? "Received" : "Approved"} sub={done ? "In the store" : "To buy"} tone={done ? "green" : "violet"} />
              </div>
            )}
            <p className="font-semibold">&nbsp;</p><p className="text-black/50">Approved by (manager)</p>
          </div>
        </div>
      </section>
      <footer className="border-t border-[#eee7da] px-5 py-3 text-center text-[9.5px] font-semibold uppercase tracking-[0.3em] text-black/40 sm:px-8">{hotel} · {deptName} stock</footer>
    </div>
  );
}

const snap = { pixelRatio: 2.5, cacheBust: true, backgroundColor: "#ffffff", style: { margin: "0", boxShadow: "none" } };
function save(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
/** Print just the list (not the page around it): a hidden frame with the app's styles. */
function printSheet(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const frame = document.createElement("iframe");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join("");
  const htmlClass = document.documentElement.className.replace(/\bdark\b/g, "");
  doc.open();
  doc.write(`<!doctype html><html class="${htmlClass}"><head>${styles}<style>@page{margin:12mm}body{background:#fff;margin:0}#${id}{box-shadow:none!important;max-width:none!important}</style></head><body>${el.outerHTML}</body></html>`);
  doc.close();
  let tries = 0;
  const go = () => {
    if (doc.readyState !== "complete" && tries++ < 30) { setTimeout(go, 100); return; }
    frame.contentWindow?.focus(); frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1500);
  };
  setTimeout(go, 150);
}

/** Print, or save as a PDF or a picture (to send on WhatsApp). */
export function SheetTools({ target, fileName }: { target: string; fileName: string }) {
  const [busy, setBusy] = useState<"pdf" | "image" | null>(null);
  const node = () => document.getElementById(target);
  const pdf = async () => {
    const el = node(); if (!el) return;
    setBusy("pdf");
    try {
      const page = await jpegFromDataUrl(await toJpeg(el, { ...snap, quality: 0.95 }));
      const href = URL.createObjectURL(new Blob([jpegsToPdf([page], 595)], { type: "application/pdf" }));
      save(href, `${fileName}.pdf`);
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch { toast.error("Could not make the PDF — try again."); } finally { setBusy(null); }
  };
  const image = async () => {
    const el = node(); if (!el) return;
    setBusy("image");
    try { save(await toJpeg(el, { ...snap, quality: 0.92 }), `${fileName}.jpg`); } catch { toast.error("Could not make the picture — try again."); } finally { setBusy(null); }
  };
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button variant="outline" className="h-10" onClick={() => printSheet(target)}><Printer />Print</Button>
      <Button variant="outline" className="h-10" disabled={!!busy} onClick={pdf}>{busy === "pdf" ? <Loader2 className="animate-spin" /> : <FileDown />}PDF</Button>
      <Button variant="outline" className="h-10" disabled={!!busy} onClick={image}>{busy === "image" ? <Loader2 className="animate-spin" /> : <ImageDown />}Picture</Button>
    </div>
  );
}
