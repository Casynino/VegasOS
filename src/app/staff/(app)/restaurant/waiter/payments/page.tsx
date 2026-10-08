import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/server/auth";
import { isRestaurantDevice, worksWaiterShift } from "@/lib/permissions";
import { MyCollections } from "../my-record";
import { ShiftPicker } from "@/components/staff/shift-picker";
import { myRecord } from "../record-data";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Collections") };
}
export const dynamic = "force-dynamic";

/** MY PAYMENTS — how the orders a waiter handled are paid, as the Counter recorded it (information only). */
export default async function MyPaymentsPage({ searchParams }: PageProps<"/staff/restaurant/waiter/payments">) {
  const user = await requirePagePermission("restaurant.shift");
  if (!worksWaiterShift(user.permissions) || isRestaurantDevice(user.permissions)) redirect("/staff/restaurant");
  const t = await getT();
  const sp = await searchParams;
  // One shift at a time — this one, or one before it (their own); weeks and months are for managers.
  const { activity, shift, shifts, timezone } = await myRecord(user.id, typeof sp.shift === "string" ? sp.shift : null);
  const s = activity.summary;
  // Their orders this shift in a few numbers (the full history is for managers, on the Waiters page).
  const counts = [
    { label: t("Accepted"), value: activity.history.filter((x) => x.text.startsWith("Accepted")).length, dot: "bg-sky-400" },
    { label: t("Claimed"), value: s.claimed, dot: "bg-amber-400" },
    { label: t("Served"), value: s.served, dot: "bg-emerald-400" },
    { label: t("With you"), value: s.pending, dot: "bg-violet-400" },
  ];
  return (
    <div className="w-full space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-1">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Collections")}</h1>
          <p className="text-sm text-muted-foreground">{!shift ? t("Today") : shift.open ? t("This shift — since {time}", { time: shift.since }) : t("Shift {from} → {to}", { from: shift.since, to: shift.until })}</p>
        </div>
        <p className="text-xs text-muted-foreground">{t("The Counter records every payment.")}</p>
      </header>
      <ShiftPicker shifts={shifts} current={shift?.id ?? null} timezone={timezone} href={(id) => `?shift=${id}`} />
      <ul aria-label={t("Your orders")} className="grid grid-cols-4 divide-x divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card">
        {counts.map((c) => (
          <li key={c.label} className="min-w-0 px-2 py-2.5 text-center sm:px-4 sm:py-3 sm:text-left">
            <p className="text-xl font-semibold tabular-nums sm:text-2xl">{c.value}</p>
            <p className="flex items-center justify-center gap-1.5 truncate text-[11px] text-muted-foreground sm:justify-start"><span className={`size-1.5 shrink-0 rounded-full ${c.dot}`} />{c.label}</p>
          </li>
        ))}
      </ul>
      <MyCollections rows={activity.orders} s={s} />
    </div>
  );
}
