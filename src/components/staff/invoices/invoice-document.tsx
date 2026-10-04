import Image from "next/image";
import QRCode from "qrcode";
import { Building2, Landmark, ScanLine, Smartphone } from "lucide-react";
import { formatBusinessDate, formatDateTime, formatNumber } from "@/lib/format";
import { termsLabel } from "@/lib/billing";
import { cn } from "@/lib/utils";
import type { HotelSettings } from "@/generated/prisma/client";
import type { InvoiceStatus } from "@/generated/prisma/enums";

/** The department a line came from — kept from the room's folio, so the invoice and the ledger agree. */
export type InvoiceDept = "ROOM" | "MEETING" | "RESTAURANT" | "BAR" | "ROOM_SERVICE" | "TRANSPORT" | "OTHER";
export const DEPT_LABEL: Record<InvoiceDept, string> = {
  ROOM: "Accommodation", MEETING: "Meeting room", RESTAURANT: "Restaurant / food", BAR: "Bar", ROOM_SERVICE: "Room service", TRANSPORT: "Transport", OTHER: "Other",
};
const DEPT_ORDER: InvoiceDept[] = ["ROOM", "MEETING", "RESTAURANT", "BAR", "ROOM_SERVICE", "TRANSPORT", "OTHER"];
const DEPT_SHORT: Record<InvoiceDept, string> = { ROOM: "Rooms", MEETING: "Meeting", RESTAURANT: "Food", BAR: "Bar", ROOM_SERVICE: "Room svc", TRANSPORT: "Transport", OTHER: "Other" };

export type InvoiceDoc = {
  number: string;
  status: InvoiceStatus;
  issueDate: string | null;
  dueDate: string | null;
  terms: number | null;
  billTo: {
    name: string; attn?: string | null; lines: string[]; tax?: string | null; contact?: string | null;
    /** The billing party's contact person (group invoices). */
    person?: { name: string; phone: string | null; email: string | null } | null;
    /** Special billing notes (e.g. "LPO number required"). */
    note?: string | null;
  };
  bookings: string[];
  items: {
    id: string; description: string; quantity: number; unitAmount: number; discountAmount: number; netAmount: number;
    reservationId: string | null; guestName: string | null; roomNumber: string | null; from: string | null; to: string | null; reference: string | null;
    isRoom: boolean;
    /** Folio department (older documents may not have it). */
    dept?: InvoiceDept;
    /** Business date of a folio charge. */
    date?: string | null;
  }[];
  /** The stays on the invoice: reference, people, others sharing the room, dates. */
  stays?: Record<string, { reference: string; people: number; others: string[]; arrival: string; departure: string }>;
  gross: number; discount: number; net: number; paid: number; balance: number;
  payments: { id: string; at: Date; method: string; reference: string | null; amount: number; refund: boolean }[];
  notes: string | null;
  cancelReason: string | null;
  /** Group invoice: the group it bills (a line per room & guest). */
  group?: { name: string; reference: string; rooms: number; /** The final group invoice (made when the group was finalized). */ final?: boolean } | null;
  /** What the total is made of — rooms, restaurant, bar, room service, transport, other. */
  byKind?: { label: string; amount: number }[];
};

// Stamps sit on the dark header, so they use light ink.
const STAMP: Record<InvoiceStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "border-white/40 text-white/60" },
  ISSUED: { label: "Unpaid", cls: "border-rose-400 text-rose-300" },
  OVERDUE: { label: "Overdue", cls: "border-rose-400 bg-rose-500/15 text-rose-300" },
  PARTIALLY_PAID: { label: "Part paid", cls: "border-amber-300 text-amber-200" },
  PAID: { label: "Paid", cls: "border-emerald-400 bg-emerald-500/15 text-emerald-300" },
  CANCELLED: { label: "Cancelled", cls: "border-white/40 text-white/50" },
  VOID: { label: "Void", cls: "border-white/40 text-white/50" },
};

