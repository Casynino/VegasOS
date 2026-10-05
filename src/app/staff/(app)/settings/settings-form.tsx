"use client";

import { Loader2 } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeCheckbox } from "@/components/ui/native-select";
import { updateSettingsAction } from "./actions";
import { THANK_YOU_DEFAULTS } from "@/lib/thank-you";

type Defaults = Record<string, string | number | boolean>;

function Field({ name, label, d, errors, type = "text", hint, ...rest }: {
  name: string; label: string; d: Defaults; errors?: Record<string, string>; type?: string; hint?: string;
} & React.ComponentProps<"input">) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={String(d[name] ?? "")} aria-invalid={!!errors?.[name]} {...rest} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError message={errors?.[name]} />
    </div>
  );
}

export function SettingsForm({ defaults: d }: { defaults: Defaults }) {
  return (
    <ActionForm action={updateSettingsAction} className="space-y-4">
      {({ pending, fieldErrors: e }) => (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Hotel details</CardTitle>
              <CardDescription>Shown on the public website, confirmations and invoices.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field name="hotelName" label="Hotel name" d={d} errors={e} required />
              <Field name="tagline" label="Tagline" d={d} errors={e} />
              <Field name="addressLine" label="Address" d={d} errors={e} />
              <Field name="postalAddress" label="Postal address" d={d} errors={e} />
              <Field name="city" label="City" d={d} errors={e} />
              <Field name="country" label="Country" d={d} errors={e} />
              <Field name="phone" label="Phone" d={d} errors={e} />
              <Field name="whatsapp" label="WhatsApp number" d={d} errors={e} />
              <Field name="email" label="Email" type="email" d={d} errors={e} />
              <Field name="website" label="Website" d={d} errors={e} />
              <div className="sm:col-span-2">
                <Field name="mapUrl" label="Google Maps link" d={d} errors={e} placeholder="https://maps.google.com/…" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hotel day & stay times</CardTitle>
              <CardDescription>
                Timezone {String(d.timezone)}. All revenue, expenses, occupancy and reports use the business-day start —
                change it only with care, as it moves the boundary for future records.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <Field name="businessDayStart" label="Business day starts" type="time" d={d} errors={e} />
              <Field name="standardCheckIn" label="Standard check-in" type="time" d={d} errors={e} />
              <Field name="checkout" label="Checkout" type="time" d={d} errors={e} />
              <Field name="lateArrival" label="Late arrival from" type="time" d={d} errors={e} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pricing, expenses & invoices</CardTitle>
              <CardDescription>Amounts in {String(d.currency)}. Room prices, promotions and staff discounts are in <a href="/staff/settings/pricing" className="font-medium underline underline-offset-2">Settings → Room pricing</a>.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field name="expenseApprovalThreshold" label="Expense approval threshold" type="number" min={0} step={1000} d={d} errors={e}
                hint="Expenses at or above this amount wait for manager approval." />
              <Field name="invoiceDefaultDueDays" label="Invoice due after (days, when no company terms)" type="number" min={0} d={d} errors={e}
                hint="Invoice numbers are automatic: INV-2026-000001, INV-2026-000002 …" />
              <Field name="taxName" label="Tax name (optional)" d={d} errors={e} placeholder="VAT" />
              <Field name="taxRatePercent" label="Tax rate % (optional)" type="number" step="0.01" min={0} max={100} d={d} errors={e} />
              <NativeCheckbox name="taxIncludedInRates" defaultChecked={Boolean(d.taxIncludedInRates)}
                label="Room rates already include tax" className="sm:col-span-2" />
              <div id="purchaseApproverMustDiffer" className="space-y-1 sm:col-span-2">
                <NativeCheckbox name="purchaseApproverMustDiffer" defaultChecked={Boolean(d.purchaseApproverMustDiffer)}
                  label="Stock purchases: someone other than the buyer gives the final approval" />
                <p className="pl-6 text-xs text-muted-foreground">When on, the manager who bought the stock cannot approve their own purchase — another manager or the MD does.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoice “Pay into” details</CardTitle>
              <CardDescription>Printed on every invoice so companies know where to pay. Leave empty what the hotel does not use.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field name="bankName" label="Bank" d={d} errors={e} placeholder="e.g. CRDB Bank" />
              <Field name="bankAccountName" label="Account name" d={d} errors={e} placeholder="Vegas Luxury Hotel Ltd" />
              <Field name="bankAccountNumber" label="Account number" d={d} errors={e} />
              <Field name="bankBranch" label="Branch" d={d} errors={e} />
              <Field name="bankSwift" label="SWIFT code" d={d} errors={e} />
              <Field name="mobileMoneyName" label="Mobile money" d={d} errors={e} placeholder="e.g. M-Pesa Lipa Namba" />
              <Field name="mobileMoneyNumber" label="Mobile money number" d={d} errors={e} />
              <Field name="mobileMoneyAccountName" label="Mobile money name" d={d} errors={e} />
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoiceTerms">Invoice terms (bottom of the invoice)</Label>
                <textarea id="invoiceTerms" name="invoiceTerms" rows={3} defaultValue={String(d.invoiceTerms ?? "")}
                  placeholder="e.g. Payment within the agreed terms. Bank charges are paid by the customer."
                  className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Guest messages (WhatsApp / SMS)</CardTitle>
              <CardDescription>
                Every message is written by the system from the real booking, bill, payment or order — the hotel&apos;s name, the guest&apos;s name, dates, rooms,
                what was paid and what is left, and the guest&apos;s own secure link — in one Vegas style. Nothing to fill in here.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <p className="text-sm font-medium">What guests receive</p>
                <ul className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
                  <li>Booking confirmation · booking request reply · pay-at-hotel</li>
                  <li>Payment received · waiting for the PIN · did not go through</li>
                  <li>Booking changed · room changed · cancelled</li>
                  <li>Welcome at check-in (room, Wi-Fi, stay link)</li>
                  <li>Check-out bill and thank-you · balance due</li>
                  <li>Restaurant &amp; room-service orders, receipts</li>
                  <li>Transport trip details · meeting room booking</li>
                  <li>Invoices · group statements · arrival-day reminder</li>
                </ul>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <p className="text-sm font-medium">Offer to send automatically</p>
                <NativeCheckbox name="notifyBookingCreated" defaultChecked={Boolean(d.notifyBookingCreated)} label="Booking saved — open the booking details message ready to send" />
                <NativeCheckbox name="notifyCheckIn" defaultChecked={Boolean(d.notifyCheckIn)} label="Guest checked in — open the welcome message ready to send" />
                <NativeCheckbox name="notifyCheckOut" defaultChecked={Boolean(d.notifyCheckOut)} label="Guest checked out — make the thank-you note" />
                <NativeCheckbox name="notifyOrders" defaultChecked={Boolean(d.notifyOrders)} label="Restaurant orders — tell the customer when it is being prepared, ready, served or cancelled" />
                <p className="text-xs text-muted-foreground">Messages go out from reception&apos;s WhatsApp in one tap, and each one is kept on the guest&apos;s profile. Once a WhatsApp Business provider is connected they are sent by themselves — welcome, check-out, room change, cancellation and payments included — each only once, and a failed send never stops the check-in, check-out or payment.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Online ordering (menu QR &amp; website)</CardTitle>
              <CardDescription>Guests order from the room QR cards, their stay link or the website menu; orders go to reception and the kitchen screen. Prices always come from the menu.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <NativeCheckbox name="publicOrderingEnabled" defaultChecked={Boolean(d.publicOrderingEnabled)} className="sm:col-span-2"
                label="Accept orders from the menu QR codes and the website (switch off when the kitchen is closed)" />
              <Field name="orderPrepMinutes" label="Usual preparation time (minutes)" type="number" min={1} d={d} errors={e}
                hint="Shown to customers as “usually ready in about … minutes”. Leave empty to show no time." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Guest thank-you note</CardTitle>
              <CardDescription>Given to every guest at check-out (print, PDF or sent by WhatsApp / email). Leave a box empty to use the standard wording shown in grey.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="thankYouMessage">Thank-you message (a blank line starts a new paragraph)</Label>
                <Textarea id="thankYouMessage" name="thankYouMessage" rows={4} defaultValue={String(d.thankYouMessage ?? "")} placeholder={THANK_YOU_DEFAULTS.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="thankYouSignoff">Sign-off</Label>
                <Textarea id="thankYouSignoff" name="thankYouSignoff" rows={2} defaultValue={String(d.thankYouSignoff ?? "")} placeholder={THANK_YOU_DEFAULTS.signoff} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="thankYouRebookText">Book-again line</Label>
                <Textarea id="thankYouRebookText" name="thankYouRebookText" rows={2} defaultValue={String(d.thankYouRebookText ?? "")} placeholder={THANK_YOU_DEFAULTS.rebookText} />
              </div>
              <Field name="thankYouPromoTitle" label="Welcome-back heading" d={d} errors={e} placeholder={THANK_YOU_DEFAULTS.promoTitle} />
              <Field name="thankYouPromoText" label="Welcome-back text" d={d} errors={e} placeholder={THANK_YOU_DEFAULTS.promoText} />
              <Field name="instagramUrl" label="Instagram link (optional)" d={d} errors={e} placeholder="https://instagram.com/vegasluxuryhotel" />
              <Field name="facebookUrl" label="Facebook link (optional)" d={d} errors={e} placeholder="https://facebook.com/vegasluxuryhotel" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stay policies</CardTitle>
              <CardDescription>Applied automatically at checkout and late checkout — never hard-coded.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="earlyDeparturePolicy">Early departure policy</Label>
                <select id="earlyDeparturePolicy" name="earlyDeparturePolicy" defaultValue={String(d.earlyDeparturePolicy)} className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                  <option value="CHARGE_USED_NIGHTS">Charge only the nights used</option>
                  <option value="CHARGE_ONE_EXTRA_NIGHT">Charge one extra night</option>
                  <option value="CHARGE_FULL_STAY">Charge the full booked stay</option>
                </select>
              </div>
              <Field name="noShowCutoff" label="No-show cut-off" type="time" d={d} errors={e}
                hint="Guests who have not arrived (and did not say they are coming late) become NO SHOW at this time. Before the day starts (e.g. 01:00) = the night after arrival." />
              <NativeCheckbox name="noShowAutoRelease" defaultChecked={Boolean(d.noShowAutoRelease)} className="sm:col-span-2"
                label="At the cut-off, also release the room automatically (otherwise a manager presses “Release room”). Unpaid no-shows are always released." />
              <NativeCheckbox name="dateChangePayNow" defaultChecked={Boolean(d.dateChangePayNow)} className="sm:col-span-3"
                label="Date change to dearer nights on a paid booking: the extra must be paid at the change" />
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="dateChangeExcessPolicy">Date change to cheaper nights, when the guest paid more than the new price</Label>
                <select id="dateChangeExcessPolicy" name="dateChangeExcessPolicy" defaultValue={String(d.dateChangeExcessPolicy)} className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                  <option value="NO_REFUND">No refund — the price stays as paid</option>
                  <option value="CREDIT">Credit — the difference is owed back (used later, or refunded as a separate payment)</option>
                </select>
              </div>
              <Field name="unpaidHoldHours" label="Unpaid booking holds the room (hours)" type="number" min={0} d={d} errors={e}
                hint="After this, a booking with no payment is released automatically. 0 = never released automatically." />
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="noShowPolicy">Paid booking cancelled or no-show</Label>
                <select id="noShowPolicy" name="noShowPolicy" defaultValue={String(d.noShowPolicy)} className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                  <option value="RETAIN_PAYMENT">Keep the payment (non-refundable) — counted as income</option>
                  <option value="REFUND_DUE">Refund due — the money is shown as owed back to the guest</option>
                </select>
              </div>
              <Field name="lateCheckoutFee" label="Default late-checkout fee" type="number" min={0} step={1000} d={d} errors={e} />
              <Field name="roomServiceFee" label="Room-service delivery fee (per order)" type="number" min={0} step={500} d={d} errors={e} />
              <Field name="airportTransferPrice" label="Airport transfer price (blank = quote)" type="number" min={0} step={1000} d={d} errors={e} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Guest information (welcome card)</CardTitle>
              <CardDescription>Shown on the digital welcome card. Leave blank to hide a line.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field name="wifiNetwork" label="Wi-Fi network name" d={d} errors={e} />
              <Field name="wifiPassword" label="Wi-Fi password" d={d} errors={e} />
              <Field name="receptionHours" label="Reception hours" d={d} errors={e} placeholder="24 hours" />
              <Field name="breakfastHours" label="Breakfast hours" d={d} errors={e} placeholder="e.g. 06:30 – 10:30" />
              <Field name="restaurantHours" label="Restaurant hours" d={d} errors={e} />
              <Field name="barHours" label="Bar hours" d={d} errors={e} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Website booking & daily report</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <NativeCheckbox name="publicBookingEnabled" defaultChecked={Boolean(d.publicBookingEnabled)} label="Accept online bookings from the website" />
              <Field name="maxAdvanceBookingDays" label="Book up to (days ahead)" type="number" min={1} max={730} d={d} errors={e} />
              <NativeCheckbox name="reportEnabled" defaultChecked={Boolean(d.reportEnabled)} label="Send the daily boss report automatically" className="sm:col-span-2" />
              <NativeCheckbox name="shiftReportEnabled" defaultChecked={Boolean(d.shiftReportEnabled)} label="Send the Boss each shift report when a shift ends, and the weekly & monthly report (business & team) every Monday and on the 1st" className="sm:col-span-2" />
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="reportRecipients">Report recipients (WhatsApp via CallMeBot)</Label>
                <Textarea id="reportRecipients" name="reportRecipients" rows={3} defaultValue={String(d.reportRecipients)}
                  placeholder={"Boss, +255710223344"} aria-invalid={!!e?.reportRecipients} />
                <p className="text-xs text-muted-foreground">
                  One per line: <code>Name, +255…</code>. Each number needs its own CallMeBot API key, stored as a server
                  environment variable (see deployment notes).
                </p>
                <FieldError message={e?.reportRecipients} />
              </div>
            </CardContent>
          </Card>

          <div className="sticky bottom-0 flex justify-end border-t bg-background/95 py-3 backdrop-blur">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save settings
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
