import type { Metadata } from "next";
import { discountLimit } from "@/lib/discounts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BedDouble, BadgeCheck, Building2, Car, ClipboardList, Clock3, FileText, History, Loader2, MessageCircle, QrCode, Receipt, UserRound, Users, UtensilsCrossed, Wallet } from "lucide-react";
import { Occupants } from "@/components/staff/reception/occupants";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { maskPhone } from "@/server/services/mobile-payments";
import { isPayLater } from "@/server/services/booking-holds";
import { accountOptions } from "@/server/services/payment-accounts";
import { businessToday, getSettings } from "@/server/settings";
import { formatBusinessDate, formatDateTime, formatTZS } from "@/lib/format";
import { addDays, fromDbDate } from "@/lib/time/business-date";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { PAYMENT_STATUS_META, paymentStatus } from "@/lib/payment-status";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TRIP_STATUS_META, TRIP_TYPE_LABEL } from "@/lib/transport-meta";
import { NewRequestDialog } from "../../requests/request-forms";
import { requestHandlers } from "@/server/services/requests";
import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";
import { ReservationActions, RoomRowActions, PaymentPanel, ReversePaymentButton, NoShowPanel, CorrectPaymentButton, EditMeetingButton } from "./panels";
import { MEETING_STATUS_LABEL, hoursBetween, timeRange } from "@/lib/meeting";
import { formatTime } from "@/lib/format";
import { ChargeComposer, GuestTab } from "@/components/staff/reception/room-charges";
import { recentChargeItems } from "@/server/services/payments";
import { billMenu, inHouseGuests, reservationOrders, STATUS_LABEL, TYPE_LABEL } from "@/server/services/restaurant";
import { OrderComposer } from "../../restaurant/order-composer";
import { Initials } from "@/components/dashboard/kit";
import { DiscountEditor } from "@/components/staff/reception/discount-editor";
import { StayDates } from "@/components/staff/reception/arrival-card";
import { ExtendStay, PutOnRoomButton } from "@/components/staff/reception/stay-workspace";
import { CHARGE_ORDER, folioLines, tabLines } from "@/server/services/stays";
import { sessionMoney } from "@/server/services/dining-core";
import { StayDecisions } from "@/components/staff/manager-decisions";
import { GuestEditForm } from "../../guests/[id]/guest-edit-form";
import { BillingPanel } from "./billing-panel";
import { GuestMessenger, type GuestMessageOption } from "@/components/staff/reception/guest-messenger";
import { ensureGuestToken, guestMessage } from "@/server/services/guest-comms";
import { siteOrigin } from "@/server/site-origin";
import { guestEventOn } from "@/lib/guest-messages";
import { reservationMessage } from "@/server/services/guest-message-data";
import { bookingTimeline } from "@/server/services/finance-history";
import { unbilledCompanyAmount } from "@/server/services/company-billing";
import type { BillTo } from "@/lib/billing";
import type { InvoiceStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Reservation" };

export default async function ReservationPage({ params, searchParams }: PageProps<"/staff/reservations/[id]">) {
  const user = await requirePagePermission("reservations.view");
  const { id } = await params;
  const sp = await searchParams;
  const sentParam = sp.sent;
  // Just booked with "Send to phone": that prompt, still waiting — the payment panel follows it.
  const payingId = typeof sp.paying === "string" ? sp.paying.slice(0, 40) : null;
  const paying = payingId ? await db.mobilePayment.findFirst({ where: { id: payingId, reservationId: id, status: "PENDING" }, select: { id: true, amount: true, phone: true } }) : null;
  const [r, methods, today, history, recent] = await Promise.all([
    db.reservation.findUnique({
      where: { id },
      include: {
        guest: true, source: true, corporateCustomer: true, createdBy: { select: { fullName: true } }, bookingQr: { select: { label: true } },
        // The guest paying online right now (a payment request on their phone) — reception does not ask again.
        mobilePayments: { where: { initiator: "CUSTOMER", status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1, select: { amount: true, expiresAt: true } },
        group: { include: { corporateCustomer: { select: { companyName: true } }, contactGuest: { select: { fullName: true } }, _count: { select: { reservations: true } } } },
        guests: { where: { isPrimary: false }, include: { guest: { select: { id: true, fullName: true, phone: true, idNumber: true, nationality: true } } } },
        rooms: {
          include: {
            room: true, roomType: true, checkedInBy: { select: { fullName: true } }, checkedOutBy: { select: { fullName: true } },
            nightsLedger: { orderBy: { businessDate: "asc" } },
            assignments: { include: { fromRoom: { select: { number: true } }, toRoom: { select: { number: true } }, changedBy: { select: { fullName: true } } }, orderBy: { changedAt: "asc" } },
          },
          orderBy: { createdAt: "asc" },
        },
        trips: { orderBy: { pickupAt: "asc" }, include: { driver: { select: { fullName: true } } } },
        requests: { orderBy: { createdAt: "desc" }, include: { assignedTo: { select: { fullName: true } } } },
        payments: { include: { method: true, account: true, recordedBy: { select: { fullName: true } }, reversedBy: { select: { fullName: true } }, corrections: { orderBy: { changedAt: "asc" } } }, orderBy: { receivedAt: "asc" } },
        charges: { orderBy: { createdAt: "asc" }, include: { menuItem: { select: { image: { select: { id: true, url: true, isActive: true } } } }, restaurantOrder: CHARGE_ORDER } },
        invoices: { select: { id: true, status: true } },
        invoiceItems: { where: { invoice: { reservationId: null } }, select: { netAmount: true, invoice: { select: { id: true, number: true, status: true } } } },
      },
    }),
    accountOptions("payments"),
    businessToday(),
    bookingTimeline(id),
    recentChargeItems(),
  ]);
  if (!r) notFound();
  const accountNames = new Map((await db.moneyAccount.findMany({ select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  // Managers, the MD and the owner step in (dates, rooms, cancel, discounts, free nights) — reception
  // does the routine: check-in, check-out and taking payments.
  const watching = can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin");
  // Restaurant & bar: this guest's orders, and a quick order for a guest staying now.
  const canOrder = can(user, "restaurant.orders");
  // The same customer in the restaurant: the booker and everyone sharing the room — their own
  // orders since they arrived (on this room or not), and a table they are at right now.
  const people = [r.guestId, ...r.guests.map((g) => g.guest.id)];
  const arrived = ["CHECKED_IN", "CHECKED_OUT"].includes(r.status);
  const leftAt = r.status === "CHECKED_OUT" ? r.rooms.reduce<Date | null>((m, x) => (x.checkedOutAt && (!m || x.checkedOutAt > m) ? x.checkedOutAt : m), null) : null;
  const [roomOrders, ownOrders, tables, bill, orderGuests, roomServiceFee] = await Promise.all([
    reservationOrders(r.id),
    arrived ? db.restaurantOrder.findMany({
      where: { createdAt: { gte: r.arrivalDate, ...(leftAt && { lte: leftAt }) }, OR: [{ guestId: { in: people } }, { guestId: null, session: { guestId: { in: people } } }] },
      include: { items: { orderBy: { id: "asc" }, select: { quantity: true, name: true } }, createdBy: { select: { fullName: true } }, account: { select: { name: true } }, location: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }) : Promise.resolve([]),
    // Their table right now — only while they are staying (a past or coming stay has no "now").
    r.status === "CHECKED_IN" ? db.diningSession.findMany({
      where: { openAtId: { not: null }, OR: [{ guestId: { in: people } }, { members: { some: { guestId: { in: people } } } }] },
      select: { id: true, location: { select: { name: true } }, orders: { select: { status: true, settlement: true, total: true, paidAmount: true, reservationId: true } } },
    }) : Promise.resolve([]),
    canOrder && !watching && r.status === "CHECKED_IN" ? billMenu() : Promise.resolve(null),
    canOrder && !watching && r.status === "CHECKED_IN" ? inHouseGuests() : Promise.resolve([]),
    getSettings().then((x) => x.roomServiceFee),
  ]);
  const seen = new Set(roomOrders.map((o) => o.id));
  const orders = [...roomOrders, ...ownOrders.filter((o) => !seen.has(o.id) && o.status !== "CANCELLED")].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const orderMenu = bill?.categories ?? [];
  const staffList = can(user, "requests.manage") ? await requestHandlers() : [];

  const roomNumbers = new Map((await db.room.findMany({ where: { id: { in: [...new Set(r.rooms.flatMap((x) => x.nightsLedger.map((n) => n.roomId)))] } }, select: { id: true, number: true } })).map((x) => [x.id, x.number]));
  const meta = RESERVATION_STATUS_META[r.status];
  // Company billing: the invoices this stay was billed on, and what the company still has to be billed for.
  const companyInvoices = [...r.invoiceItems.reduce((m, it) => {
    const e = m.get(it.invoice.id) ?? { ...it.invoice, amount: 0 };
    e.amount += it.netAmount;
    return m.set(it.invoice.id, e);
  }, new Map<string, { id: string; number: string; status: InvoiceStatus; amount: number }>()).values()];
  const [unbilled, companies] = r.billTo === "GROUP" || (r.billTo !== "GUEST" && r.corporateCustomerId)
    ? await Promise.all([
        unbilledCompanyAmount(db, r.id, true),
        db.corporateCustomer.findMany({ where: { status: "ACTIVE" }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true, paymentTermDays: true, defaultBillTo: true, defaultCovers: true } }),
      ])
    : [0, await db.corporateCustomer.findMany({ where: { status: "ACTIVE" }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true, paymentTermDays: true, defaultBillTo: true, defaultCovers: true } })];
  const perms = {
    edit: can(user, "reservations.edit"),
    checkIn: !watching && can(user, "reservations.check_in"),
    checkOut: !watching && can(user, "reservations.check_out"),
    cancel: can(user, "reservations.cancel"),
    discount: discountLimit(user.permissions, await getSettings()) > 0,
    discountMax: discountLimit(user.permissions, await getSettings()),
    pay: !watching && can(user, "payments.record"),
    reverse: can(user, "payments.reverse"),
  };
  const chargeStaff = await db.user.findMany({ where: { id: { in: r.charges.map((c) => c.createdById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const tab = tabLines(r.charges.filter((c) => !c.isVoided), new Map(chargeStaff.map((u) => [u.id, u.fullName])));
  // What the extras are (restaurant, room service, transport…) — adds up to the booking's own charges.
  const extras = folioLines(r.charges.filter((c) => !c.isVoided));
  const waiting = r.rooms.filter((x) => x.status === "RESERVED" || x.status === "CONFIRMED");
  // Not paid, no room held (booked to pay later, or an enquiry): checked in or cancelled like the others — never a no-show.
  const notHeld = r.rooms.filter((x) => x.status === "INQUIRY");
  const payLater = isPayLater(r.externalData);
  const inHouse = r.rooms.filter((x) => x.status === "CHECKED_IN");
  const now = new Date();
  const live = r.rooms.filter((x) => !["CANCELLED", "NO_SHOW"].includes(x.status));
  const overdue = inHouse.some((x) => x.endAt <= now);
  const firstIn = live.reduce<Date | null>((m, x) => { const t = x.checkedInAt ?? x.startAt; return !m || t < m ? t : m; }, null);
  const lastOut = live.reduce<Date | null>((m, x) => { const t = x.checkedOutAt ?? x.endAt; return !m || t > m ? t : m; }, null);
  const nights = live.reduce((m, x) => Math.max(m, x.nights), 0);
  const open = !["CANCELLED", "NO_SHOW", "CHECKED_OUT"].includes(r.status);
  // Restaurant orders: where each one is paid — this room's bill, the restaurant, or still open at its table.
  const roomLabel = (inHouse.length ? inHouse : live).map((x) => x.room.number).join(", ");
  const canPutOnRoom = canOrder && !watching && r.status === "CHECKED_IN";
  const orderRows = orders.map((o) => {
    const place = o.type === "ROOM_SERVICE" ? null : o.location?.name ?? o.tableLabel ?? null;
    const at = place ? `at ${place}` : o.type === "ROOM_SERVICE" ? "for room service" : o.type === "TAKEAWAY" ? "for take out" : "at the restaurant";
    const [badge, tone] = o.status === "CANCELLED" ? ["Cancelled — not charged", "bg-muted text-muted-foreground"]
      : o.settlement === "ROOM" ? [o.reservationId === r.id ? "On this room's bill" : `On Room ${o.roomNumber ?? "?"}'s bill`, "bg-violet-500/12 text-violet-700 dark:text-violet-300"]
      : o.paidAmount >= o.total ? [`Paid at the restaurant${o.account ? ` · ${o.account.name}` : ""}`, "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"]
      : o.paidAmount > 0 ? [`Part-paid · ${formatTZS(o.total - o.paidAmount)} open ${at} — not on the room`, "bg-rose-500/12 text-rose-700 dark:text-rose-300"]
      : [`Open ${at} — not on the room`, "bg-rose-500/12 text-rose-700 dark:text-rose-300"];
    return { o, place, badge, tone, canPut: canPutOnRoom && o.status !== "CANCELLED" && o.settlement !== "ROOM" && o.paymentStatus === "UNPAID" && o.paidAmount === 0 };
  });
  // At a table right now: "At Outside 3 now · 2 orders · TZS x to pay at the table · TZS y on this room".
  const atTables = tables.map((t) => {
    const m = sessionMoney(t.orders);
    return { id: t.id, table: t.location.name, orders: m.orders, due: m.due, onThisRoom: t.orders.filter((o) => o.status !== "CANCELLED" && o.settlement === "ROOM" && o.reservationId === r.id).reduce((s, o) => s + o.total, 0) };
  });
  // Meeting room booking: same reservation, meeting words ("In use", "Completed"), times instead of nights.
  const meeting = r.kind === "MEETING";
  // Messages to the guest: booking details, welcome (in house), thank-you (after check-out).
  const origin = await siteOrigin();
  const settingsNow = await getSettings();
  const stayLink = `${origin}/stay/${await ensureGuestToken(db, r.id)}`;
  // Every message is the full one (the stay, the bill, the payment, the guest's link — src/lib/wa-messages.ts).
  const notArrived = ["INQUIRY", "RESERVED", "CONFIRMED"].includes(r.status);
  const lastPhonePay = r.payments.filter((p) => p.status === "POSTED" && p.kind === "PAYMENT" && p.method.code === "NTZS").at(-1) ?? null;
  const [bookingMsg, welcomeMsg, lastNote, sentMsgs] = await Promise.all([
    !["CANCELLED", "NO_SHOW"].includes(r.status) ? guestMessage(r.id, "BOOKING_CREATED", origin) : null,
    r.status === "CHECKED_IN" ? guestMessage(r.id, "WELCOME", origin) : null,
    r.status === "CHECKED_OUT" && !meeting ? db.thankYouNote.findFirst({ where: { reservationId: r.id }, orderBy: { version: "desc" }, select: { token: true } }) : null,
    db.guestMessage.findMany({ where: { reservationId: r.id }, orderBy: { createdAt: "desc" }, take: 20, include: { sentBy: { select: { fullName: true } } } }),
  ]);
  const [updatedMsg, billMsg, paidMsg, checkoutMsg, cancelledMsg] = await Promise.all([
    notArrived ? reservationMessage(r.id, "UPDATED", origin) : null,
    (r.status === "CHECKED_IN" || r.status === "CHECKED_OUT") && r.balanceAmount > 0 && r.billTo === "GUEST" ? reservationMessage(r.id, "BALANCE", origin) : null,
    lastPhonePay ? reservationMessage(r.id, "PAID", origin, { amount: lastPhonePay.amount, reference: lastPhonePay.reference?.replace(/^nTZS\s+/, "") ?? null }) : null,
    r.status === "CHECKED_OUT" ? reservationMessage(r.id, "CHECKOUT", origin, { thanksUrl: lastNote ? `${origin}/thanks/${lastNote.token}` : null }) : null,
    r.status === "CANCELLED" ? reservationMessage(r.id, "CANCELLED", origin) : null,
  ]);
  const opt = (type: GuestMessageOption["type"], label: string, m: { text: string; subject: string } | null) => (m ? [{ type, label, text: m.text, subject: m.subject }] : []);
  const messageOptions: GuestMessageOption[] = [
    ...opt("BOOKING_CREATED", meeting ? "Meeting room booking" : "Booking details", bookingMsg),
    ...opt("WELCOME", "Welcome & menu", welcomeMsg),
    ...opt("BOOKING_UPDATED", "Booking updated", updatedMsg),
    ...opt("PAYMENT_RECEIVED", "Payment received", paidMsg),
    ...opt("PAYMENT", "Bill & how to pay", billMsg),
    ...opt("THANK_YOU", "Check-out & thank you", checkoutMsg),
    ...opt("BOOKING_CANCELLED", "Booking cancelled", cancelledMsg),
  ];
  const autoMessage = !r.guest.phone ? null
    : sentParam === "welcome" && welcomeMsg && guestEventOn(settingsNow.guestNotifications, "checkIn") ? "WELCOME"
    : sentParam === "new" && bookingMsg && guestEventOn(settingsNow.guestNotifications, "bookingCreated") ? "BOOKING_CREATED" : null;
  const mr = meeting ? live[0] ?? r.rooms[0] : null;
  // Paid online through NTZS (the guest's own payment, recorded when NTZS confirmed it) — said plainly, with NTZS's reference.
  const ntzsPaid = r.payments.filter((p) => p.status === "POSTED" && p.kind === "PAYMENT" && p.method.code === "NTZS");
  const ntzsRef = ntzsPaid.find((p) => p.reference)?.reference?.replace(/^nTZS\s+/, "") ?? null;
  const payingOnline = !ntzsPaid.length && r.paidAmount === 0 && r.mobilePayments.some((m) => !m.expiresAt || m.expiresAt > now);

  return (
    <div className="w-full space-y-5">
      <Link href="/staff/reservations" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft /> Reservations</Link>

      {/* ── Header: who, status, key facts and the main actions ── */}
      <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div className="flex flex-wrap items-center gap-4 px-4 py-5 sm:px-6">
          <Initials name={r.companyName ?? r.guest.fullName} className="size-14 text-base" />
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              {meeting && r.companyName ? r.companyName : r.guest.fullName}
              <Badge variant="outline" className={meta.className}>{meeting ? MEETING_STATUS_LABEL[r.status] : meta.label}</Badge>
              {(() => { const ps = PAYMENT_STATUS_META[paymentStatus(r)]; return <Badge variant="outline" className={cn("border-transparent", ps.className)}>{ps.label}</Badge>; })()}
              {overdue && <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300">{meeting ? "Running over" : "Checkout overdue"}</Badge>}
            </h1>
            {r.group && (
              <Link href={`/staff/groups/${r.group.id}`} className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 rounded-full bg-violet-500/12 px-3 py-1 text-xs font-semibold text-violet-800 hover:bg-violet-500/20 dark:text-violet-200">
                <Users className="size-3.5" />Group booking · {r.group.name} · {r.group.reference} · {r.group._count.reservations} room{r.group._count.reservations === 1 ? "" : "s"} →
              </Link>
            )}
            {(r.source.code === "HOTEL_QR" || ntzsPaid.length > 0 || payingOnline) && (
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {r.source.code === "HOTEL_QR" && (
                  <Link href="/staff/hotel-qr" className="inline-flex items-center gap-1.5 rounded-full bg-[oklch(0.75_0.12_80/0.14)] px-3 py-1 text-xs font-semibold text-[oklch(0.5_0.1_75)] hover:bg-[oklch(0.75_0.12_80/0.22)] dark:text-[oklch(0.85_0.1_84)]">
                    <QrCode className="size-3.5" />Booked from the Hotel QR{r.bookingQr ? ` · ${r.bookingQr.label}` : ""}
                  </Link>
                )}
                {ntzsPaid.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <BadgeCheck className="size-3.5" />Paid online · NTZS · {formatTZS(ntzsPaid.reduce((t, p) => t + p.amount, 0))}{ntzsRef ? <span className="font-mono font-medium"> · {ntzsRef}</span> : null}
                  </span>
                )}
                {payingOnline && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/12 px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
                    <Loader2 className="size-3.5 animate-spin" />Guest is paying online (NTZS) · {formatTZS(r.mobilePayments[0].amount)}
                  </span>
                )}
              </span>
            )}
            {atTables.map((t) => (
              <a key={t.id} href="#restaurant" className="mt-1.5 mr-1.5 inline-flex flex-wrap items-center gap-1.5 rounded-full bg-amber-500/12 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-500/20 dark:text-amber-200">
                <UtensilsCrossed className="size-3.5" />At {t.table} now · {t.orders} order{t.orders === 1 ? "" : "s"}
                {t.due > 0 ? ` · ${formatTZS(t.due)} to pay at the table` : ""}{t.onThisRoom > 0 ? ` · ${formatTZS(t.onThisRoom)} on this room` : ""}
              </a>
            ))}
            {mr && <p className="mt-1 text-sm font-semibold text-violet-700 dark:text-violet-300">Room {mr.room.number} — {mr.roomType.name} · {timeRange(mr.startAt, mr.endAt)}{meeting && r.companyName ? ` · contact ${r.guest.fullName}` : ""}</p>}
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-mono">{r.reference}</span> · {r.source.name}{r.externalReference && ` · ${r.externalReference}`} · booked {formatDateTime(r.createdAt)} by {r.createdBy?.fullName ?? r.source.name}
            </p>
          </div>
          {!["CANCELLED", "INQUIRY"].includes(r.status) && (
            <Link href={`/staff/stay-bill?reservation=${r.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[oklch(0.75_0.13_80)]/50 bg-[oklch(0.75_0.13_80)]/10 px-3 text-sm font-semibold hover:bg-[oklch(0.75_0.13_80)]/20">
              <FileText className="size-4" />{meeting ? "Meeting bill" : "Room bill"}
            </Link>
          )}
          <ReservationActions
            reservationId={r.id}
            status={r.status}
            canConfirm={perms.edit && (r.status === "RESERVED" || (r.status === "INQUIRY" && (!payLater || can(user, "reservations.confirm_unpaid"))))}
            canCheckIn={perms.checkIn && waiting.length + notHeld.length > 0}
            canCheckOut={perms.checkOut && inHouse.length > 0}
            canCancel={perms.cancel && waiting.length + notHeld.length > 0}
            canNoShow={perms.cancel && waiting.length > 0 && waiting.every((w) => w.arrivalDate.toISOString().slice(0, 10) <= today)}
            balance={r.balanceAmount}
            paid={r.paidAmount}
            keepByDefault={(await getSettings()).noShowPolicy === "RETAIN_PAYMENT"}
            canConfirmUnpaid={can(user, "reservations.confirm_unpaid")}
            canLate={perms.edit}
            canInvoice={can(user, "invoices.manage") && r.billTo === "GUEST" && !["CANCELLED", "NO_SHOW", "INQUIRY"].includes(r.status)}
            invoiceId={r.invoices.find((i) => i.status !== "CANCELLED" && i.status !== "VOID")?.id ?? null}
            meeting={meeting}
            canOverrideBalance={can(user, "reservations.checkout_override")}
          />
        </div>
        {r.status === "NO_SHOW" && (
          <NoShowPanel reservationId={r.id} released={r.rooms.every((x) => x.status !== "NO_SHOW" || !!x.releasedAt)}
            releasedAt={r.rooms.find((x) => x.releasedAt)?.releasedAt ? formatDateTime(r.rooms.find((x) => x.releasedAt)!.releasedAt!) : null}
            canRelease={perms.cancel} paid={r.paidAmount} keepPolicy={(await getSettings()).noShowPolicy === "RETAIN_PAYMENT"} />
        )}
        {r.lateArrivalNotedAt && ["RESERVED", "CONFIRMED"].includes(r.status) && (
          <p className="flex flex-wrap items-center gap-2 border-t border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-800 sm:px-6 dark:text-sky-300">
            <Clock3 className="size-4 shrink-0" /><span><strong>Late arrival</strong>{r.eta ? ` · expected around ${r.eta}` : ""} — {r.lateArrivalNote}. The room stays reserved.</span>
          </p>
        )}
        {r.status === "INQUIRY" && (
          <p className="flex flex-wrap items-center gap-2 border-t border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-800 sm:px-6 dark:text-orange-300">
            <Clock3 className="size-4 shrink-0" />
            <span><strong>Not paid — the room is not held.</strong> {payLater ? "Booked online to pay later: " : ""}the room stays free for everyone until this booking is paid — whoever pays first gets it. A payment (a deposit is enough) secures it; at check-in give them any free room.</span>
          </p>
        )}
        {r.status === "RESERVED" && (
          <p className="flex flex-wrap items-center gap-2 border-t border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 sm:px-6 dark:text-amber-300">
            <Clock3 className="size-4 shrink-0" />
            <span><strong>Pending — not paid.</strong> {r.holdUntil ? <>The room is held until <strong>{formatDateTime(r.holdUntil)}</strong>. </> : null}Receive a payment (a deposit is enough) to confirm it{r.holdUntil ? "; otherwise the room is released automatically" : ""}.</span>
          </p>
        )}
        <dl className="grid grid-cols-2 border-t border-border/70 sm:grid-cols-3 lg:grid-cols-6">
          {(mr ? [
            ["Room", `${mr.room.number} — ${mr.roomType.name}`],
            ["Date", formatBusinessDate(mr.arrivalDate.toISOString().slice(0, 10), true)],
            [mr.checkedInAt ? "Started" : "Starts", formatTime(mr.checkedInAt ?? mr.startAt)],
            [mr.checkedOutAt ? "Completed" : "Ends", formatTime(mr.checkedOutAt ?? mr.endAt)],
            ["People", String(r.adults)],
          ] : [
            ["Room", live.map((x) => x.room.number).join(", ") || "—"],
            [inHouse.length || r.status === "CHECKED_OUT" ? "Checked in" : "Arrives", firstIn ? formatDateTime(firstIn) : "—"],
            [r.status === "CHECKED_OUT" ? "Checked out" : "Checkout", lastOut ? formatDateTime(lastOut) : "—"],
            ["Nights", String(nights)],
            ["Guests", `${r.adults} adult${r.adults === 1 ? "" : "s"}${r.children ? `, ${r.children} child${r.children === 1 ? "" : "ren"}` : ""}`],
          ]).map(([k, v]) => (
            <div key={k} className="px-4 py-3 sm:px-6"><dt className="text-xs text-muted-foreground">{k}</dt><dd className={cn("font-semibold", k === "Checkout" && overdue && "text-rose-600 dark:text-rose-400")}>{v}</dd></div>
          ))}
          <div className="px-4 py-3 sm:px-6"><dt className="text-xs text-muted-foreground">Balance</dt>
            <dd className={cn("font-semibold tabular-nums", r.balanceAmount > 0 ? "text-rose-600 dark:text-rose-400" : r.balanceAmount < 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
              {r.balanceAmount > 0 ? formatTZS(r.balanceAmount) : r.balanceAmount < 0 ? `Credit ${formatTZS(-r.balanceAmount)}` : "Paid"}
            </dd></div>
        </dl>
        <nav aria-label="Sections" className="flex gap-1.5 overflow-x-auto border-t border-border/70 px-4 py-2.5 text-xs font-medium [scrollbar-width:none] sm:px-6">
          {[["#stay", meeting ? "Meeting" : "Stay & rooms", BedDouble], ["#money", "Money", Wallet], ["#extras", meeting ? "Food & extras" : "Room service", Receipt], ["#guest", meeting ? "Customer" : "Guest", UserRound], ["#more", "Transport & requests", ClipboardList], ["#history", "History", History]].map(([href, label, I]) => {
            const Icon = I as typeof BedDouble;
            return <a key={href as string} href={href as string} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground"><Icon className="size-3.5" />{label as string}</a>;
          })}
        </nav>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-5">
          {/* ── Stay & rooms: dates, add nights, discount, room actions ── */}
          <section id="stay" className={cn(BOX, "scroll-mt-24")}>
            {watching && inHouse.filter((x) => !x.isDayUse).map((x, i) => (
              <div key={`decide-${x.id}`} className="mb-4">
                <StayDecisions discountMax={perms.discountMax} leavingToday={fromDbDate(x.departureDate) <= today}
                  move={perms.edit ? { reservationId: r.id, guest: r.guest.fullName, room: x.room.number } : null}
                  owing={i > 0 ? null : { reservationId: r.id, guest: r.guest.fullName, balance: r.balanceAmount, approved: r.leaveOwingAt && r.leaveOwingUpTo != null ? { upTo: r.leaveOwingUpTo, reason: r.leaveOwingReason ?? "" } : null }}
                  stay={{ reservationRoomId: x.id, ratePerNight: x.ratePerNight, discountPerNight: x.discountPerNight, nights: x.nights }} />
              </div>
            ))}
            <h2 className={H2}><BedDouble className="size-4 text-muted-foreground" />{meeting ? "Meeting" : <>Stay &amp; rooms</>}
              {mr && perms.edit && ["RESERVED", "CONFIRMED", "CHECKED_IN", "INQUIRY"].includes(mr.status) && (
                <span className="ml-auto">
                  <EditMeetingButton reservationId={r.id} date={mr.arrivalDate.toISOString().slice(0, 10)} start={formatTime(mr.startAt)} end={formatTime(mr.endAt)}
                    attendees={r.adults} capacity={mr.roomType.maxAdults} started={mr.status === "CHECKED_IN"}
                    companyName={r.companyName} specialRequests={r.specialRequests} internalNotes={r.internalNotes} />
                </span>
              )}
            </h2>
            <div className="space-y-4">
              {r.rooms.map((rr) => {
                const arrival = rr.arrivalDate.toISOString().slice(0, 10), departure = rr.departureDate.toISOString().slice(0, 10);
                const rs = RESERVATION_STATUS_META[rr.status];
                // (Booked to pay later — no room held: reception can still change its dates.)
                const upcomingRoom = rr.status === "RESERVED" || rr.status === "CONFIRMED" || rr.status === "INQUIRY";
                return (
                  <div key={rr.id} className="rounded-2xl border border-border/70 p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#17130e] text-lg font-bold tabular-nums text-[#f0cf86] dark:bg-gold dark:text-[#17130e]">{rr.room.number}</span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-semibold">{rr.roomType.name}<Badge variant="outline" className={rs.className}>{meeting ? MEETING_STATUS_LABEL[rr.status] : rs.label}</Badge></p>
                        <p className="text-sm text-muted-foreground">
                          {meeting ? `${formatBusinessDate(arrival)} · ${timeRange(rr.startAt, rr.endAt)} · ${hoursBetween(rr.startAt, rr.endAt)} h · ${rr.adults} ${rr.adults === 1 ? "person" : "people"}` : <>
                          {rr.isDayUse ? `Short time · ${formatBusinessDate(arrival)} · no breakfast` : `${formatBusinessDate(arrival)} → ${formatBusinessDate(departure)} · ${rr.nights} night${rr.nights === 1 ? "" : "s"}`}
                          {" · "}{rr.adults} adult{rr.adults === 1 ? "" : "s"}{rr.children ? `, ${rr.children} child` : ""}{rr.isLateArrival && " · late arrival"}
                          </>}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{formatTZS(rr.netAmount)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {rr.nightsLedger.length > 1 && new Set(rr.nightsLedger.map((n) => n.netAmount)).size > 1
                            ? "price varies by night"
                            : `${formatTZS(rr.nightsLedger[0]?.netAmount ?? rr.ratePerNight - rr.discountPerNight)}${meeting ? " per booking" : rr.isDayUse ? "" : " /night"}`}
                        </p>
                      </div>
                      <RoomRowActions
                        reservationId={r.id}
                        room={{ id: rr.id, number: rr.room.number, status: rr.status, isDayUse: rr.isDayUse, meeting, arrivalDate: arrival, departureDate: departure, discountPerNight: rr.discountPerNight }}
                        canEdit={perms.edit}
                        canDiscount={perms.discount}
                        move={{
                          guest: r.guest.fullName, methods: perms.pay ? methods : [],
                        }}
                      />
                    </div>
                    {rr.nightsLedger.length > 0 && !meeting && (
                      <details className="group mt-3 rounded-xl border border-border/60" open={new Set(rr.nightsLedger.map((n) => n.netAmount)).size > 1}>
                        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium">
                          <span>Price per night{rr.promotionName && <span className="ml-2 rounded-full bg-rose-500/12 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">{rr.promotionName}</span>}</span>
                          <span className="text-muted-foreground group-open:hidden">Show</span>
                        </summary>
                        <table className="w-full border-t border-border/60 text-xs">
                          <thead className="text-muted-foreground">
                            <tr><th className="px-3 py-1.5 text-left font-medium">Night</th><th className="px-2 py-1.5 text-right font-medium">Price</th><th className="px-2 py-1.5 text-right font-medium">Promotion</th><th className="px-2 py-1.5 text-right font-medium">Discount</th><th className="px-3 py-1.5 text-right font-medium">Pays</th></tr>
                          </thead>
                          <tbody className="divide-y divide-border/40 tabular-nums">
                            {rr.nightsLedger.map((n) => (
                              <tr key={n.id}>
                                <td className="px-3 py-1.5">{formatBusinessDate(n.businessDate.toISOString().slice(0, 10))}</td>
                                <td className="px-2 py-1.5 text-right">{n.grossAmount.toLocaleString("en-US")}</td>
                                <td className="px-2 py-1.5 text-right" title={n.promotionName ?? undefined}>{n.promoDiscount ? `− ${n.promoDiscount.toLocaleString("en-US")}` : "—"}</td>
                                <td className="px-2 py-1.5 text-right">{n.manualDiscount ? `− ${n.manualDiscount.toLocaleString("en-US")}` : "—"}</td>
                                <td className="px-3 py-1.5 text-right font-semibold">{n.netAmount.toLocaleString("en-US")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">Each night keeps the price it was booked at. Nights added later use the price on the day they were added.</p>
                      </details>
                    )}
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {rr.checkedInAt && <span>{meeting ? "Started" : "In"} {formatDateTime(rr.checkedInAt)} by {rr.checkedInBy?.fullName ?? "—"}</span>}
                      {rr.checkedOutAt ? <span>{meeting ? "Completed" : "Out"} {formatDateTime(rr.checkedOutAt)} by {rr.checkedOutBy?.fullName ?? "—"}</span> : <span className={cn(rr.status === "CHECKED_IN" && rr.endAt <= now && "font-semibold text-rose-600 dark:text-rose-400")}>{meeting ? "Ends" : "Checkout"} {formatDateTime(rr.endAt)}</span>}
                      {meeting && r.specialRequests && <span className="basis-full">Requirements: {r.specialRequests}</span>}
                    </p>

                    {perms.edit && !rr.isDayUse && (rr.status === "CHECKED_IN" || upcomingRoom) && (
                      <div className="mt-4 grid gap-4 border-t border-dashed border-border pt-4 lg:grid-cols-2">
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{rr.status === "CHECKED_IN" ? "Add nights" : "Change dates"}</p>
                          {rr.status === "CHECKED_IN"
                            ? <ExtendStay reservationId={r.id} today={today} canDiscount={perms.discount} discountMax={perms.discountMax} room={{ id: rr.id, number: rr.room.number, departure, endAt: rr.endAt.toISOString(), ratePerNight: rr.ratePerNight, discountPerNight: rr.discountPerNight, nights: rr.nights }} />
                            : <StayDates reservationId={r.id} today={today} canEdit room={{ id: rr.id, arrival, departure }} />}
                        </div>
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Discount</p>
                          <DiscountEditor reservationId={r.id} canEdit={perms.discount} max={perms.discountMax}
                            room={{ id: rr.id, number: rr.room.number, ratePerNight: rr.ratePerNight, discountPerNight: rr.discountPerNight, nights: rr.nights }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Room service & extras ── */}
          {!["CANCELLED", "NO_SHOW"].includes(r.status) && (
            <section id="extras" className="grid scroll-mt-24 items-start gap-5 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              {perms.pay && (
                <div className={BOX}>
                  <h2 className={H2}><Receipt className="size-4 text-muted-foreground" />Room service &amp; extras</h2>
                  <p className="-mt-2 mb-4 text-xs text-muted-foreground">Meals, drinks, laundry, transport… it goes on this guest&apos;s bill and is paid at checkout.</p>
                  <ChargeComposer reservationId={r.id} roomLabel={roomLabel} recent={recent}
                    methods={methods} canPay={perms.pay} menu={bill} menuPayNow={can(user, "revenue.record")} />
                </div>
              )}
              <div className={cn(BOX, !perms.pay && "2xl:col-span-2")}>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold">Guest&apos;s tab</h2>
                  <span className="text-sm font-semibold tabular-nums">{formatTZS(tab.reduce((sum, c) => sum + c.amount, 0))}</span>
                </div>
                <GuestTab reservationId={r.id} charges={tab} canVoid={perms.reverse} />
              </div>
            </section>
          )}

          {/* ── Transport, requests, room moves ── */}
          <section id="more" className="grid scroll-mt-24 gap-5 md:grid-cols-2 2xl:grid-cols-3">
            <div className={BOX}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold"><Car className="size-4 text-muted-foreground" />Transport</h2>
                {(can(user, "transport.request") || can(user, "transport.manage")) && open && (
                  <Link href={`/staff/transport?reservation=${r.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Add trip</Link>
                )}
              </div>
              <div className="space-y-2 text-sm">
                {r.trips.length === 0 ? <p className="text-muted-foreground">No transport booked.</p> : r.trips.map((t) => (
                  <div key={t.id} className="rounded-xl border border-border/70 p-2.5">
                    <p className="font-medium">{TRIP_TYPE_LABEL[t.type]} · {formatDateTime(t.pickupAt)}</p>
                    <p className="text-xs text-muted-foreground">{t.pickupLocation} → {t.destination}{t.flightNumber && ` · ${t.flightNumber}`}</p>
                    <p className="mt-1 text-xs"><Badge variant="outline" className={TRIP_STATUS_META[t.status].className}>{TRIP_STATUS_META[t.status].label}</Badge> {t.driver ? `Driver ${t.driver.fullName}` : "No driver yet"}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className={BOX}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold"><ClipboardList className="size-4 text-muted-foreground" />Guest requests</h2>
                {can(user, "requests.manage") && r.status === "CHECKED_IN" && <NewRequestDialog compact guests={[]} staff={staffList} reservationId={r.id} />}
              </div>
              <div className="space-y-2 text-sm">
                {r.requests.length === 0 ? <p className="text-muted-foreground">No requests.</p> : r.requests.map((q) => (
                  <div key={q.id} className="flex items-start justify-between gap-2 rounded-xl border border-border/70 p-2.5">
                    <div><p className="font-medium">{REQUEST_TYPE_LABEL[q.type]}</p><p className="text-xs text-muted-foreground">{q.description}</p></div>
                    <Badge variant="outline">{q.status.toLowerCase().replace("_", " ")}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <div className={BOX}>
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><BedDouble className="size-4 text-muted-foreground" />Room moves</h2>
              <div className="space-y-1.5 text-sm">
                {/* Where the guest slept, night by night (a move keeps the earlier nights in the old room). */}
                {r.rooms.filter((x) => x.assignments.length > 0).map((x) => {
                  const segs: { room: string; from: string; to: string }[] = [];
                  for (const n of x.nightsLedger) {
                    const num = roomNumbers.get(n.roomId) ?? "?";
                    const d = n.businessDate.toISOString().slice(0, 10);
                    const last = segs.at(-1);
                    if (last && last.room === num) last.to = d; else segs.push({ room: num, from: d, to: d });
                  }
                  return segs.length > 1 ? (
                    <p key={x.id} className="flex flex-wrap items-center gap-1.5 rounded-xl bg-muted/50 px-2.5 py-1.5 text-xs">
                      {segs.map((g, i) => <span key={i}>{i > 0 && "→ "}<strong>Room {g.room}</strong> {formatBusinessDate(g.from)}–{formatBusinessDate(addDays(g.to, 1))}</span>)}
                    </p>
                  ) : null;
                })}
                {r.rooms.flatMap((x) => x.assignments).length === 0 ? <p className="text-muted-foreground">No room changes.</p> :
                  r.rooms.flatMap((x) => x.assignments).map((a) => (
                    <div key={a.id} className="rounded-xl border border-border/70 p-2.5">
                      <p className="flex flex-wrap items-center gap-2">
                        <strong>{a.fromRoom.number} → {a.toRoom.number}</strong>
                        <span className={cn("rounded-full px-2 py-px text-[10px] font-semibold", a.source === "HOTEL" ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : a.source === "ARRIVAL" || a.source === "PAYMENT" ? "bg-muted text-muted-foreground" : "bg-sky-500/12 text-sky-700 dark:text-sky-300")}>
                          {a.source === "HOTEL" ? "Hotel-initiated" : a.source === "ARRIVAL" ? "Assigned at arrival" : a.source === "PAYMENT" ? "Room checked again at payment" : "Customer requested"}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(a.changedAt)} · {a.changedBy?.fullName ?? "—"}</span>
                      </p>
                      {a.reason && <p className="text-xs text-muted-foreground">{a.reason}</p>}
                      {a.oldPrice != null && (
                        <p className="mt-1 text-xs">
                          {a.fromTypeName} → {a.toTypeName} · {a.nights} night{a.nights === 1 ? "" : "s"} · was {formatTZS(a.oldPrice)}, new room normally {formatTZS(a.newStandardPrice ?? 0)} ·{" "}
                          <strong>{a.charged > 0 ? `guest paid +${formatTZS(a.charged)}` : a.charged < 0 ? `credit ${formatTZS(-a.charged)}` : "no charge"}</strong>
                          {a.compensation > 0 && <span className="text-amber-700 dark:text-amber-400"> · hotel compensation {formatTZS(a.compensation)}</span>}
                          {a.oldRoomStatus && <span className="text-muted-foreground"> · room {a.fromRoom.number} → {a.oldRoomStatus.toLowerCase()}</span>}
                        </p>
                      )}
                      {a.oldPrice == null && a.priceDifference ? <p className="text-xs">upgrade {formatTZS(a.priceDifference)}</p> : null}
                    </div>
                  ))}
                {r.welcomeChecklist && (
                  <div className="mt-3 border-t border-border pt-2">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Welcome checklist</p>
                    <p className="text-xs">{Object.entries(r.welcomeChecklist as Record<string, boolean>).filter(([, v]) => v).map(([k]) => k.replace(/([A-Z])/g, " $1").toLowerCase()).join(" · ")}</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── History ── */}
          <section id="history" className={cn(BOX, "scroll-mt-24")}>
            <h2 className={H2}><History className="size-4 text-muted-foreground" />History</h2>
            <ol className="relative space-y-3 border-l border-border pl-5 text-sm">
              {history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[1.62rem] top-1.5 size-2.5 rounded-full border-2 border-card bg-foreground/60" />
                  <p><span className="text-xs text-muted-foreground">{formatDateTime(h.at)}</span> · <span className="font-medium">{h.who}</span> {h.label}</p>
                  {h.changes.length > 0 && (
                    <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {h.changes.map((c) => (
                        <span key={c.field}><span className="text-muted-foreground">{c.field}:</span> {c.from && <span className="text-rose-600 line-through decoration-rose-400/60 dark:text-rose-400">{c.from}</span>}{c.from && c.to && " → "}{c.to && <span className="font-medium text-emerald-700 dark:text-emerald-400">{c.to}</span>}</span>
                      ))}
                    </p>
                  )}
                  {h.reason && <p className="text-xs text-muted-foreground">Reason: {h.reason}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* ── Side: money & guest ── */}
        <aside className="space-y-5 xl:sticky xl:top-24">
          <section id="money" className={cn(BOX, "scroll-mt-24")}>
            <h2 className={H2}><Wallet className="size-4 text-muted-foreground" />Money</h2>
            <div className="space-y-1.5 text-sm">
              <Line label="Room charges" value={formatTZS(r.grossAmount)} />
              {r.discountAmount > 0 && <Line label="Discount" value={`− ${formatTZS(r.discountAmount)}`} />}
              {extras.map((x) => <Line key={x.label} label={x.label} value={formatTZS(x.amount)} />)}
              <Line label="Total" value={formatTZS(r.netAmount)} strong />
              <Line label="Paid" value={formatTZS(r.paidAmount)} />
              {r.companyBilledAmount !== 0 && <Line label={`On ${r.corporateCustomer?.companyName ?? "company"}'s invoice`} value={`− ${formatTZS(r.companyBilledAmount)}`} />}
              <div className={cn("mt-2 flex justify-between rounded-2xl px-3 py-2.5 text-base font-bold",
                r.balanceAmount > 0 ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : r.balanceAmount < 0 ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
                <span>{r.balanceAmount < 0 ? "Credit (refund due)" : r.billTo !== "GUEST" && r.corporateCustomerId ? "Still to settle" : "Balance"}</span>
                <span className="tabular-nums">{formatTZS(Math.abs(r.balanceAmount))}</span>
              </div>
              {perms.pay && (
                <PaymentPanel reservationId={r.id} balance={r.balanceAmount} paid={r.paidAmount} canRefund={perms.reverse}
                  methods={methods} phone={r.guest.phone} who={r.guest.fullName}
                  resume={paying ? { id: paying.id, amount: paying.amount, phone: maskPhone(paying.phone) } : null} />
              )}
            </div>
            <div className="mt-4 space-y-2 border-t border-dashed border-border pt-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payments</p>
              {r.payments.length === 0 && <p className="text-muted-foreground">No payments yet.</p>}
              {r.payments.map((p) => (
                <div key={p.id} className={cn("flex items-start justify-between gap-2 rounded-xl border border-border/70 p-2.5", p.status === "REVERSED" && "opacity-60")}>
                  <div>
                    <p className={cn("font-medium tabular-nums", p.status === "REVERSED" && "line-through")}>
                      {p.kind === "REFUND" ? "Refund −" : ""}{formatTZS(p.amount)} <span className="font-normal text-muted-foreground">→ {p.account.name}{p.account.accountNumber && ` · ${p.account.accountNumber}`}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{p.method.name} · {formatDateTime(p.receivedAt)} · {p.recordedBy.fullName}{p.reference && ` · ${p.reference}`}</p>
                    {p.status === "REVERSED" && <p className="text-xs text-destructive">Reversed by {p.reversedBy?.fullName}: {p.reversalReason}</p>}
                    {p.corrections.map((c) => (
                      <p key={c.id} className="text-[11px] text-violet-700 dark:text-violet-300">
                        Corrected {formatDateTime(c.changedAt)}: {accountNames.get(c.fromAccountId ?? "") ?? "?"} → {accountNames.get(c.toAccountId ?? "") ?? "?"}{c.fromReference !== c.toReference ? ` · ref ${c.fromReference ?? "—"} → ${c.toReference ?? "—"}` : ""}{c.reason && ` · ${c.reason}`}
                      </p>
                    ))}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {perms.pay && p.status === "POSTED" && <CorrectPaymentButton reservationId={r.id} methods={methods} payment={{ id: p.id, amount: p.amount, accountId: p.accountId, method: p.account.name, reference: p.reference }} canReference={perms.reverse} />}
                    {perms.reverse && p.status === "POSTED" && <ReversePaymentButton reservationId={r.id} paymentId={p.id} />}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {(orders.length > 0 || (canOrder && !watching && r.status === "CHECKED_IN")) && (
            <section id="restaurant" className={cn(BOX, "scroll-mt-24")}>
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className={cn(H2, "mb-0")}><Receipt className="size-4 text-muted-foreground" />Restaurant & bar orders</h2>
                {canOrder && !watching && r.status === "CHECKED_IN" && orderMenu.length > 0 && (
                  <OrderComposer menu={orderMenu} guests={orderGuests} accounts={methods} fee={roomServiceFee} canPay={can(user, "revenue.record")} startGuest={r.id} />
                )}
              </div>
              {orders.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
                <ul className="space-y-2">
                  {orderRows.map(({ o, place, badge, tone, canPut }) => (
                    <li key={o.id} className={cn("rounded-2xl border border-border/70 p-3 text-sm", o.status === "CANCELLED" && "opacity-60")}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-xs font-semibold">{o.number} <span className="font-sans font-normal text-muted-foreground">· {TYPE_LABEL[o.type]}{place ? ` · ${place}` : ""} · {formatDateTime(o.createdAt)}{o.source === "GUEST" ? " · ordered by the guest (phone)" : o.createdBy ? ` · ${o.createdBy.fullName}` : ""}</span></p>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">{STATUS_LABEL[o.status]}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", tone)}>{badge}</span>
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">{o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}{o.serviceFee ? ` · room service ${formatTZS(o.serviceFee)}` : ""}</p>
                      <div className="mt-1 flex items-center justify-end gap-2">
                        {canPut && <PutOnRoomButton orderId={o.id} reservationId={r.id} room={roomLabel} />}
                        <p className={cn("font-semibold tabular-nums", o.status === "CANCELLED" && "line-through")}>{formatTZS(o.total)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section id="billing" className={cn(BOX, "scroll-mt-24")}>
            <div className="flex items-center justify-between gap-2">
              <h2 className={H2}><Building2 className="size-4 text-muted-foreground" />Who pays</h2>
              {!["CANCELLED", "NO_SHOW"].includes(r.status) && <Link href={`/staff/reservations/${r.id}/proforma`} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted">Proforma invoice</Link>}
              {r.status === "CHECKED_OUT" && r.kind === "STAY" && <Link href={`/staff/reservations/${r.id}/thank-you`} className="rounded-lg border border-[oklch(0.75_0.13_80)]/50 bg-[oklch(0.75_0.13_80)]/10 px-2.5 py-1 text-xs font-medium hover:bg-[oklch(0.75_0.13_80)]/20">Thank-you note</Link>}
            </div>
            <BillingPanel
              reservationId={r.id}
              group={r.group ? { id: r.group.id, name: r.group.name, reference: r.group.reference, payer: r.group.corporateCustomer?.companyName ?? r.group.contactGuest.fullName } : null}
              company={r.corporateCustomer ? { id: r.corporateCustomer.id, name: r.corporateCustomer.companyName, terms: r.corporateCustomer.paymentTermDays } : null}
              billTo={r.billTo as BillTo} covers={r.companyCovers} terms={r.paymentTermDays}
              billed={r.companyBilledAmount} unbilled={unbilled} invoices={companyInvoices}
              companies={companies.map((c) => ({ id: c.id, companyName: c.companyName, terms: c.paymentTermDays, billTo: c.defaultBillTo as BillTo, covers: c.defaultCovers }))}
              canEdit={perms.edit} canBill={can(user, "invoices.manage")} closed={["CANCELLED", "NO_SHOW"].includes(r.status)}
            />
          </section>

          {messageOptions.length > 0 && (
            <section id="message" className={cn(BOX, "scroll-mt-24")}>
              <h2 className={H2}><MessageCircle className="size-4 text-muted-foreground" />Message the guest</h2>
              <GuestMessenger reservationId={r.id} guest={{ name: r.guest.fullName, phone: r.guest.phone, email: r.guest.email }}
                options={messageOptions} link={stayLink} autoOpen={autoMessage}
                sent={sentMsgs.map((m) => ({ type: m.type, channel: m.channel, at: m.createdAt.toISOString(), by: m.sentBy?.fullName ?? null }))} />
            </section>
          )}

          <section id="guest" className={cn(BOX, "scroll-mt-24")}>
            <h2 className={H2}><UserRound className="size-4 text-muted-foreground" />Guest</h2>
            <div className="space-y-1 text-sm">
              <p className="font-medium"><Link className="underline-offset-4 hover:underline" href={`/staff/guests/${r.guest.id}`}>{r.guest.fullName}</Link></p>
              {r.guest.phone && <p><a className="underline-offset-4 hover:underline" href={`tel:${r.guest.phone}`}>{r.guest.phone}</a></p>}
              {r.guest.email && <p>{r.guest.email}</p>}
              <p className={cn(!r.guest.idNumber && "text-amber-700 dark:text-amber-400")}>{r.guest.idNumber ? `${r.guest.idType?.replace("_", " ").toLowerCase() ?? "ID"} ${r.guest.idNumber}` : "No ID on file"}</p>
              {r.guest.nationality && <p className="text-muted-foreground">{r.guest.nationality}</p>}
              {r.specialRequests && <p className="mt-2 rounded-xl bg-muted p-2.5">Guest asked: {r.specialRequests}</p>}
              {r.internalNotes && <p className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5">Staff note: {r.internalNotes}</p>}
              {r.cancelReason && <p className="mt-2 rounded-xl bg-destructive/10 p-2.5 text-destructive">Cancelled: {r.cancelReason}</p>}
            </div>
            {!meeting && <Occupants reservationId={r.id} occupants={r.guests.map((x) => x.guest)} canEdit={open && (perms.edit || perms.checkIn)} />}
            {can(user, "guests.manage") && (
              <details className="group mt-4 border-t border-dashed border-border pt-3">
                <summary className="cursor-pointer list-none text-sm font-semibold text-[oklch(0.55_0.11_76)] dark:text-gold">Edit guest details <span className="text-xs font-normal text-muted-foreground group-open:hidden">— name, phone, ID…</span></summary>
                <div className="mt-3">
                  <GuestEditForm canEdit guest={{
                    id: r.guest.id, fullName: r.guest.fullName, phone: r.guest.phone ?? "", email: r.guest.email ?? "", idType: r.guest.idType ?? "",
                    idNumber: r.guest.idNumber ?? "", nationality: r.guest.nationality ?? "", address: r.guest.address ?? "", notes: r.guest.notes ?? "",
                  }} />
                </div>
              </details>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

const BOX = "rounded-3xl border border-border/70 bg-card p-4 sm:p-6";
const H2 = "mb-4 flex items-center gap-2 text-base font-semibold";

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "border-t border-border pt-1.5 font-semibold")}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
