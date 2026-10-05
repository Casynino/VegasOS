"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive, Download, ExternalLink, FileCode2, Loader2, MapPin, Maximize2, Pencil, Plus, Power, Printer, QrCode, RefreshCw, X,
} from "lucide-react";
import { QrPrintCard, saveFile, snapQrCardPng, type Printable } from "@/components/staff/qr/qr-print-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { archiveBookingQrAction, createBookingQrAction, regenerateBookingQrAction, setBookingQrActiveAction, updateBookingQrAction } from "./actions";

export type QrCodeView = {
  id: string; label: string; placement: string | null; url: string; qr: string; active: boolean;
  scans: number; lastScan: string | null; bookings: number; madeBy: string | null; regeneratedAt: string | null; createdAt: string;
};

/** Places a card usually goes — one tap fills the name. */
const PLACES = ["Reception", "Entrance", "Lobby", "Restaurant", "Rooms", "Meeting area", "Flyer", "Business card", "Social media"];
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" });
const fileName = (label: string) => `Hotel-QR-${label.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "card"}`;
const printable = (c: QrCodeView, prefix = "bqr"): Printable => ({ id: `${prefix}-${c.id}`, kind: "booking", title: c.label, url: c.url, qr: c.qr });

/** The bare QR as an SVG file: white, with the quiet edge scanners need — for a designer or a print shop. */
function svgFile(svg: string) {
  const n = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1] ?? 0);
  if (!n) return svg;
  const q = 4, size = n + 2 * q;
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-q} ${-q} ${size} ${size}" width="1024" height="1024" shape-rendering="crispEdges"><rect x="${-q}" y="${-q}" width="${size}" height="${size}" fill="#ffffff"/>${inner}</svg>`;
}

type Confirm = { kind: "regenerate" | "off" | "archive"; code: QrCodeView };

/**
 * The Hotel QR codes: each place's branded card ("Scan to book your stay") with what reception does with it — show it to
 * a guest full screen, print it, download it (PNG card or the bare SVG), open the booking page. The Admin also makes a
 * code for another place, renames, makes a new code (the old card stops working), switches it off / on and archives it.
 */
