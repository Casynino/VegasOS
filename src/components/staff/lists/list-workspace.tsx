"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCheck, Coffee, FileDown, Loader2, Printer, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { ROOM_STATUS_META } from "@/lib/room-status";
import type { BusinessDate } from "@/lib/time/business-date";
import { LIST_SLUG, listNumber, type DailyListData, type HkRow, type ListKind } from "@/lib/daily-lists";
import type { DailyListCopy, StoredDailyList } from "@/server/services/daily-lists";
import { printDailyListAction } from "@/app/staff/(app)/lists/actions";
import { changeRoomStatusAction } from "@/app/staff/(app)/rooms/actions";
import { EmptyState } from "@/components/staff/page-header";
import { GuestListPaper, HousekeepingPaper, LIST_PAPER_ID, type ListHotel } from "./list-paper";
import { saveListPdf } from "./list-pdf";

/**
 * Preview, print and save one of the two daily lists.
 *
 * Today's list is live (Refresh re-reads the hotel). Print or PDF first keeps it as the day's next numbered copy —
 * made on the server from the live data — and that copy is what goes on paper, so a reprint is the same sheet with
 * the same time. Earlier days show only the copies that were printed; a past day is never rebuilt from today's data.
 */

const btn = "inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border/70 bg-card px-2.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60 sm:flex-none";
const gold = "border-transparent bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] hover:brightness-105";
/** Text that goes inside a CSS string of the print footer. */
const plain = (s: string) => s.replace(/["\\<>\r\n]/g, "");

export function ListWorkspace({ kind, today, date, live, copy, copies, hotel, tabs, canTick }: {
  kind: ListKind;
  today: BusinessDate;
  date: BusinessDate;
  /** Today's list as it is now (null on an earlier day, or when a printed copy is open). */
  live: DailyListData | null;
  copy: StoredDailyList | null;
  copies: DailyListCopy[];
  hotel: ListHotel;
  /** The lists this person may open. */
  tabs: ListKind[];
  canTick: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [stored, setStored] = useState(copy);
  const [busy, setBusy] = useState<"print" | "pdf" | null>(null);
  const slug = LIST_SLUG[kind];
  const data = stored?.data ?? live;
  const landscape = kind === "GUESTS";
  const title = kind === "HOUSEKEEPING" ? t("Daily Housekeeping Checklist") : t("In-House Guest & Breakfast List");
  const footer = `${hotel.name} · ${title} · ${t.date(data?.date ?? date, true)}${stored ? ` · ${listNumber(kind, stored.date, stored.copyNo)}` : ""}`;

  /** The copy that goes on paper: the open one, or the live list kept now as the day's next copy. */
  async function paperCopy() {
    if (stored) return stored;
    const res = await printDailyListAction({ kind });
    if (!res.ok) { toast.error(res.error); return null; }
    // On the page before the print window opens, so the sheet carries its number and time.
    flushSync(() => setStored(res.data));
    return res.data;
  }
  const settle = (made: StoredDailyList) => { if (made.id !== copy?.id) router.replace(`/staff/lists/${slug}?copy=${made.id}`); };

  async function print() {
    setBusy("print");
    try {
      const made = await paperCopy();
      if (!made) return;
      window.print();
      settle(made);
    } finally { setBusy(null); }
  }

  async function pdf() {
    setBusy("pdf");
    try {
      const made = await paperCopy();
      const el = document.getElementById(LIST_PAPER_ID);
      if (!made || !el) return;
      try {
        await saveListPdf(el, {
          landscape, footer,
          pageOf: (page, pages) => t("Page {page} of {pages}", { page, pages }),
          fileName: `${hotel.name}-${kind === "HOUSEKEEPING" ? "housekeeping-checklist" : "in-house-guest-breakfast-list"}-${made.date}-${made.copyNo}`.replace(/[^\w]+/g, "-").toLowerCase(),
        });
      } catch {
        toast.error(t("Could not make the PDF — try Print and choose “Save as PDF”."));
      }
      settle(made);
    } finally { setBusy(null); }
  }

  // The page counter of the printed footer, in the reader's language: "Page " counter(page) " of " counter(pages).
  const pageCss = t("Page {page} of {pages}", { page: "@@page@@", pages: "@@pages@@" }).split(/(@@pages?@@)/).filter(Boolean)
    .map((p) => (p === "@@page@@" ? "counter(page)" : p === "@@pages@@" ? "counter(pages)" : `"${plain(p)}"`)).join(" ");
  const css = `@media print {
  @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 10mm 9mm 14mm;
    @bottom-left { content: "${plain(footer)}"; font: 8pt system-ui, sans-serif; color: #111; }
    @bottom-right { content: ${pageCss}; font: 8pt system-ui, sans-serif; color: #111; } }
  html, body, #staff-root { background: #fff !important; }
  #${LIST_PAPER_ID} thead { display: table-header-group; }
  #${LIST_PAPER_ID} tr, #${LIST_PAPER_ID} [data-break] { break-inside: avoid; }
  #${LIST_PAPER_ID}, #${LIST_PAPER_ID} * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

  const toClean = canTick && !stored && live?.kind === "HOUSEKEEPING"
    ? live.rows.filter((r) => r.group === "CHECKOUT" && (r.status === "DIRTY" || r.status === "CLEANING")) : [];

  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <div className="space-y-3 print:hidden">
        {tabs.length > 1 && (
          <nav className="grid gap-2 sm:grid-cols-2">
            {tabs.map((k) => (
              <Link key={k} href={`/staff/lists/${LIST_SLUG[k]}${date === today ? "" : `?date=${date}`}`} aria-current={k === kind ? "page" : undefined}
                className={cn("flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors", k === kind ? "border-[oklch(0.72_0.12_80)] bg-[oklch(0.72_0.12_80/0.12)]" : "border-border/70 bg-card hover:bg-muted")}>
                {k === "HOUSEKEEPING" ? <ClipboardCheck className="size-4.5 shrink-0" /> : <Coffee className="size-4.5 shrink-0" />}
                {k === "HOUSEKEEPING" ? t("Housekeeping Checklist") : t("In-House Guest & Breakfast List")}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card p-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-muted-foreground sm:flex-none">
            {t("Reporting date")}
            <input type="date" value={date} max={today} onChange={(e) => { const v = e.target.value; if (v && v <= today) router.push(`/staff/lists/${slug}${v === today ? "" : `?date=${v}`}`); }}
              className="h-9 min-w-0 flex-1 rounded-xl border border-border/70 bg-background px-2.5 text-sm text-foreground sm:flex-none" />
          </label>
          <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            {live && !stored && <button type="button" className={btn} onClick={() => router.refresh()}><RefreshCw className="size-3.5" /> {t("Refresh")}</button>}
            <button type="button" className={btn} disabled={!data || !!busy} onClick={pdf}>{busy === "pdf" ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />} {t("Download PDF")}</button>
            <button type="button" className={cn(btn, gold)} disabled={!data || !!busy} onClick={print}>{busy === "print" ? <Loader2 className="size-3.5 animate-spin" /> : <Printer className="size-3.5" />} {t("Print")}</button>
          </div>
        </div>

        {data && (
          <p className="px-1 text-xs text-muted-foreground">
            {stored
              ? <>{t("Printed copy {number} — made {when} by {name}. It stays exactly as it was printed.", { number: listNumber(kind, stored.date, stored.copyNo), when: t.dateTime(stored.generatedAt, stored.data.timezone), name: stored.generatedBy })}{" "}
                  {stored.date === today && <Link href={`/staff/lists/${slug}`} className="font-semibold text-foreground underline underline-offset-2">{t("Open the live list")}</Link>}</>
              : t("Live list — read from the hotel at {time}. Print keeps this exact list as a numbered copy.", { time: t.time(data.generatedAt, data.timezone) })}
          </p>
        )}

        {copies.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs">
            <span className="font-semibold uppercase tracking-[0.16em] text-muted-foreground">{date === today ? t("Printed today") : t("Printed on this day")}</span>
            {copies.map((c) => (
              <Link key={c.id} href={`/staff/lists/${slug}?copy=${c.id}`} className={cn("underline-offset-2 hover:underline", c.id === stored?.id ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {t("Copy {n} · {time} · {name}", { n: c.copyNo, time: t.time(c.generatedAt, data?.timezone), name: c.generatedBy.replace(/\s*\(.*\)$/, "") })}
              </Link>
            ))}
          </div>
        )}

        {toClean.length > 0 && <RoomTicks rows={toClean} />}
      </div>

      {!data ? (
        <div className="print:hidden"><EmptyState title={t("No list was printed on this day.")} description={t("Earlier days show the copies that were printed then. Today’s list is always live.")} /></div>
      ) : data.kind === "HOUSEKEEPING" ? (
        <HousekeepingPaper list={data} hotel={hotel} stamp={{ number: stored ? listNumber(kind, stored.date, stored.copyNo) : null, by: stored?.generatedBy ?? null }} />
      ) : (
        <GuestListPaper list={data} hotel={hotel} stamp={{ number: stored ? listNumber(kind, stored.date, stored.copyNo) : null, by: stored?.generatedBy ?? null }} />
      )}
    </div>
  );
}

/**
 * Mark the rooms in the system, right here — ticks on paper change nothing. The same room-status step, permission
 * and history as the Rooms page: needs cleaning → cleaning → clean and ready.
 */
function RoomTicks({ rows }: { rows: HkRow[] }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function mark(r: HkRow, status: "CLEANING" | "READY") {
    setBusy(r.roomId);
    const res = await changeRoomStatusAction({ roomId: r.roomId, status });
    setBusy(null);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(t("Room {room}: {status}.", { room: r.room, status: t(ROOM_STATUS_META[status].label).toLowerCase() }));
    if (res.data.warning) toast.warning(res.data.warning, { duration: 10000 });
    router.refresh();
  }

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-3">
      <h2 className="text-sm font-semibold">{t("Mark rooms in the system")}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("Ticks on the printed sheet change nothing. When a room is done and checked, mark it here.")}</p>
      <ul className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <li key={r.roomId} className="flex items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2">
            <span className="text-lg font-bold tabular-nums">{r.room}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t(ROOM_STATUS_META[r.status].label)}{r.arrivalToday ? ` · ${t("Guest arriving today")}` : ""}</span>
            {busy === r.roomId ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
              <>
                {r.status === "DIRTY" && <button type="button" disabled={!!busy} onClick={() => mark(r, "CLEANING")} className="h-8 shrink-0 rounded-lg border border-border/70 px-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-60">{t("Start cleaning")}</button>}
                <button type="button" disabled={!!busy} onClick={() => mark(r, "READY")} className={cn("h-8 shrink-0 rounded-lg border px-2.5 text-xs font-semibold disabled:opacity-60", gold)}>{t("Clean & ready")}</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
