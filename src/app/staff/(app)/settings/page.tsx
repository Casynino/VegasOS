import type { Metadata } from "next";
import Link from "next/link";
import { GUEST_MESSAGE_TYPES, guestEventOn } from "@/lib/guest-messages";
import { guestNotifyConnected } from "@/server/services/guest-notify";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { formatMinutes } from "@/lib/time/business-date";
import { PageHeader } from "@/components/staff/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsForm } from "./settings-form";
import { LookupList } from "./lookup-list";
import { formatRecipientLine } from "@/lib/report-recipients";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Hotel settings") };
}

/** How a message went out (shown in lower case, as before). */
const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: msg("whatsapp"), SMS: msg("sms"), EMAIL: msg("email") };

export default async function SettingsPage() {
  await requirePagePermission("settings.manage");
  const t = await getT();
  const [s, sources, methods, expenseCats, revenueCats, messages] = await Promise.all([
    getSettings(),
    db.bookingSource.findMany({ orderBy: { sortOrder: "asc" } }),
    db.paymentMethod.findMany({ orderBy: { sortOrder: "asc" } }),
    db.expenseCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    db.revenueCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    db.guestMessage.findMany({
      orderBy: { createdAt: "desc" }, take: 40,
      select: { id: true, type: true, channel: true, to: true, status: true, error: true, createdAt: true, guestId: true, guest: { select: { fullName: true } }, sentBy: { select: { fullName: true } }, reservation: { select: { id: true, reference: true } } },
    }),
  ]);
  const failed = messages.filter((m) => m.status === "FAILED").length;

  const recipients = (s.reportRecipients as { name?: string; phone: string; apiKeyRef?: string | null; lang?: string | null }[])
    .map(formatRecipientLine)
    .join("\n");

  return (
    <div className="w-full">
      <PageHeader title={t("Hotel settings")} description={t("Central configuration used by every module. All changes are audited.")} />
      <Tabs defaultValue="general">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="general">{t("General & operations")}</TabsTrigger>
          <TabsTrigger value="lists">{t("Lists")}</TabsTrigger>
          <TabsTrigger value="messages">{t("Guest messages")}{failed ? ` · ${t("{n} failed", { n: failed })}` : ""}</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <SettingsForm
            defaults={{
              hotelName: s.hotelName,
              tagline: s.tagline ?? "",
              addressLine: s.addressLine ?? "",
              postalAddress: s.postalAddress ?? "",
              city: s.city ?? "",
              country: s.country ?? "",
              phone: s.phone ?? "",
              email: s.email ?? "",
              website: s.website ?? "",
              whatsapp: s.whatsapp ?? "",
              mapUrl: s.mapUrl ?? "",
              businessDayStart: formatMinutes(s.businessDayStartMinutes),
              standardCheckIn: formatMinutes(s.standardCheckInMinutes),
              checkout: formatMinutes(s.checkoutMinutes),
              lateArrival: formatMinutes(s.lateArrivalMinutes),
              expenseApprovalThreshold: s.expenseApprovalThreshold,
              purchaseApproverMustDiffer: s.purchaseApproverMustDiffer,
              bankName: s.bankName ?? "",
              bankAccountName: s.bankAccountName ?? "",
              bankAccountNumber: s.bankAccountNumber ?? "",
              bankBranch: s.bankBranch ?? "",
              bankSwift: s.bankSwift ?? "",
              mobileMoneyName: s.mobileMoneyName ?? "",
              mobileMoneyNumber: s.mobileMoneyNumber ?? "",
              mobileMoneyAccountName: s.mobileMoneyAccountName ?? "",
              invoiceTerms: s.invoiceTerms ?? "",
              thankYouMessage: s.thankYouMessage ?? "", thankYouSignoff: s.thankYouSignoff ?? "", thankYouPromoTitle: s.thankYouPromoTitle ?? "",
              thankYouPromoText: s.thankYouPromoText ?? "", thankYouRebookText: s.thankYouRebookText ?? "", instagramUrl: s.instagramUrl ?? "", facebookUrl: s.facebookUrl ?? "", tiktokUrl: s.tiktokUrl ?? "",
              invoiceDefaultDueDays: s.invoiceDefaultDueDays,
              taxName: s.taxName ?? "",
              taxRatePercent: s.taxRatePercent?.toString() ?? "",
              taxIncludedInRates: s.taxIncludedInRates,
              reportEnabled: s.reportEnabled,
              shiftReportEnabled: s.shiftReportEnabled,
              reportRecipients: recipients,
              publicBookingEnabled: s.publicBookingEnabled,
              maxAdvanceBookingDays: s.maxAdvanceBookingDays,
              wifiNetwork: s.wifiNetwork ?? "",
              wifiPassword: s.wifiPassword ?? "",
              receptionHours: s.receptionHours ?? "",
              breakfastHours: s.breakfastHours ?? "",
              restaurantHours: s.restaurantHours ?? "",
              barHours: s.barHours ?? "",
              lateCheckoutFee: s.lateCheckoutFee,
              roomServiceFee: s.roomServiceFee,
              earlyDeparturePolicy: s.earlyDeparturePolicy,
              unpaidHoldHours: s.unpaidHoldHours,
              noShowCutoff: formatMinutes(s.noShowCutoffMinutes),
              noShowAutoRelease: s.noShowAutoRelease,
              dateChangePayNow: s.dateChangePayNow,
              dateChangeExcessPolicy: s.dateChangeExcessPolicy,
              notifyBookingCreated: guestEventOn(s.guestNotifications, "bookingCreated"),
              notifyCheckIn: guestEventOn(s.guestNotifications, "checkIn"),
              notifyCheckOut: guestEventOn(s.guestNotifications, "checkOut"),
              notifyOrders: guestEventOn(s.guestNotifications, "orders"),
              publicOrderingEnabled: s.publicOrderingEnabled,
              orderPrepMinutes: s.orderPrepMinutes ?? "",
              noShowPolicy: s.noShowPolicy,
              airportTransferPrice: s.airportTransferPrice ?? "",
              currency: s.currency,
              timezone: s.timezone,
            }}
          />
        </TabsContent>
        <TabsContent value="lists" className="grid gap-4 md:grid-cols-2">
          <LookupList kind="bookingSource" title={t("Booking sources")} items={sources} />
          <LookupList kind="paymentMethod" title={t("Payment methods")} items={methods} />
          <LookupList kind="expenseCategory" title={t("Expense categories")} items={expenseCats} />
          <LookupList kind="revenueCategory" title={t("Revenue categories")} items={revenueCats.map((r) => ({ ...r, hint: r.kind }))} />
        </TabsContent>
        <TabsContent value="messages">
          {/* Every WhatsApp / SMS / email the hotel sent a guest — by staff in one tap, or by itself — newest first. */}
          <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-4 py-3">
              <h2 className="text-sm font-semibold">{t("Messages to guests · the latest 40")}</h2>
              <p className="text-xs text-muted-foreground">{guestNotifyConnected() ? t("Sending by itself (provider connected)") : t("Sent by staff in one tap — no provider connected")}</p>
            </header>
            {messages.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">{t("No messages sent yet.")}</p> : (
              <ul className="divide-y divide-border/50">
                {messages.map((m) => (
                  <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        <span className="font-medium">{t(GUEST_MESSAGE_TYPES[m.type as keyof typeof GUEST_MESSAGE_TYPES] ?? m.type)}</span>
                        <span className="text-muted-foreground"> · </span>
                        <Link href={`/staff/guests/${m.guestId}`} className="underline-offset-2 hover:underline">{m.guest.fullName}</Link>
                        {m.reservation && <><span className="text-muted-foreground"> · </span><Link href={`/staff/reservations/${m.reservation.id}`} className="font-mono text-xs underline-offset-2 hover:underline">{m.reservation.reference}</Link></>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{t.dateTime(m.createdAt, s.timezone)} · {m.sentBy?.fullName ?? t("Automatic")} · {t(CHANNEL_LABEL[m.channel] ?? m.channel.toLowerCase())}{m.to ? ` · ${m.to}` : ""}</span>
                      {m.status === "FAILED" && m.error && <span className="block truncate text-xs text-rose-700 dark:text-rose-300">{m.error}</span>}
                    </span>
                    <span className={m.status === "FAILED" ? "self-center rounded-full bg-rose-500/12 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300" : "self-center rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"}>
                      {m.status === "FAILED" ? t("Failed") : t("Sent")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