export function QrCodes({ codes, hotel, phone, canManage, bookingOn }: {
  codes: QrCodeView[]; hotel: string; phone: string | null; canManage: boolean; bookingOn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [printing, setPrinting] = useState<QrCodeView[] | null>(null);
  const [guest, setGuest] = useState<QrCodeView | null>(null);
  const [editing, setEditing] = useState<QrCodeView | "new" | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pending, start] = useTransition();
  const working = codes.filter((c) => c.active);

  const downloadPng = async (c: QrCodeView) => {
    const node = document.getElementById(`qr-bqr-${c.id}`);
    if (!node) return;
    setBusy(c.id);
    try { saveFile(await snapQrCardPng(node), `${fileName(c.label)}.png`); } catch { toast.error("Could not make the image — try again."); } finally { setBusy(null); }
  };
  const downloadSvg = (c: QrCodeView) => {
    const href = URL.createObjectURL(new Blob([svgFile(c.qr)], { type: "image/svg+xml" }));
    saveFile(href, `${fileName(c.label)}.svg`);
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };

  // Print: only the chosen cards go to the printer (once the logo has loaded).
  useEffect(() => {
    if (!printing) return;
    const done = () => { setPrinting(null); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    const imgs = [...document.querySelectorAll("#qr-print-area img")] as HTMLImageElement[];
    const t = setTimeout(() => { void Promise.all(imgs.map((i) => i.decode().catch(() => null))).then(() => window.print()); }, 120);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [printing]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) => start(async () => {
    const res = await fn();
    if (res.ok) { toast.success(res.message ?? "Saved."); after?.(); router.refresh(); } else toast.error(res.error ?? "Something went wrong.");
  });
  const doConfirm = (c: Confirm) => run(
    () => c.kind === "regenerate" ? regenerateBookingQrAction({ id: c.code.id }) : c.kind === "off" ? setBookingQrActiveAction({ id: c.code.id, active: false }) : archiveBookingQrAction({ id: c.code.id }),
    () => setConfirm(null),
  );

  return (
    <section aria-labelledby="qr-codes-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="qr-codes-title" className="text-base font-semibold">The QR {codes.length === 1 ? "card" : "cards"}</h2>
          <p className="text-xs text-muted-foreground">{canManage
            ? "One card per place — each has its own code and its own numbers."
            : "Show it to a guest, print it or download it. Only the Admin changes the codes."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {working.length > 1 && <Button variant="outline" size="sm" onClick={() => setPrinting(working)}><Printer />Print all ({working.length})</Button>}
          {canManage && <Button size="sm" onClick={() => setEditing("new")}><Plus />QR for another place</Button>}
        </div>
      </div>

      {codes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-border/80 bg-card/50 px-6 py-10 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground"><QrCode className="size-5" /></span>
          <p className="font-medium">No Hotel QR yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">{canManage ? "Make the first one — for reception, the entrance or a flyer." : "Ask the Admin to make one."}</p>
          {canManage && <Button className="mt-2" onClick={() => setEditing("new")}><Plus />Make a QR</Button>}
        </div>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {codes.map((c) => (
            <li key={c.id} className="@container rounded-3xl border border-border/70 bg-card p-4 shadow-[0_2px_4px_rgba(15,23,42,0.03),0_12px_32px_-18px_rgba(15,23,42,0.18)]">
              <div className="flex flex-col gap-4 @[34rem]:flex-row">
                <div className="relative mx-auto w-full max-w-[230px] shrink-0 @[34rem]:mx-0 @[34rem]:w-[210px]">
                  <QrPrintCard card={printable(c)} hotel={hotel} phone={phone} />
                  {!c.active && <div className="absolute inset-0 grid place-items-center rounded-[22px] bg-black/65 px-6 text-center text-sm font-semibold text-white">Switched off — scanning it asks the guest to contact reception</div>}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-lg font-semibold leading-tight"><MapPin className="size-4 shrink-0 text-[oklch(0.8_0.11_82)]" /><span className="truncate">{c.label}</span></span>
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", c.active ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                        <span className={cn("size-1.5 rounded-full", c.active ? "bg-emerald-500" : "bg-muted-foreground")} />{c.active ? (bookingOn ? "Working" : "Working · booking off") : "Off"}
                      </span>
                    </p>
                    {c.placement && <p className="mt-0.5 text-sm text-muted-foreground">{c.placement}</p>}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-muted-foreground">Scans</dt><dd className="text-base font-semibold tabular-nums">{c.scans}</dd></div>
                    <div className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-muted-foreground">Bookings</dt><dd className="text-base font-semibold tabular-nums">{c.bookings}</dd></div>
                  </dl>
                  <p className="text-[11px] text-muted-foreground">
                    {c.lastScan ? `Last scan ${when(c.lastScan)}` : "Not scanned yet"}
                    {c.regeneratedAt ? ` · new code ${when(c.regeneratedAt)}` : ` · made ${when(c.createdAt)}`}{c.madeBy ? ` by ${c.madeBy}` : ""}
                  </p>
                  {/* Where the code leads (the booking page) — no secrets in it, just this card's key. */}
                  <p className="truncate rounded-lg border border-dashed border-border/80 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground" title={c.url}>{c.url}</p>

                  <div className="grid grid-cols-2 gap-2 @[24rem]:grid-cols-3">
                    <Button disabled={!c.active} onClick={() => setGuest(c)} className="col-span-2 h-10 @[24rem]:col-span-3"><Maximize2 />Show to guest</Button>
                    <Button variant="outline" disabled={!c.active || !!printing} onClick={() => setPrinting([c])}><Printer />Print</Button>
                    <Button variant="outline" disabled={!c.active || busy === c.id} onClick={() => downloadPng(c)}>{busy === c.id ? <Loader2 className="animate-spin" /> : <Download />}PNG</Button>
                    <Button variant="outline" disabled={!c.active} onClick={() => downloadSvg(c)}><FileCode2 />SVG</Button>
                    <a href={c.url} target="_blank" rel="noopener"
                      className={cn("col-span-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground @[24rem]:col-span-3", !c.active && "pointer-events-none opacity-50")}>
                      <ExternalLink className="size-4" />Open the booking page
                    </a>
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap gap-1 border-t border-dashed border-border/70 pt-2">
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setEditing(c)}><Pencil />Rename</Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setConfirm({ kind: "regenerate", code: c })}><RefreshCw />New code</Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={pending}
                        onClick={() => (c.active ? setConfirm({ kind: "off", code: c }) : run(() => setBookingQrActiveAction({ id: c.id, active: true })))}>
                        <Power />{c.active ? "Switch off" : "Switch on"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground" onClick={() => setConfirm({ kind: "archive", code: c })}><Archive />Archive</Button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && editing && <PlaceDialog code={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={confirm?.kind === "archive" ? <Archive /> : confirm?.kind === "off" ? <Power /> : <RefreshCw />} eyebrow="Hotel QR" tone={confirm?.kind === "regenerate" ? "gold" : "rose"}>
            <DialogTitle>{confirm?.kind === "regenerate" ? `New code for ${confirm.code.label}?` : confirm?.kind === "off" ? `Switch off ${confirm.code.label}?` : `Archive ${confirm?.code.label}?`}</DialogTitle>
            <DialogDescription>{confirm?.kind === "regenerate"
              ? "Printed cards with the old code stop working at once — print the new card and replace them. Bookings already made are not affected."
              : confirm?.kind === "off"
                ? "Guests who scan it are asked to contact reception; nothing can be booked from it. You can switch it back on."
                : "It stops working and leaves the list. Its bookings and numbers stay."}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending} variant={confirm?.kind === "regenerate" ? "default" : "destructive"} onClick={() => confirm && doConfirm(confirm)}>
              {pending && <Loader2 className="animate-spin" />}{confirm?.kind === "regenerate" ? "Make a new code" : confirm?.kind === "off" ? "Switch off" : "Archive"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {guest && <GuestView code={guest} hotel={hotel} onClose={() => setGuest(null)} />}

      {printing && createPortal(
        <div id="qr-print-area" className="hidden print:block">
          <style>{`@media print { @page { size: A4; margin: ${printing.length > 1 ? 8 : 12}mm; } body > *:not(#qr-print-area) { display: none !important; } }`}</style>
          {printing.length === 1
            ? <div className="mx-auto w-[120mm]"><QrPrintCard card={printable(printing[0], "print")} hotel={hotel} phone={phone} /></div>
            : <div className="grid grid-cols-2 gap-[6mm]">{printing.map((c) => <div key={c.id} className="break-inside-avoid"><QrPrintCard card={printable(c, "print")} hotel={hotel} phone={phone} /></div>)}</div>}
        </div>, document.body)}
    </section>
  );
}

/** Make a code for a place, or rename one (the printed card keeps working). */
function PlaceDialog({ code, onClose }: { code: QrCodeView | null; onClose: () => void }) {
  const router = useRouter();
  const [label, setLabel] = useState(code?.label ?? "");
  const [note, setNote] = useState(code?.placement ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const input = { label: label.trim(), placement: note.trim() || null };
    const res = code ? await updateBookingQrAction({ id: code.id, ...input }) : await createBookingQrAction(input);
    if (res.ok) { toast.success(res.message ?? "Saved."); onClose(); router.refresh(); } else { setError(res.fieldErrors?.label ?? res.error); toast.error(res.error); }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader icon={<QrCode />} eyebrow="Hotel QR" tone="gold">
          <DialogTitle>{code ? `Rename ${code.label}` : "A QR for another place"}</DialogTitle>
          <DialogDescription>{code ? "The printed card keeps working." : "It gets its own code and its own numbers — print its card and put it there."}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Where it goes</span>
            <Input value={label} onChange={(e) => { setLabel(e.target.value); setError(null); }} maxLength={60} placeholder="e.g. Entrance" autoFocus aria-invalid={!!error} />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PLACES.map((p) => (
              <button key={p} type="button" onClick={() => { setLabel(p); setError(null); }}
                className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", label === p ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.75_0.12_80/0.15)] font-semibold" : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground")}>{p}</button>
            ))}
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Note <span className="font-normal text-muted-foreground">(optional, staff only)</span></span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. On the desk, left of the bell" />
          </label>
          {error && <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={pending || label.trim().length < 2}>{pending && <Loader2 className="animate-spin" />}{code ? "Save" : "Make the QR"}</Button>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The banner's own "Show to guest" (the first working code — usually Reception's): one tap at the desk. */
export function ShowToGuestButton({ code, hotel }: { code: Pick<QrCodeView, "qr" | "label">; hotel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex h-11 items-center gap-2 rounded-xl bg-linear-to-r from-[#f2d28c] to-[#d9a646] px-4 text-sm font-semibold text-[#1b1611] shadow-[0_10px_24px_-10px_#d9a646] transition-transform hover:-translate-y-0.5">
        <Maximize2 className="size-4" />Show to guest
      </button>
      {open && <GuestView code={code} hotel={hotel} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * "Show to guest": the code big and alone on the screen (full screen where the browser allows it), to turn the
 * screen or tablet towards a guest at the desk. Close with the button or Esc.
 */
export function GuestView({ code, hotel, onClose }: { code: Pick<QrCodeView, "qr" | "label">; hotel: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest onClose, so the view goes full screen once (not again on every parent render).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const close = useCallback(() => onCloseRef.current(), []);
  useEffect(() => {
    const el = ref.current;
    let full = false;
    el?.requestFullscreen?.().then(() => { full = true; }).catch(() => null);
    // Leaving full screen (Esc on a laptop) closes the view too.
    const change = () => { if (full && !document.fullscreenElement) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("fullscreenchange", change);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      window.removeEventListener("keydown", key);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => null);
    };
  }, [close]);

  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Scan to book your stay"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center-safe overflow-y-auto bg-[#0c0806] px-4 py-8 text-center text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(227,189,106,0.2),transparent_50%),radial-gradient(circle_at_10%_95%,rgba(56,97,210,0.3),transparent_45%)]" />
      <button type="button" onClick={close} className="absolute right-4 top-4 inline-flex h-10 items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 text-sm font-medium text-white backdrop-blur hover:bg-white/15">
        <X className="size-4" />Close
      </button>
      <div className="relative flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-192.png" alt="" className="size-10 rounded-full ring-1 ring-[#e3bd6a]/70" />
        <span className="text-xs font-semibold uppercase tracking-[0.34em] text-white/85">{hotel}</span>
      </div>
      <p className="relative mt-5 font-display text-[clamp(2rem,6vw,3.5rem)] font-semibold leading-none">Scan to book</p>
      <p className="relative mt-1 font-display text-[clamp(1.4rem,4vw,2.4rem)] italic leading-none text-[#e3bd6a]">your stay with us</p>
      <div className="relative mt-7 rounded-[2rem] bg-white p-[clamp(0.9rem,2.4vmin,1.6rem)] shadow-[0_0_0_2px_rgba(227,189,106,0.6),0_30px_80px_-30px_rgba(227,189,106,0.7)]">
        <span className="block size-[min(78vw,58vh)] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: code.qr }} />
        <span className="absolute left-1/2 top-1/2 grid size-[min(17vw,12.5vh)] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl bg-white p-1.5 shadow-[0_0_0_1px_rgba(11,16,38,0.08)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-192.png" alt="" className="size-full rounded-xl" />
        </span>
      </div>
      <p className="relative mt-6 max-w-md text-sm text-white/70 sm:text-base">Open your phone camera and point it at the code — see our rooms, pick your dates and book.</p>
    </div>,
    document.body,
  );
}
