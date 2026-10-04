import type { Metadata } from "next";
import { guestEventOn } from "@/lib/guest-messages";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { formatMinutes } from "@/lib/time/business-date";
import { PageHeader } from "@/components/staff/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsForm } from "./settings-form";
import { LookupList } from "./lookup-list";

export const metadata: Metadata = { title: "Hotel settings" };

export default async function SettingsPage() {
  await requirePagePermission("settings.manage");
  const [s, sources, methods, expenseCats, revenueCats] = await Promise.all([
    getSettings(),
    db.bookingSource.findMany({ orderBy: { sortOrder: "asc" } }),
    db.paymentMethod.findMany({ orderBy: { sortOrder: "asc" } }),
    db.expenseCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    db.revenueCategory.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const recipients = (s.reportRecipients as { name?: string; phone: string; apiKeyRef?: string | null }[])
    .map((r) => [r.name ?? "", r.phone, r.apiKeyRef ?? ""].filter((v, i) => i < 2 || v).join(", "))
    .join("\n");

  return (
    <div className="w-full">
      <PageHeader title="Hotel settings" description="Central configuration used by every module. All changes are audited." />
      <Tabs defaultValue="general">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="general">General & operations</TabsTrigger>
          <TabsTrigger value="lists">Lists</TabsTrigger>
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
              thankYouPromoText: s.thankYouPromoText ?? "", thankYouRebookText: s.thankYouRebookText ?? "", instagramUrl: s.instagramUrl ?? "", facebookUrl: s.facebookUrl ?? "",
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
              arrivalReminderTemplate: s.arrivalReminderTemplate ?? "",
              bookingMessageTemplate: s.bookingMessageTemplate ?? "",
              welcomeMessageTemplate: s.welcomeMessageTemplate ?? "",
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
          <LookupList kind="bookingSource" title="Booking sources" items={sources} />
          <LookupList kind="paymentMethod" title="Payment methods" items={methods} />
          <LookupList kind="expenseCategory" title="Expense categories" items={expenseCats} />
          <LookupList kind="revenueCategory" title="Revenue categories" items={revenueCats.map((r) => ({ ...r, hint: r.kind }))} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
