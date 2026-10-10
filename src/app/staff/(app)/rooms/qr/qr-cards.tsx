"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, ExternalLink, Eye, FileDown, Loader2, Plus, Power, Printer, QrCode, RefreshCw, X } from "lucide-react";
import { qrSvg } from "@/lib/qr-svg";
import { QrPrintCard as PrintCard, saveFile as save, snapQrCard as snap, type Printable } from "@/components/staff/qr/qr-print-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { jpegFromDataUrl, jpegsToPdf } from "@/lib/jpeg-pdf";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { regenerateRoomQrAction, setRoomQrActiveAction } from "../../restaurant/actions";

type Card = { id: string; number: string; type: string; floor: number | null; url: string; qr: string; meeting: boolean; active: boolean; scans: number; lastScan: string | null; now: string };

/**
 * Room QR cards: one permanent card per room (and the meeting room) and the public menu card.
 * View, print one or all (four A6 cards per A4 page), download a card (image) or all (PDF),
 * make a new QR, switch a room's QR off / on.
 */
export function QrCards({ cards, hotel, phone, canManage, publicCard, origin, autoPrint = null }: {
  cards: Card[]; hotel: string; phone: string | null; canManage: boolean; publicCard: { url: string; qr: string }; origin: string;
  /** Opened to print one card (from a room's window or the restaurant): "public", "table:Table 4" or a room id. */
  autoPrint?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const startTable = autoPrint?.startsWith("table:") ? autoPrint.slice(6) : null;
  const [tables, setTables] = useState<Printable[]>(() => (startTable ? [tableCard(startTable, origin, 0)] : []));
  const [only, setOnly] = useState<string[] | null>(() => (autoPrint ? [startTable ? tables0Id(startTable) : autoPrint] : null));
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Card | null>(null);
  const [tableName, setTableName] = useState("");
  const [pending, start] = useTransition();

  const rooms: Printable[] = cards.filter((c) => c.active).map((c) => ({ id: c.id, kind: c.meeting ? "meeting" : "room", title: c.number, url: c.url, qr: c.qr }));
  const publics: Printable[] = [{ id: "public", kind: "public", title: "Our menu", url: publicCard.url, qr: publicCard.qr }, ...tables];

  const print = (ids: string[] | null) => {
    setOnly(ids);
    const reset = () => { setOnly(null); window.removeEventListener("afterprint", reset); };
    window.addEventListener("afterprint", reset);
    setTimeout(() => window.print(), 60);
  };
  const downloadOne = async (id: string, name: string) => {
    const node = document.getElementById(`qr-${id}`);
    if (!node) return;
    setBusy(id);
    try { save(await snap(node), `${name}.jpg`); } catch { toast.error(t("Could not make the image — try again.")); } finally { setBusy(null); }
  };
  const downloadAll = async (list: Printable[], name: string) => {
    setBusy(name);
    try {
      const pages = [];
      for (const c of list) {
        const node = document.getElementById(`qr-${c.id}`);
        if (node) pages.push(await jpegFromDataUrl(await snap(node)));
      }
      const href = URL.createObjectURL(new Blob([jpegsToPdf(pages, 298)], { type: "application/pdf" })); // 105 mm wide
      save(href, `${name}.pdf`);
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch { toast.error(t("Could not make the PDF — try again.")); } finally { setBusy(null); }
  };
  const regenerate = (c: Card) => start(async () => {
    const res = await regenerateRoomQrAction({ roomId: c.id });
    if (res.ok) { toast.success(res.message ?? t("New QR made.")); setConfirm(null); router.refresh(); } else toast.error(res.error);
  });
  const toggle = (c: Card) => start(async () => {
    const res = await setRoomQrActiveAction({ roomId: c.id, active: !c.active });
    if (res.ok) { toast.success(res.message ?? t("Saved.")); router.refresh(); } else toast.error(res.error);
  });
  const addTable = () => {
    const name = tableName.trim();
    if (!name) return;
    setTables((xs) => [...xs, tableCard(name, origin, xs.length)]);
    setTableName("");
  };
  const hidden = (id: string) => only !== null && !only.includes(id);

  // Opened just to print one card: print it once the page (and the logo) has loaded.
  useEffect(() => {
    if (!autoPrint) return;
    const reset = () => { setOnly(null); window.removeEventListener("afterprint", reset); };
    window.addEventListener("afterprint", reset);
    const imgs = [...document.querySelectorAll("article img")] as HTMLImageElement[];
    const timer = setTimeout(() => { void Promise.all(imgs.map((i) => i.decode().catch(() => null))).then(() => window.print()); }, 300);
    return () => { clearTimeout(timer); window.removeEventListener("afterprint", reset); };
  }, [autoPrint]);

  return (
    <>
      <style>{`@media print { @page { size: A4; margin: 8mm; } }`}</style>
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"><QrCode className="size-4" />{t("Menu & guest QR")}</p>
          <h1 className="font-display text-3xl font-semibold">{t("Room QR codes")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("Every room has its own permanent card. Scanning it opens the guest checked in to that room right now — their stay, bill, menu and ordering to the room. When the room is free it shows the room, its status and the menu. The public menu card is for the restaurant and anyone who is not staying.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => print(rooms.map((r) => r.id))}><Printer />{t("Print all rooms ({n})", { n: rooms.length })}</Button>
          <Button disabled={!!busy} onClick={() => downloadAll(rooms, "Room-QR-cards")}>{busy === "Room-QR-cards" ? <Loader2 className="animate-spin" /> : <FileDown />}{t("Download all (PDF)")}</Button>
        </div>
      </div>

      {/* Public menu QR */}
      <section className={cn("rounded-3xl border border-border/70 bg-card/60 p-4 print:border-0 print:bg-transparent print:p-0", only && !publics.some((p) => only.includes(p.id)) && "print:hidden")}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <div>
            <p className="font-semibold">{t("Public menu QR")}</p>
            <p className="text-xs text-muted-foreground">{t("For restaurant tables, the bar and reception — anyone can order (dine in, takeaway, pickup). It is never linked to a room.")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder={t("Table name, e.g. Table 4")} className="h-9 w-44" onKeyDown={(e) => e.key === "Enter" && addTable()} />
            <Button size="sm" variant="outline" onClick={addTable} disabled={!tableName.trim()}><Plus />{t("Table card")}</Button>
            <Button size="sm" variant="outline" onClick={() => print(publics.map((p) => p.id))}><Printer />{t("Print")}</Button>
            <Button size="sm" disabled={!!busy} onClick={() => downloadAll(publics, "Public-menu-QR")}>{busy === "Public-menu-QR" ? <Loader2 className="animate-spin" /> : <FileDown />}PDF</Button>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] justify-items-center gap-5 print:grid-cols-2 print:gap-[6mm]">
          {publics.map((p) => (
            <div key={p.id} className={cn("w-full max-w-[420px] space-y-2 print:max-w-none print:break-inside-avoid", hidden(p.id) && "print:hidden")}>
              <PrintCard card={p} hotel={hotel} phone={phone} />
              <div className="flex items-center justify-between gap-2 print:hidden">
                <span className="text-xs text-muted-foreground">{p.table ?? t("General — restaurant & reception")}</span>
                <span className="flex gap-1">
                  <a href={p.url} target="_blank" rel="noopener" className="grid size-8 place-items-center rounded-lg hover:bg-muted" title={t("Open")}><ExternalLink className="size-4" /></a>
                  <Button size="sm" variant="ghost" onClick={() => print([p.id])} title={t("Print")}><Printer /></Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => downloadOne(p.id, p.table ? `Menu-QR-${p.table}` : "Menu-QR")} title={t("Download")}>{busy === p.id ? <Loader2 className="animate-spin" /> : <Download />}</Button>
                  {p.table && <Button size="sm" variant="ghost" onClick={() => setTables((xs) => xs.filter((x) => x.id !== p.id))} title={t("Remove")}><X /></Button>}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Rooms */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] justify-items-center gap-5 print:grid-cols-2 print:gap-[6mm]">
        {cards.map((c) => (
          <div key={c.id} className={cn("w-full max-w-[420px] space-y-2 print:max-w-none print:break-inside-avoid", (hidden(c.id) || !c.active) && "print:hidden")}>
            <div className="relative">
              <PrintCard card={{ id: c.id, kind: c.meeting ? "meeting" : "room", title: c.number, url: c.url, qr: c.qr }} hotel={hotel} phone={phone} />
              {!c.active && <div className="absolute inset-0 grid place-items-center rounded-[22px] bg-black/60 text-sm font-semibold text-white print:hidden">{t("QR switched off")}</div>}
            </div>
            <div className="space-y-1.5 rounded-2xl border border-border/70 bg-card px-3 py-2 print:hidden">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate"><strong>{c.meeting ? t("Meeting room {room}", { room: c.number }) : t("Room {room}", { room: c.number })}</strong> · {c.type}</span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-semibold", c.active ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{c.active ? t("Active") : t("Off")}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("Now: {now}", { now: c.now })} · {t.plural(c.scans, "{n} scan", "{n} scans")}{c.lastScan ? ` · ${t("last {when}", { when: new Date(c.lastScan).toLocaleString(t.intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}` : ""}</p>
              <div className="flex flex-wrap gap-1">
                <a href={`${c.url}?view=guest`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs hover:bg-muted" title={t("See what a guest sees when they scan")}><Eye className="size-3.5" />{t("Guest view")}</a>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => print([c.id])} disabled={!c.active}><Printer />{t("Print")}</Button>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={!!busy} onClick={() => downloadOne(c.id, `Room-${c.number}-QR`)}>{busy === c.id ? <Loader2 className="animate-spin" /> : <Download />}{t("Download")}</Button>
                {canManage && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setConfirm(c)}><RefreshCw />{t("New QR")}</Button>}
                {canManage && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={pending} onClick={() => toggle(c)}><Power />{c.active ? t("Switch off") : t("Switch on")}</Button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<QrCode />} eyebrow={t("Room QR")} tone="sky">
            <DialogTitle>{confirm?.meeting ? t("New QR for the meeting room?") : t("New QR for room {room}?", { room: confirm?.number })}</DialogTitle>
            <DialogDescription>{t("The card in the room now stops working — print the new card and replace it. Past orders are not affected. Use this if a card went missing or was copied.")}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button disabled={pending} onClick={() => confirm && regenerate(confirm)}>{pending && <Loader2 className="animate-spin" />}{t("Make a new QR")}</Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>{t("Keep the current one")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const tables0Id = (t: string) => `table-0-${t.replace(/\W+/g, "")}`;
/** A restaurant table's card: the public menu with the table filled in. */
function tableCard(t: string, origin: string, i: number): Printable {
  const url = `${origin}/order?qr=1&table=${encodeURIComponent(t)}`;
  return { id: `table-${i}-${t.replace(/\W+/g, "")}`, kind: "public", title: "Our menu", url, qr: qrSvg(url), table: t };
}
