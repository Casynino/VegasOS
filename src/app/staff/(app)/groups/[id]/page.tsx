import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CheckCircle2, Download, Eye, FileClock, FileText, History, LogOut, Mail, Phone, Printer, Receipt, Users, Wallet } from "lucide-react";
import { GROUP_STATUS, GROUP_TYPE } from "@/lib/group-types";
import { invoiceMessage, payToLine } from "@/lib/invoice-message";
import { siteOrigin } from "@/server/site-origin";
import { SendDocument } from "@/components/staff/invoices/send-document";
import { groupTimeline } from "@/server/services/finance-history";
import { db } from "@/server/db";
import { groupMembers } from "@/lib/group-members";
import { can, requirePagePermission } from "@/server/auth";
import { getGroup } from "@/server/services/groups";
import { accountOptions } from "@/server/services/payment-accounts";
import { businessToday, getSettings } from "@/server/settings";
import { formatBusinessDate, formatDateTime, formatTZS } from "@/lib/format";
import { termsLabel } from "@/lib/billing";
import { addDays } from "@/lib/time/business-date";
import { INVOICE_STATUS_META } from "@/lib/invoice-status";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { getT, getTFor } from "@/i18n/server";
import { DEFAULT_LOCALE, LOCALE_META } from "@/i18n/config";
import { langLink } from "@/lib/wa-messages";
import { AddGroupRoom, CancelGroup, EditGroup, FinalizeGroup, GroupPayment, GroupRooms, PrintButton } from "./group-panels";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Group booking") };
}

const BOX = "rounded-3xl border border-border/70 bg-card p-4 sm:p-5";

/**
 * A group booking: who they are and who pays, every room (own guest, stay and
 * bill) with the group actions, the group folio (where every shilling came
 * from, room by room) and the group's invoices & payments.
 */