const n = (v: number) => formatNumber(v);
const ADJUSTMENT = /^(Adjustment|Credit):/;
const shortDay = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const day = (d: string | null) => (d ? formatBusinessDate(d) : "—");
/** A stay's dates come from its room lines (a dinner on the last night does not move the checkout). */
const stayRange = (items: InvoiceDoc["items"]) => {
  const rooms = items.filter((i) => i.isRoom && i.from);
  const src = rooms.length ? rooms : items.filter((i) => i.from);
  if (!src.length) return "";
  return range(src.map((i) => i.from!).sort()[0], src.map((i) => i.to ?? i.from!).sort().at(-1)!);
};
const range = (a: string | null, b: string | null) => (a && b && a !== b ? `${formatBusinessDate(a)} → ${formatBusinessDate(b)}` : a ? formatBusinessDate(a) : "");

/**
 * The invoice as the company receives it: branded header with a status stamp,
 * who it is for, the stays line by line (guest · room · dates), where to pay,
 * the amount due and a scan-to-verify code. Prints on one clean A4 page.
 */
export async function InvoiceDocument({ inv, s, verifyUrl, proforma = false, title, statement = false }: {
  inv: InvoiceDoc; s: HotelSettings; verifyUrl: string | null;
  /** Booking / proforma invoice before the stay: a request for payment, not a tax invoice and not a receipt. */
  proforma?: boolean;
  /** Heading instead of "Proforma invoice" (e.g. "Group statement"). */
  title?: string;
  /** A statement of charges so far (not an invoice): its own words throughout. */
  statement?: boolean;
}) {
  const w = statement
    ? { due: "Balance so far", total: "Charges so far", to: "Statement for", details: "Statement details", no: "Statement no.", tag: "STATEMENT", stamp: "Statement" }
    : { due: "Amount due", total: "Invoice total", to: "Invoice to", details: "Invoice details", no: "Invoice no.", tag: "GROUP INVOICE", stamp: "Proforma" };
  const payRef = statement ? inv.group?.reference ?? inv.number : inv.number;
  const qr = verifyUrl
    ? await QRCode.toString(verifyUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#15110c", light: "#00000000" } })
    : null;
  const stamp = proforma ? { label: w.stamp, cls: "border-amber-300 text-amber-200" } : STAMP[inv.status];
  const dead = inv.status === "VOID" || inv.status === "CANCELLED";

  // Lines grouped by stay (company invoices), so every guest, room and date is clear.
  const groups: { key: string; head: InvoiceDoc["items"][number] | null; items: InvoiceDoc["items"] }[] = [];
  for (const it of inv.items) {
    const key = it.reservationId ?? "_";
    const g = groups.find((x) => x.key === key);
    if (g) g.items.push(it); else groups.push({ key, head: it.guestName ? it : null, items: [it] });
  }
  const groupTotal = (items: InvoiceDoc["items"]) => items.reduce((t, i) => t + i.netAmount, 0);
  // Group / multi-stay invoice: one folio per room — accommodation, discount, food, bar, room service, transport, other, room total.
  const folios = groups.filter((g) => g.head && g.key !== "_").map((g) => {
    const stay = inv.stays?.[g.key];
    const dept = (d: InvoiceDept) => g.items.filter((i) => (i.dept ?? (i.isRoom ? "ROOM" : "OTHER")) === d);
    const nights = g.items.filter((i) => i.isRoom && i.dept !== "MEETING" && !ADJUSTMENT.test(i.description) && !i.description.endsWith("short time")).reduce((t, i) => t + i.quantity, 0);
    return {
      key: g.key, guest: g.head!.guestName ?? "Guest", room: g.head!.roomNumber, reference: stay?.reference ?? g.head!.reference,
      others: stay?.others ?? [], people: stay?.people ?? null,
      from: stay?.arrival ?? g.items.find((i) => i.from)?.from ?? null, to: stay?.departure ?? g.items.find((i) => i.to)?.to ?? null, nights,
      depts: DEPT_ORDER.map((d) => ({ d, items: dept(d) })).filter((x) => x.items.length > 0),
      gross: g.items.reduce((t, i) => t + i.netAmount + i.discountAmount, 0),
      discount: g.items.reduce((t, i) => t + i.discountAmount, 0),
      total: groupTotal(g.items),
    };
  });
  const loose = groups.filter((g) => !g.head || g.key === "_").flatMap((g) => g.items);
  const folioMode = !!inv.group || folios.length > 1;
  const people = folios.reduce((t, f) => t + (f.people ?? 1), 0);
  const firstDay = folios.map((f) => f.from).filter((x): x is string => !!x).sort()[0] ?? null;
  const lastDay = folios.map((f) => f.to).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const usedDepts = DEPT_ORDER.filter((d) => folios.some((f) => f.depts.some((x) => x.d === d)));
  // Group invoice layout: room lines, extra charges by department, and adjustments (changes after billing) on their own.
  const deptOfItem = (i: InvoiceDoc["items"][number]): InvoiceDept => i.dept ?? (i.isRoom ? "ROOM" : "OTHER");
  const isAdj = (i: InvoiceDoc["items"][number]) => ADJUSTMENT.test(i.description);
  const billed = inv.items.filter((i) => !isAdj(i) && (!folioMode || !loose.includes(i)));
  const roomLines = billed.filter((i) => deptOfItem(i) === "ROOM" && i.reservationId).sort((a, b) => (a.roomNumber ?? "").localeCompare(b.roomNumber ?? "", undefined, { numeric: true }));
  const roomDiscount = roomLines.reduce((t, i) => t + i.discountAmount, 0);
  const extraDepts = DEPT_ORDER.filter((d) => d !== "ROOM").map((d) => ({ d, items: billed.filter((i) => deptOfItem(i) === d && i.reservationId) })).filter((x) => x.items.length > 0);
  const adjLines = inv.items.filter(isAdj);
  const adjustments = adjLines.reduce((t, i) => t + i.netAmount, 0);
  const subtotal = inv.items.filter((i) => !isAdj(i)).reduce((t, i) => t + i.netAmount + i.discountAmount, 0);
  const discounts = inv.items.filter((i) => !isAdj(i)).reduce((t, i) => t + i.discountAmount, 0);
  const deptTotals = DEPT_ORDER.map((d) => ({ label: DEPT_LABEL[d], amount: inv.items.filter((i) => !isAdj(i) && deptOfItem(i) === d).reduce((t, i) => t + i.netAmount + i.discountAmount, 0) })).filter((x) => x.amount !== 0);
  const hasBank = !!(s.bankName && s.bankAccountNumber);
  // Prices include the tax (when set up): show the part of the total that is tax.
  const taxRate = s.taxRatePercent ? Number(s.taxRatePercent) : 0;
  const tax = taxRate > 0 && s.taxIncludedInRates && inv.net > 0 ? { name: s.taxName || "VAT", rate: taxRate, amount: Math.round((inv.net * taxRate) / (100 + taxRate)) } : null;
  const hasMobile = !!s.mobileMoneyNumber;
  let row = 0;

  return (
    <article id="invoice-doc" className="invoice-sheet group/doc relative mx-auto w-full max-w-[880px] overflow-hidden rounded-[28px] bg-white text-[#1d1a16] shadow-[0_2px_6px_rgba(15,23,42,0.05),0_40px_80px_-40px_rgba(15,23,42,0.55)] print:max-w-none print:rounded-none print:shadow-none" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
      {/* Header */}
      <header data-break className="relative overflow-hidden bg-[#15110c] px-8 pb-8 pt-7 text-white sm:px-10">
        <div className="pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-[#c9a24a]/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-1/3 size-72 rounded-full bg-[#c9a24a]/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-16 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
              <Image src="/brand/logo-192.png" alt="" width={52} height={52} />
            </span>
            <div className="leading-tight">
              <p className="font-display text-2xl font-semibold tracking-tight">{s.hotelName}</p>
              {s.tagline && <p className="mt-0.5 text-[11px] uppercase tracking-[0.22em] text-[#f0cf86]/80">{s.tagline}</p>}
              <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-white/55">
                {[s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", ")}
                <br />{[s.phone, s.email, s.website].filter(Boolean).join("  ·  ")}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[#f0cf86]">{proforma ? (title ?? "Proforma invoice") : inv.group ? (inv.group.final ? "Final group invoice" : "Group invoice") : "Invoice"}</p>
            <p className="mt-1 font-mono text-2xl font-semibold tracking-tight">{inv.number}</p>
            <p className="mt-1 text-[11px] text-white/50">{proforma ? `Prepared ${day(inv.issueDate)} · not a tax invoice` : inv.issueDate ? `Issued ${day(inv.issueDate)}` : "Not issued yet"}</p>
            <span className={cn("mt-3 inline-block -rotate-6 rounded-lg border-[3px] px-3 py-0.5 font-mono text-base font-bold uppercase tracking-[0.22em]", stamp.cls)}>
              {stamp.label}
            </span>
          </div>
        </div>
        <div className="relative mt-7 grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-white/10 text-center ring-1 ring-white/10">
          {[
            [w.due, `${s.currency} ${n(Math.max(0, inv.balance))}`],
            ["Due date", inv.dueDate ? day(inv.dueDate) : inv.terms != null ? termsLabel(inv.terms) : "—"],
            [w.total, `${s.currency} ${n(inv.net)}`],
          ].map(([k, v], i) => (
            <div key={k} className={cn("bg-[#15110c]/60 px-3 py-3", i === 0 && "bg-[#c9a24a]/15")}>
              <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">{k}</p>
              <p className={cn("mt-0.5 font-semibold tabular-nums", i === 0 ? "text-lg text-[#f0cf86]" : "text-sm")}>{v}</p>
            </div>
          ))}
        </div>
      </header>
      <div className="h-1 bg-gradient-to-r from-[#8a6a25] via-[#f0cf86] to-[#8a6a25]" />

      <div className="space-y-8 px-8 py-8 sm:px-10">
        {/* Who & what */}
        <section data-break className="grid gap-4 sm:grid-cols-2 group-data-[paper=true]/doc:grid-cols-2">
          <div className="rounded-2xl border border-[#eadfca] bg-[#fbf8f2] p-5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7a35]"><Building2 className="size-3.5" />{w.to}</p>
            <p className="mt-2 text-lg font-semibold leading-snug">{inv.billTo.name}</p>
            {inv.billTo.attn && <p className="text-sm text-[#5b534a]">Attn: {inv.billTo.attn}</p>}
            {inv.billTo.person && (
              <p className="mt-1 text-sm text-[#5b534a]">
                Contact person: <strong className="text-[#1d1a16]">{inv.billTo.person.name}</strong>
                {(inv.billTo.person.phone || inv.billTo.person.email) && <span className="block text-xs">{[inv.billTo.person.phone, inv.billTo.person.email].filter(Boolean).join("  ·  ")}</span>}
              </p>
            )}
            {inv.billTo.lines.map((l) => <p key={l} className="text-sm text-[#5b534a]">{l}</p>)}
            {inv.billTo.tax && <p className="mt-2 text-xs text-[#8a8177]">{inv.billTo.tax}</p>}
            {inv.billTo.contact && <p className="text-xs text-[#8a8177]">{inv.billTo.contact}</p>}
            {inv.billTo.note && <p className="mt-2 text-xs italic text-[#8a8177]">{inv.billTo.note}</p>}
            {inv.group && <p className="mt-3 rounded-lg bg-[#f3ead7] px-2.5 py-1.5 text-xs font-semibold text-[#6b5320]">{inv.group.name.toUpperCase()} — {w.tag} · {inv.group.reference}</p>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-2xl border border-[#eadfca] p-5 text-sm">
            <p className="col-span-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7a35]">{w.details}</p>
            <dt className="text-[#8a8177]">{w.no}</dt><dd className="text-right font-mono font-semibold">{inv.number}</dd>
            <dt className="text-[#8a8177]">Issue date</dt><dd className="text-right">{day(inv.issueDate)}</dd>
            <dt className="text-[#8a8177]">Due date</dt><dd className="text-right font-semibold">{day(inv.dueDate)}</dd>
            {inv.terms != null && <><dt className="text-[#8a8177]">Terms</dt><dd className="text-right">{termsLabel(inv.terms)}</dd></>}
            {folioMode && firstDay && <><dt className="text-[#8a8177]">Stay</dt><dd className="text-right">{range(firstDay, lastDay)}</dd></>}
            {folioMode && <><dt className="text-[#8a8177]">Rooms · guests</dt><dd className="text-right font-semibold">{folios.length} room{folios.length === 1 ? "" : "s"} · {people} guest{people === 1 ? "" : "s"}</dd></>}
            {inv.bookings.length > 0 && !folioMode && <><dt className="text-[#8a8177]">Booking{inv.bookings.length > 1 ? "s" : ""}</dt><dd className="text-right font-mono text-xs leading-5">{inv.bookings.join(", ")}</dd></>}
            <dt className="text-[#8a8177]">Currency</dt><dd className="text-right">{s.currency}</dd>
          </dl>
        </section>

        {/* Group / multi-stay invoice: rooms, then extra charges by department (each with its room & guest), then each room's total */}
        {folioMode && (
          <section data-break className="space-y-5">
            <div className="break-inside-avoid">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7a35]">Room breakdown</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-[#15110c] text-left text-[10px] uppercase tracking-[0.14em] text-[#8a8177]">
                    <th className="py-2 font-semibold">Room</th><th className="py-2 font-semibold">Guest</th><th className="hidden py-2 font-semibold sm:table-cell group-data-[paper=true]/doc:table-cell">Room type</th>
                    <th className="py-2 text-right font-semibold">Nights</th><th className="hidden py-2 text-right font-semibold sm:table-cell group-data-[paper=true]/doc:table-cell">Rate</th>
                    {roomDiscount > 0 && <th className="py-2 text-right font-semibold">Discount</th>}
                    <th className="py-2 text-right font-semibold">Room total</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {roomLines.map((i) => {
                    const stay = i.reservationId ? inv.stays?.[i.reservationId] : undefined;
                    const short = i.description.endsWith("short time");
                    return (
                      <tr data-break key={i.id} className="border-b border-[#efe7da] align-top">
                        <td className="py-2 font-semibold">{i.roomNumber ?? "—"}</td>
                        <td className="py-2">{i.guestName ?? "—"}{stay?.others.length ? <span className="block text-xs text-[#8a8177]">with {stay.others.join(", ")}</span> : null}</td>
                        <td className="hidden py-2 sm:table-cell group-data-[paper=true]/doc:table-cell">{i.description.split(" · ")[0]}</td>
                        <td className="py-2 text-right">{short ? "short time" : i.quantity}</td>
                        <td className="hidden py-2 text-right sm:table-cell group-data-[paper=true]/doc:table-cell">{n(i.unitAmount)}</td>
                        {roomDiscount > 0 && <td className="py-2 text-right text-emerald-700">{i.discountAmount ? `− ${n(i.discountAmount)}` : "—"}</td>}
                        <td className="py-2 text-right font-semibold">{n(i.netAmount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr className="font-semibold tabular-nums"><td colSpan={roomDiscount > 0 ? 6 : 5} className="py-2 text-right text-[#8a8177] max-sm:hidden group-data-[paper=true]/doc:table-cell">Rooms</td><td className="py-2 text-right sm:hidden group-data-[paper=true]/doc:hidden" colSpan={roomDiscount > 0 ? 4 : 3}>Rooms</td><td className="py-2 text-right">{n(roomLines.reduce((t, i) => t + i.netAmount, 0))}</td></tr></tfoot>
              </table>
            </div>

            {extraDepts.length > 0 && (
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7a35]">Additional charges</p>
                {extraDepts.map(({ d, items }) => (
                  <div key={d} className="break-inside-avoid overflow-hidden rounded-2xl border border-[#eadfca]">
                    <p className="flex justify-between bg-[#f6efe2] px-4 py-2 text-sm font-semibold"><span>{DEPT_LABEL[d]}</span><span className="tabular-nums">{n(items.reduce((t, i) => t + i.netAmount, 0))}</span></p>
                    <table className="w-full text-sm"><tbody className="tabular-nums">
                      {items.map((i) => (
                        <tr data-break key={i.id} className="border-t border-[#efe7da] align-top">
                          <td className="px-4 py-1.5">{i.date && <span className="text-xs text-[#8a8177]">{shortDay(i.date)} · </span>}{d === "MEETING" ? i.description : i.description}</td>
                          <td className="px-2 py-1.5 text-xs text-[#5b534a]">{i.roomNumber ? `Room ${i.roomNumber}` : ""}{i.guestName ? `${i.roomNumber ? " · " : ""}${i.guestName}` : ""}</td>
                          <td className="w-28 px-4 py-1.5 text-right font-semibold">{n(i.netAmount)}</td>
                        </tr>
                      ))}
                    </tbody></table>
                  </div>
                ))}
              </div>
            )}

            {adjLines.length > 0 && (
              <div className="break-inside-avoid overflow-hidden rounded-2xl border border-[#eadfca]">
                <p className="flex justify-between bg-[#f6efe2] px-4 py-2 text-sm font-semibold"><span>Adjustments</span><span className="tabular-nums">{adjustments < 0 ? "− " : ""}{n(Math.abs(adjustments))}</span></p>
                <table className="w-full text-sm"><tbody className="tabular-nums">
                  {adjLines.map((i) => (
                    <tr data-break key={i.id} className="border-t border-[#efe7da]">
                      <td className="px-4 py-1.5">{i.description}</td>
                      <td className="px-2 py-1.5 text-xs text-[#5b534a]">{i.roomNumber ? `Room ${i.roomNumber}` : ""}{i.guestName ? ` · ${i.guestName}` : ""}</td>
                      <td className="w-28 px-4 py-1.5 text-right font-semibold">{i.netAmount < 0 ? "− " : ""}{n(Math.abs(i.netAmount))}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}

            {loose.length > 0 && (
              <div className="break-inside-avoid overflow-hidden rounded-2xl border border-[#eadfca]">
                <p className="bg-[#f6efe2] px-4 py-2 text-sm font-semibold">Other items</p>
                <table className="w-full text-sm"><tbody>
                  {loose.map((i) => <tr data-break key={i.id} className="border-t border-[#efe7da]"><td className="px-4 py-1.5">{i.description}{i.quantity > 1 && ` · ${i.quantity} × ${n(i.unitAmount)}`}</td><td className="w-28 px-4 py-1.5 text-right font-semibold tabular-nums">{n(i.netAmount)}</td></tr>)}
                </tbody></table>
              </div>
            )}

            {folios.length > 1 && (
              <div className="break-inside-avoid overflow-x-auto rounded-2xl border border-[#eadfca]">
                <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7a35]">Summary by room</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#15110c] text-left text-[10px] uppercase tracking-[0.12em] text-[#8a8177]">
                      <th className="px-4 py-2 font-semibold">Room · guest</th>
                      {usedDepts.map((d) => <th key={d} className="px-2 py-2 text-right font-semibold">{DEPT_SHORT[d]}</th>)}
                      {inv.discount > 0 && <th className="px-2 py-2 text-right font-semibold">Discount</th>}
                      <th className="px-4 py-2 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {folios.map((f) => (
                      <tr data-break key={f.key} className="border-b border-[#efe7da]">
                        <td className="px-4 py-1.5"><span className="font-semibold">{f.room ?? "—"}</span> · {f.guest}</td>
                        {usedDepts.map((d) => { const v = f.depts.find((x) => x.d === d)?.items.reduce((t, i) => t + i.netAmount + i.discountAmount, 0) ?? 0; return <td key={d} className="px-2 py-1.5 text-right">{v ? n(v) : "—"}</td>; })}
                        {inv.discount > 0 && <td className="px-2 py-1.5 text-right text-emerald-700">{f.discount ? `− ${n(f.discount)}` : "—"}</td>}
                        <td className="px-4 py-1.5 text-right font-semibold">{n(f.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="tabular-nums">
                    <tr className="bg-[#f6efe2] font-semibold">
                      <td className="px-4 py-2">{folios.length} rooms</td>
                      {usedDepts.map((d) => <td key={d} className="px-2 py-2 text-right">{n(folios.reduce((t, f) => t + (f.depts.find((x) => x.d === d)?.items.reduce((s2, i) => s2 + i.netAmount + i.discountAmount, 0) ?? 0), 0))}</td>)}
                      {inv.discount > 0 && <td className="px-2 py-2 text-right text-emerald-700">− {n(folios.reduce((t, f) => t + f.discount, 0))}</td>}
                      <td className="px-4 py-2 text-right text-sm">{n(folios.reduce((t, f) => t + f.total, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Lines */}
        {!folioMode && <section>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-[#15110c] text-left text-[10px] uppercase tracking-[0.16em] text-[#8a8177]">
                <th className="w-8 py-2.5 font-semibold">#</th>
                <th className="py-2.5 font-semibold">Description</th>
                <th className="py-2.5 text-right font-semibold">Qty</th>
                <th className="py-2.5 text-right font-semibold">Rate</th>
                <th className="hidden py-2.5 text-right font-semibold sm:table-cell group-data-[paper=true]/doc:table-cell">Discount</th>
                <th className="py-2.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody data-break key={g.key} className="break-inside-avoid">
                {g.head && (
                  <tr className="bg-[#f6efe2]">
                    <td colSpan={6} className="px-2 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold">
                          {g.head.guestName}
                          {g.head.roomNumber && <span className="font-normal text-[#5b534a]"> · Room {g.head.roomNumber}</span>}
                          {stayRange(g.items) && <span className="font-normal text-[#5b534a]"> · {stayRange(g.items)}</span>}
                        </span>
                        <span className="flex items-center gap-3 text-xs">
                          {g.head.reference && <span className="font-mono text-[#8a8177]">{g.head.reference}</span>}
                          {g.items.length > 1 && <span className="font-semibold tabular-nums">{n(groupTotal(g.items))}</span>}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {g.items.map((i) => (
                  <tr data-break key={i.id} className="border-b border-[#efe7da] align-top">
                    <td className="py-2.5 text-xs tabular-nums text-[#a39a8f]">{String(++row).padStart(2, "0")}</td>
                    <td className="py-2.5 pr-3">
                      {i.description}
                      {!g.head && i.from && <span className="block text-xs text-[#8a8177]">{range(i.from, i.to)}</span>}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{i.quantity}</td>
                    <td className="py-2.5 text-right tabular-nums">{n(i.unitAmount)}</td>
                    <td className="hidden py-2.5 text-right tabular-nums text-emerald-700 sm:table-cell group-data-[paper=true]/doc:table-cell">{i.discountAmount ? `− ${n(i.discountAmount)}` : "—"}</td>
                    <td className="py-2.5 text-right font-semibold tabular-nums">{n(i.netAmount)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          {inv.items.length === 0 && <p className="py-6 text-center text-sm text-[#8a8177]">No lines yet.</p>}
        </section>}

        {/* Pay into + totals */}
        <section data-break className="grid gap-6 sm:grid-cols-[1fr_300px] group-data-[paper=true]/doc:grid-cols-[1fr_300px]">
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7a35]">Pay into</p>
            {hasBank || hasMobile ? (
              <div className="grid gap-3 sm:grid-cols-2 group-data-[paper=true]/doc:grid-cols-2">
                {hasBank && (
                  <div className="rounded-2xl border border-[#eadfca] p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-lg bg-[#15110c] text-[#f0cf86]"><Landmark className="size-3.5" /></span>{s.bankName}</p>
                    <dl className="mt-3 space-y-1 text-xs">
                      {s.bankAccountName && <PayRow k="Account name" v={s.bankAccountName} />}
                      <PayRow k="Account no." v={s.bankAccountNumber!} mono />
                      {s.bankBranch && <PayRow k="Branch" v={s.bankBranch} />}
                      {s.bankSwift && <PayRow k="SWIFT" v={s.bankSwift} mono />}
                    </dl>
                  </div>
                )}
                {hasMobile && (
                  <div className="rounded-2xl border border-[#eadfca] p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-lg bg-emerald-700 text-white"><Smartphone className="size-3.5" /></span>{s.mobileMoneyName || "Mobile money"}</p>
                    <dl className="mt-3 space-y-1 text-xs">
                      <PayRow k="Number" v={s.mobileMoneyNumber!} mono />
                      {s.mobileMoneyAccountName && <PayRow k="Name" v={s.mobileMoneyAccountName} />}
                    </dl>
                  </div>
                )}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-[#eadfca] p-4 text-xs text-[#8a8177]">Pay at reception, or contact us on {s.phone ?? "the hotel number"} for payment details.</p>
            )}
            <p className="text-xs text-[#8a8177]">Please use <strong className="font-mono text-[#1d1a16]">{payRef}</strong> as the payment reference.</p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#eadfca]">
            <dl className="space-y-1.5 p-4 text-sm">
              {(folioMode ? deptTotals.length > 1 : (inv.byKind?.length ?? 0) > 1) && (
                <div className="mb-1.5 space-y-1 border-b border-[#efe7da] pb-1.5 text-xs">
                  {(folioMode ? deptTotals : inv.byKind!).map((k) => <div key={k.label} className="flex justify-between"><dt className="text-[#8a8177]">{k.label}</dt><dd className="tabular-nums">{n(k.amount)}</dd></div>)}
                </div>
              )}
              <div className="flex justify-between"><dt className="text-[#8a8177]">Subtotal</dt><dd className="tabular-nums">{n(folioMode ? subtotal : inv.gross)}</dd></div>
              {(folioMode ? discounts : inv.discount) > 0 && <div className="flex justify-between"><dt className="text-[#8a8177]">Discounts</dt><dd className="tabular-nums text-emerald-700">− {n(folioMode ? discounts : inv.discount)}</dd></div>}
              {folioMode && adjustments !== 0 && <div className="flex justify-between"><dt className="text-[#8a8177]">Adjustments</dt><dd className="tabular-nums">{adjustments < 0 ? "− " : "+ "}{n(Math.abs(adjustments))}</dd></div>}
              <div className="flex justify-between border-t border-[#efe7da] pt-1.5 font-semibold"><dt>{folioMode ? "Final total" : "Total"}</dt><dd className="tabular-nums">{n(inv.net)}</dd></div>
              {tax && <div className="flex justify-between text-xs"><dt className="text-[#8a8177]">incl. {tax.name} {tax.rate}%</dt><dd className="tabular-nums text-[#8a8177]">{n(tax.amount)}</dd></div>}
              <div className="flex justify-between"><dt className="text-[#8a8177]">{folioMode ? "Payments already received" : "Paid"}</dt><dd className="tabular-nums">{inv.paid ? `− ${n(inv.paid)}` : "0"}</dd></div>
            </dl>
            <div className={cn("flex items-end justify-between gap-2 px-4 py-4", dead ? "bg-zinc-100 text-zinc-500" : inv.balance <= 0 ? "bg-emerald-700 text-white" : "bg-[#15110c] text-white")}>
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-70">{dead ? "Not payable" : inv.balance <= 0 ? "Paid in full" : folioMode && !statement ? "Outstanding balance" : w.due}</span>
              <span className="text-right leading-none">
                <span className="mr-1 text-xs opacity-60">{s.currency}</span>
                <span className="text-2xl font-semibold tabular-nums">{n(Math.max(0, inv.balance))}</span>
              </span>
            </div>
          </div>
        </section>

        {inv.payments.length > 0 && (
          <section data-break className="rounded-2xl bg-[#fbf8f2] p-4 text-xs">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7a35]">Payments received</p>
            <ul className="space-y-1">
              {inv.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-3">
                  <span className="text-[#5b534a]">{formatDateTime(p.at)} · {p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                  <span className="font-semibold tabular-nums">{p.refund ? "−" : ""}{n(p.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {inv.notes && <p className="text-sm text-[#5b534a]">{inv.notes}</p>}
        {inv.cancelReason && <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{inv.status === "VOID" ? "Void" : "Cancelled"}: {inv.cancelReason}</p>}

        {/* Footer */}
        <footer data-break className="grid items-end gap-6 border-t border-[#efe7da] pt-6 sm:grid-cols-[1fr_auto] group-data-[paper=true]/doc:grid-cols-[1fr_auto]">
          <div className="space-y-2 text-xs text-[#8a8177]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7a35]">Terms</p>
            <p className="max-w-lg leading-relaxed">
              {statement ? `This statement lists the charges so far, room by room. The final group invoice follows when every room has checked out. Questions: ${[s.phone, s.email].filter(Boolean).join(" · ")}.` : s.invoiceTerms || `Payment is due ${inv.dueDate ? `by ${day(inv.dueDate)}` : "on receipt"}. Please quote the invoice number with your payment. Questions about this invoice: ${[s.phone, s.email].filter(Boolean).join(" · ")}.`}
            </p>
            <p className="pt-2 font-display text-base text-[#1d1a16]">Thank you for choosing {s.hotelName}.</p>
          </div>
          {qr && (
            <div className="flex items-center gap-3 rounded-2xl border border-[#eadfca] p-3">
              <span className="block size-[84px] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
              <span className="max-w-[7.5rem] text-[11px] leading-snug text-[#8a8177]">
                <ScanLine className="mb-1 size-4 text-[#9a7a35]" />Scan to check this invoice is genuine and see what is still owed.
              </span>
            </div>
          )}
        </footer>
      </div>
    </article>
  );
}

function PayRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex justify-between gap-3"><dt className="text-[#8a8177]">{k}</dt><dd className={cn("text-right font-medium", mono && "font-mono")}>{v}</dd></div>;
}