export default async function GroupPage({ params, searchParams }: PageProps<"/staff/groups/[id]">) {
  const user = await requirePagePermission("reservations.view");
  const { id } = await params;
  const [g, today, accounts, settings, companies, history] = await Promise.all([
    getGroup(id), businessToday(), accountOptions("payments"), getSettings(),
    db.corporateCustomer.findMany({ where: { status: "ACTIVE" }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } }),
    can(user, "staff.activity.view") ? groupTimeline(id) : Promise.resolve(null),
  ]);
  if (!g) notFound();
  const perms = {
    checkIn: can(user, "reservations.check_in"), checkOut: can(user, "reservations.check_out"), override: can(user, "reservations.checkout_override"),
    invoice: can(user, "invoices.manage"), pay: can(user, "payments.record"), edit: can(user, "reservations.edit"), book: can(user, "reservations.create"),
    cancel: can(user, "reservations.cancel"),
  };
  const I = GROUP_TYPE[g.type].icon;
  const chip = GROUP_STATUS[g.billingStatus];
  // Just checked out the last guest: the final-invoice confirmation opens by itself.
  const askFinal = (await searchParams).final === "1";
  const canFinalize = perms.invoice || perms.checkOut;
  // The final review: what the group pays for (rooms paying their own bill are not on it).
  const groupLive = g.rooms.filter((r) => r.billTo === "GROUP" && !["CANCELLED", "NO_SHOW", "INQUIRY"].includes(r.status));
  const review = {
    rooms: groupLive.map((r) => ({ id: r.id, room: r.room?.number ?? "—", guest: r.guest.fullName, total: r.total })),
    guests: groupLive.reduce((n, r) => n + r.adults + r.children, 0),
    gross: groupLive.reduce((n, r) => n + r.roomGross + r.extras, 0),
    discount: groupLive.reduce((n, r) => n + r.discountAmount, 0),
    net: groupLive.reduce((n, r) => n + r.total, 0),
    earlier: g.invoices.filter((i) => !["CANCELLED", "VOID", "DRAFT"].includes(i.status)).reduce((n, i) => n + i.net, 0),
  };
  const finalInvoice = g.invoices.find((i) => i.id === g.finalInvoiceId) ?? null;
  // The final invoice's message in the group contact's language (staff read the page in their own).
  const [t, rt] = await Promise.all([
    getT(),
    finalInvoice ? db.guest.findUnique({ where: { id: g.contact.id }, select: { preferredLanguage: true } }).then((x) => getTFor(x?.preferredLanguage)) : null,
  ]);
  const cp = g.companyProfile;
  const billing = g.company ? {
    name: g.company.name, address: cp?.billingAddress || cp?.address, tax: [cp?.taxId && t("TIN {tin}", { tin: cp.taxId }), cp?.vrn && t("VRN {vrn}", { vrn: cp.vrn }), cp?.registrationNo && t("Reg. No. {number}", { number: cp.registrationNo })].filter(Boolean).join(" · "),
    email: cp?.email, notes: g.profile.billingNotes,
  } : {
    name: g.name, address: g.profile.billingAddress || g.profile.address, tax: [g.profile.taxId && t("TIN {tin}", { tin: g.profile.taxId }), g.profile.vrn && t("VRN {vrn}", { vrn: g.profile.vrn }), g.profile.registrationNo && t("Reg. No. {number}", { number: g.profile.registrationNo })].filter(Boolean).join(" · "),
    email: g.profile.billingEmail, notes: g.profile.billingNotes,
  };
  const members = groupMembers(g);
  const tot = g.totals;
  // Dates the reader's way (English exactly as before).
  const en = t.locale === DEFAULT_LOCALE;
  const day = (d: string) => (en ? formatBusinessDate(d) : t.date(d));
  const when = (d: Date | string) => (en ? formatDateTime(d) : t.dateTime(d));
  const live = g.invoices.filter((i) => i.status !== "CANCELLED" && i.status !== "VOID");
  const drafts = live.filter((i) => i.status === "DRAFT");
  const upcoming = g.rooms.filter((r) => ["INQUIRY", "RESERVED", "CONFIRMED"].includes(r.status)).length;
  // A room added later joins from today at the earliest, until the group leaves.
  const addStart = g.arrival < today ? today : g.arrival;
  const addEnd = g.departure > addStart ? g.departure : addDays(addStart, 1);
  const categories = [
    ["Rooms", tot.roomCharges], ["Restaurant", tot.restaurant], ["Bar", tot.bar], ["Room service", tot.roomService], ["Transport", tot.transport], ["Other", tot.other],
  ] as const;

  return (
    <div className="w-full space-y-5">
      <Link href="/staff/groups" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "print:hidden")}><ArrowLeft /> {t("Groups")}</Link>

      <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div className="flex flex-wrap items-start gap-4 px-4 py-5 sm:px-6">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-violet-500/12 text-violet-700 dark:text-violet-300"><I className="size-6" /></span>
          <div className="min-w-0 flex-1 basis-[22rem]">
            <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("{type} group", { type: t(GROUP_TYPE[g.type].label) })} · <span className="font-mono">{g.reference}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] tracking-wider", chip.cls)}>{t(chip.label)}</span>
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{g.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{t.rich("Contact <b>{name}</b>", { b: (x) => <strong className="text-foreground">{x}</strong> }, { name: g.contact.fullName })}</span>
              {g.contact.phone && <a href={`tel:${g.contact.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="size-3.5" />{g.contact.phone}</a>}
              {g.contact.email && <span>{g.contact.email}</span>}
              <span>· {t(g.source)} · {g.createdBy ? t("booked {date} by {name}", { date: when(g.createdAt), name: g.createdBy }) : t("booked {date}", { date: when(g.createdAt) })}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            {perms.book && g.status !== "CANCELLED" && <AddGroupRoom groupId={g.id} arrival={addStart} departure={addEnd} source="PHONE" />}
            {perms.edit && <EditGroup g={g} companies={companies} canApproveCredit={can(user, "corporate.manage")} />}
            <Link href={`/staff/groups/${g.id}/statement`} className={buttonVariants({ variant: "outline", size: "sm" })}><FileClock />{t("Statement")}</Link>
            <PrintButton />
            {perms.cancel && upcoming > 0 && <CancelGroup groupId={g.id} rooms={upcoming} />}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-border/70 bg-border/70 sm:grid-cols-4 xl:grid-cols-7">
          {([
            ["Rooms", `${tot.rooms}`, `${day(g.arrival)} → ${day(g.departure)}`],
            ["Guests", `${tot.guests}`, t("{n} people on file", { n: members.length })],
            ["Checked out", `${tot.checkedOut}`, tot.checkedOut ? t("bills kept on the group") : t("nobody has left yet")],
            ["Still staying", `${tot.staying}`, tot.checkedIn
              ? (tot.staying - tot.checkedIn ? t("{n} in the hotel · {m} to come", { n: tot.checkedIn, m: tot.staying - tot.checkedIn }) : t("{n} in the hotel", { n: tot.checkedIn }))
              : tot.staying ? t("still to arrive") : t("everyone has left")],
            ["Total charges", formatTZS(tot.total), tot.discount ? t("after {amount} discount", { amount: formatTZS(tot.discount) }) : t("rooms, food, drinks & extras")],
            ["Paid", formatTZS(tot.paid), `${g.billing === "COMBINED" ? t("one invoice") : t("invoice per room")} · ${termsLabel(g.paymentTermDays ?? g.company?.terms ?? settings.invoiceDefaultDueDays, t)}`],
            ["Balance", formatTZS(tot.outstanding), tot.outstanding > 0 ? t("to {payer}", { payer: g.payer }) : t("nothing owed")],
          ] as const).map(([k, v, sub]) => (
            <div key={k} className="bg-card px-4 py-3 sm:px-6">
              <dt className="text-xs text-muted-foreground">{t(k)}</dt>
              <dd className={cn("truncate text-lg font-semibold tabular-nums", k === "Balance" && (tot.outstanding > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"))}>{v}</dd>
              <dd className="truncate text-[11px] text-muted-foreground">{sub}</dd>
            </div>
          ))}
        </dl>
        {g.notes && <p className="border-t border-border/70 bg-amber-500/[0.06] px-4 py-3 text-sm sm:px-6">{t("Note: {note}", { note: g.notes })}</p>}
      </section>

      {/* The group's bill: finalize once everyone has left; the final invoice after that */}
      {g.readyToFinalize && (
        <section className="flex flex-wrap items-center gap-4 rounded-3xl border border-violet-500/30 bg-violet-500/[0.07] p-4 sm:p-5 print:hidden">
          <span className="grid size-11 place-items-center rounded-2xl bg-violet-500/15 text-violet-700 dark:text-violet-300"><CheckCircle2 className="size-5" /></span>
          <div className="min-w-0 flex-1 basis-[18rem]">
            <p className="font-semibold">{t.plural(review.rooms.length, "Group stay completed — all {n} room checked out", "Group stay completed — all {n} rooms checked out")}</p>
            <p className="text-sm text-muted-foreground">{t.rich("Finalize the group bill: every room's charges go on one final invoice to <b>{payer}</b>.", { b: (x) => <strong className="text-foreground">{x}</strong> }, { payer: g.payer })}</p>
          </div>
          {canFinalize && <FinalizeGroup groupId={g.id} payer={g.payer} review={review} autoOpen={askFinal} />}
        </section>
      )}
      {g.finalizedAt && (
        <section className="space-y-4 rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid size-11 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"><FileText className="size-5" /></span>
            <div className="min-w-0 flex-1 basis-[18rem]">
              <p className="font-semibold">{finalInvoice ? t.rich("Final invoice <n>#{number}</n> generated", { n: (x) => <span className="font-mono">{x}</span> }, { number: finalInvoice.number }) : t("Group bill finalized")}</p>
              <p className="text-sm text-muted-foreground">
                {g.finalizedBy ? t("Finalized {date} by {name}", { date: when(g.finalizedAt), name: g.finalizedBy }) : t("Finalized {date}", { date: when(g.finalizedAt) })}
                {finalInvoice?.dueDate && finalInvoice.balance > 0 ? ` · ${t("due {date}", { date: day(finalInvoice.dueDate) })}` : ""}
              </p>
            </div>
          </div>
          {finalInvoice && (
            <>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {([["Total", finalInvoice.net, ""], ["Paid", finalInvoice.paid, "text-emerald-700 dark:text-emerald-400"], ["Balance", finalInvoice.balance, finalInvoice.balance > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"]] as const).map(([k, v, cls]) => (
                  <div key={k} className="rounded-2xl bg-card px-3 py-2.5"><dt className="text-[11px] text-muted-foreground">{t(k)}</dt><dd className={cn("text-lg font-semibold tabular-nums", cls)}>{formatTZS(v)}</dd></div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-2 print:hidden">
                <Link href={`/staff/invoices/${finalInvoice.id}`} className={buttonVariants({ size: "sm" })}><Eye />{t("View invoice")}</Link>
                <Link href={`/staff/invoices/${finalInvoice.id}?print=1`} className={buttonVariants({ size: "sm", variant: "outline" })}><Printer />{t("Print invoice")}</Link>
                <Link href={`/staff/invoices/${finalInvoice.id}?print=1`} className={buttonVariants({ size: "sm", variant: "outline" })} title={t("Opens the print window — choose “Save as PDF”")}><Download />{t("Download PDF")}</Link>
                {perms.pay && finalInvoice.balance > 0 && <a href="#pay" className={buttonVariants({ size: "sm", variant: "outline" })}><Wallet />{t("Record payment")}</a>}
                <SendDocument
                  entity={{ type: "Invoice", id: finalInvoice.id }} what={`invoice ${finalInvoice.number}`}
                  to={{ name: g.payer, phone: g.contact.phone ?? g.companyProfile?.phone, email: g.profile.billingEmail ?? g.companyProfile?.email ?? g.contact.email }}
                  subject={rt!("{hotel} — invoice {number}", { hotel: settings.hotelName, number: finalInvoice.number })}
                  text={invoiceMessage({
                    hotelName: settings.hotelName, hotelPhone: settings.phone, greet: g.contact.fullName, number: finalInvoice.number, final: true,
                    group: { name: g.name, rooms: review.rooms.length }, net: finalInvoice.net, paid: finalInvoice.paid, balance: finalInvoice.balance,
                    due: finalInvoice.dueDate ? (rt!.locale === DEFAULT_LOCALE ? formatBusinessDate(finalInvoice.dueDate) : rt!.date(finalInvoice.dueDate)) : null, payTo: payToLine(settings, rt!),
                    verifyUrl: langLink(finalInvoice.verifyToken ? `${await siteOrigin()}/verify/${finalInvoice.verifyToken}` : null, rt!),
                  }, rt!)}
                  label={rt!.locale === DEFAULT_LOCALE ? undefined : t("Send ({language})", { language: LOCALE_META[rt!.locale].short })}
                />
              </div>
            </>
          )}
          {g.changedSinceFinal !== 0 && (
            <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              {t.rich(g.changedSinceFinal < 0
                ? "Since the final invoice, the rooms' bills changed by <b>{amount}</b>. The final invoice is never edited: tick the changed rooms below and invoice them — that makes an adjustment invoice (a credit), recorded in the history."
                : "Since the final invoice, the rooms' bills changed by <b>{amount}</b>. The final invoice is never edited: tick the changed rooms below and invoice them — that makes an adjustment invoice, recorded in the history.",
              { b: (x) => <strong>{x}</strong> }, { amount: `${g.changedSinceFinal > 0 ? "+" : "−"}${formatTZS(Math.abs(g.changedSinceFinal))}` })}
            </p>
          )}
        </section>
      )}
      {!g.readyToFinalize && !g.finalizedAt && tot.checkedOut > 0 && tot.staying > 0 && (
        <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-amber-500/30 bg-amber-500/[0.07] p-4 sm:p-5 print:hidden">
          <span className="grid size-11 place-items-center rounded-2xl bg-amber-500/15 text-amber-700 dark:text-amber-300"><LogOut className="size-5" /></span>
          <div className="min-w-0 flex-1 basis-[18rem]">
            <p className="font-semibold">{t.plural(tot.staying, "Group check-out in progress — {n} room / guest remaining", "Group check-out in progress — {n} rooms / guests remaining")}</p>
            <p className="text-sm text-muted-foreground">{t("{n} checked out; their bills stay on the group. The final invoice is made when the last room leaves.", { n: tot.checkedOut })}</p>
          </div>
        </section>
      )}
      {!g.readyToFinalize && !g.finalizedAt && g.stay !== "CANCELLED" && !(tot.checkedOut > 0 && tot.staying > 0) && (
        <p className="flex flex-wrap items-center gap-x-2 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground print:hidden">
          <FileClock className="size-4" />{t("The final group invoice is made when every room has checked out — charges keep adding up on each room until then.")}
          <Link href={`/staff/groups/${g.id}/statement`} className="font-medium text-foreground underline-offset-2 hover:underline">{t("Need the bill now? Print or send a statement.")}</Link>
        </p>
      )}

      {/* Members: who is in the group, which room, and the leader */}
      <section className={BOX}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Users className="size-4 text-muted-foreground" />{t("Members")} <span className="text-sm font-normal text-muted-foreground">{members.length}</span></h2>
          <p className="text-xs text-muted-foreground">{t.rich("The people staying · invoice to <b>{payer}</b>, every room's bill room by room", { b: (x) => <strong className="text-foreground">{x}</strong> }, { payer: g.payer })}</p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {members.map((m) => {
            const status = m.status === "CHECKED_IN" ? t("In house") : m.status === "CHECKED_OUT" ? t("Checked out") : m.status ? t("Booked") : null;
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold">
                  {m.fullName.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-medium">{m.fullName}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {m.room ? (m.sharing ? t("Room {room} (sharing)", { room: m.room }) : t("Room {room}", { room: m.room })) : m.reservationId ? t("Room not given yet") : t("Not staying")}{status && ` · ${status}`}{m.phone && ` · ${m.phone}`}
                  </span>
                </span>
                {m.reservationId && <span className="inline-flex items-center gap-2 print:hidden"><Link href={`/staff/stay-bill?reservation=${m.reservationId}`} className="text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.8_0.11_82)]">{t("Bill")}</Link><Link href={`/staff/reservations/${m.reservationId}`} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">{t("Open")}</Link></span>}
              </li>
            );
          })}
        </ul>
      </section>

      <GroupRooms g={g} perms={perms} today={today} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        {/* Group folio — everything, room by room, and where it came from */}
        <section className={BOX}>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Receipt className="size-4 text-muted-foreground" />{t("Group bill — room by room")}</h2>
          <div className="overflow-x-auto">
            <table data-stack className="w-full min-w-[40rem] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="py-2 text-left font-medium">{t("Room · guest")}</th>
                  <th className="py-2 text-right font-medium">{t("Room")}</th><th className="py-2 text-right font-medium">{t("Food")}</th><th className="py-2 text-right font-medium">{t("Drinks")}</th>
                  <th className="py-2 text-right font-medium">{t("Room svc")}</th><th className="py-2 text-right font-medium">{t("Transport")}</th><th className="py-2 text-right font-medium">{t("Other")}</th>
                  <th className="py-2 text-right font-medium">{t("Total")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 tabular-nums">
                {g.rooms.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2"><Link href={`/staff/reservations/${r.id}#extras`} className="hover:underline">{r.room?.number ?? "—"} · {r.guest.fullName}</Link>{r.billTo !== "GROUP" && <span className="ml-1 text-[11px] text-amber-700 dark:text-amber-400">{t("own bill")}</span>}</td>
                    {[r.roomCharge, r.byKind.restaurant, r.byKind.bar, r.byKind.roomService, r.byKind.transport, r.byKind.other].map((v, i) => <td key={i} className="py-2 text-right">{v ? v.toLocaleString("en-US") : "—"}</td>)}
                    <td className="py-2 text-right font-semibold">{r.total.toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold tabular-nums">
                <tr>
                  <td className="py-2">{t("Group total")}</td>
                  {categories.map(([k, v]) => <td key={k} className="py-2 text-right">{v ? v.toLocaleString("en-US") : "—"}</td>)}
                  <td className="py-2 text-right">{tot.total.toLocaleString("en-US")}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between rounded-xl bg-muted/50 px-3 py-2"><dt className="text-muted-foreground">{t("Group total")}</dt><dd className="font-semibold tabular-nums">{formatTZS(tot.total)}</dd></div>
            <div className="flex justify-between rounded-xl bg-emerald-500/10 px-3 py-2"><dt className="text-muted-foreground">{t("Paid")}</dt><dd className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatTZS(tot.paid)}</dd></div>
            <div className="flex justify-between rounded-xl bg-muted/50 px-3 py-2"><dt className="text-muted-foreground">{t("Not invoiced yet (group rooms)")}</dt><dd className="tabular-nums">{formatTZS(tot.toInvoice)}</dd></div>
            <div className="flex justify-between rounded-xl bg-muted/50 px-3 py-2"><dt className="text-muted-foreground">{t("On invoices, unpaid")}</dt><dd className="tabular-nums">{formatTZS(tot.invoicedUnpaid)}</dd></div>
            {tot.ownRoomsOwe > 0 && <div className="flex justify-between rounded-xl bg-amber-500/10 px-3 py-2 sm:col-span-2"><dt className="text-muted-foreground">{t("Rooms paying their own bill still owe")}</dt><dd className="tabular-nums">{formatTZS(tot.ownRoomsOwe)}</dd></div>}
            <div className="flex justify-between rounded-xl border border-border px-3 py-2 sm:col-span-2"><dt className="font-medium">{t("Outstanding")}</dt><dd className={cn("font-semibold tabular-nums", tot.outstanding > 0 && "text-rose-600 dark:text-rose-400")}>{formatTZS(tot.outstanding)}</dd></div>
          </dl>
          <p className="mt-3 text-[11px] text-muted-foreground">{t("Income is counted once, from each room's nights and extras. An invoice only moves what is owed from the rooms to {payer}; a payment settles the invoice.", { payer: g.payer })}</p>
        </section>

        <aside className="space-y-5">
          {/* Billing party: who the invoice is addressed to */}
          <section className={BOX}>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Building2 className="size-4 text-muted-foreground" />{t("Billing party")}</h2>
            <p className="text-lg font-semibold leading-tight">{billing.name}</p>
            {g.company && <Link href={`/staff/corporate/${g.company.id}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">{t("Company account · details, credit & statement")}</Link>}
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("Contact")}</dt><dd>{g.contact.fullName}{g.contact.phone && <a href={`tel:${g.contact.phone}`} className="block text-xs text-muted-foreground hover:underline">{g.contact.phone}</a>}</dd></div>
              {billing.email && <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("Invoices to")}</dt><dd className="inline-flex items-center gap-1 break-all"><Mail className="size-3.5 shrink-0" />{billing.email}</dd></div>}
              {billing.address && <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("Address")}</dt><dd className="whitespace-pre-line">{billing.address}</dd></div>}
              {billing.tax && <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("Tax")}</dt><dd>{billing.tax}</dd></div>}
              {billing.notes && <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">{t("Notes")}</dt><dd>{billing.notes}</dd></div>}
            </dl>
            {!g.company && !billing.address && !billing.tax && !billing.email && perms.edit && <p className="mt-2 text-xs text-muted-foreground">{t("No address or tax details yet — add them with Edit so they print on the invoice.")}</p>}
          </section>
          <section className={BOX}>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><FileText className="size-4 text-muted-foreground" />{t("Invoices")}</h2>
            {live.length === 0 ? <p className="text-sm text-muted-foreground">{g.billing === "COMBINED" ? t("Each room's bill joins the group's running bill when it checks out; the final invoice is made when everyone has left.") : t("Each room is invoiced when it checks out — or tick rooms above and invoice them now.")}</p> : (
              <ul className="space-y-1.5">
                {g.invoices.map((i) => (
                  <li key={i.id}>
                    <Link href={`/staff/invoices/${i.id}`} className={cn("flex items-center justify-between gap-2 rounded-xl border border-border/70 px-3 py-2 text-sm hover:bg-muted/50", (i.status === "CANCELLED" || i.status === "VOID") && "opacity-50")}>
                      <span className="font-mono font-medium">{i.number}</span>
                      <span className="flex items-center gap-2">
                        {i.id === g.finalInvoiceId && <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">{t("Final")}</span>}
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", INVOICE_STATUS_META[i.status].className)}>{i.status === "DRAFT" ? t("Running bill") : t(INVOICE_STATUS_META[i.status].label)}</span>
                        <span className="tabular-nums">{formatTZS(i.net)}</span>
                      </span>
                    </Link>
                    {i.balance > 0 && i.status !== "DRAFT" && i.status !== "CANCELLED" && i.status !== "VOID" && <p className="px-3 pt-0.5 text-[11px] text-rose-600 dark:text-rose-400">{t("owes {amount}", { amount: formatTZS(i.balance) })}{i.dueDate ? ` · ${t("due {date}", { date: day(i.dueDate) })}` : ""}</p>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">{t("To split a combined invoice: void it (with a reason) — its rooms owe again — then invoice the rooms as needed. History is kept.")}</p>
          </section>
          {perms.pay && (
            <section id="pay" className={cn(BOX, "scroll-mt-24 print:hidden")}>
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Wallet className="size-4 text-muted-foreground" />{t("Payment from {payer}", { payer: g.payer })}</h2>
              <GroupPayment groupId={g.id} owed={tot.invoicedUnpaid} accounts={accounts} drafts={drafts.map((d) => ({ id: d.id, number: d.number, net: d.net }))} />
            </section>
          )}
          <section className={BOX}>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Receipt className="size-4 text-muted-foreground" />{t("Payments received")}</h2>
            {g.payments.length === 0 ? <p className="text-sm text-muted-foreground">{t("No payments yet.")}</p> : (
              <ul className="space-y-2 text-sm">
                {g.payments.map((p) => (
                  <li key={p.id} className={cn("rounded-xl border border-border/70 px-3 py-2", p.reversed && "opacity-50")}>
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{t(p.account)}</span>
                      <span className={cn("font-semibold tabular-nums", p.refund ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400")}>{p.refund ? "−" : ""}{formatTZS(p.amount)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {when(p.at)} · {t("by {name}", { name: p.by })}
                      {p.invoice && <> · <Link href={`/staff/invoices/${p.invoice.id}`} className="font-mono hover:underline">{p.invoice.number}</Link></>}
                      {p.deposit && p.room && <> · {t("deposit on room {room}", { room: p.room })}</>}
                      {p.reference && <> · {t("ref {reference}", { reference: p.reference })}</>}
                      {p.reversed && ` · ${t("reversed")}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* History: who did what, when and why (managers & the boss) */}
      {history && (
        <section className={cn(BOX, "print:hidden")}>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><History className="size-4 text-muted-foreground" />{t("History")} <span className="text-sm font-normal text-muted-foreground">{t("group, rooms, invoices & payments")}</span></h2>
          {history.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nothing recorded yet.")}</p> : (
            <ol className="relative max-h-[28rem] space-y-3 overflow-y-auto border-l border-border pl-5 text-sm">
              {history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[1.62rem] top-1.5 size-2.5 rounded-full border-2 border-card bg-foreground/60" />
                  <p><span className="text-xs text-muted-foreground">{when(h.at)}</span> · <span className="font-medium">{h.who}</span> {t(h.label)}{h.record && <span className="text-muted-foreground"> · {h.record}</span>}</p>
                  {h.changes.length > 0 && (
                    <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {h.changes.map((c) => (
                        <span key={c.field}><span className="text-muted-foreground">{t(c.field)}:</span> {c.from && <span className="text-rose-600 line-through decoration-rose-400/60 dark:text-rose-400">{c.from}</span>}{c.from && c.to && " → "}{c.to && <span className="font-medium text-emerald-700 dark:text-emerald-400">{c.to}</span>}</span>
                      ))}
                    </p>
                  )}
                  {h.reason && <p className="text-xs text-muted-foreground">{t("Reason: {reason}", { reason: h.reason })}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
