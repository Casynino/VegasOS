import type { Metadata } from "next";
import { Beer, UtensilsCrossed, Coins } from "lucide-react";
import { can, getMyOpenShift, requirePagePermission } from "@/server/auth";
import { isRestaurantDevice } from "@/lib/permissions";
import { db } from "@/server/db";
import { accountOptions } from "@/server/services/payment-accounts";
import { businessToday } from "@/server/settings";
import { isBusinessDate, toDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatDateTime, formatTZS } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { StatCard } from "@/components/staff/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SaleForm, VoidSaleButton } from "./sale-form";

export const metadata: Metadata = { title: "Restaurant & bar" };

export default async function SalesPage({ searchParams }: PageProps<"/staff/sales">) {
  const user = await requirePagePermission("revenue.record", "reports.view");
  const sp = await searchParams;
  const today = await businessToday();
  // Managers, the MD and the owner see any day and everyone's sales. The Counter: today's food and drink only.
  // Reception: only what they recorded in their own shift (owner, 2026-10-04: staff see one shift at a time).
  const supervisor = can(user, "reports.view") || can(user, "finance.view") || can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin");
  const device = !supervisor && isRestaurantDevice(user.permissions);
  const shift = !supervisor && !device ? await getMyOpenShift(user.id) : null;
  const date = supervisor && isBusinessDate(sp.date) ? String(sp.date) : today;
  const where = supervisor ? { businessDate: toDbDate(date) }
    : device ? { businessDate: toDbDate(today), kind: { in: ["RESTAURANT" as const, "BAR" as const, "ROOM_SERVICE" as const] } }
    : { recordedById: user.id, occurredAt: { gte: shift?.startedAt ?? new Date() } };
  const [sales, categories, methods] = await Promise.all([
    db.revenueTransaction.findMany({ where, orderBy: { occurredAt: "desc" }, include: { category: true, paymentMethod: true, account: true, recordedBy: { select: { fullName: true } } } }),
    db.revenueCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    accountOptions("payments"),
  ]);
  const inHouse = await db.reservation.findMany({
    where: { rooms: { some: { status: "CHECKED_IN" } } },
    select: { id: true, guest: { select: { fullName: true } }, rooms: { where: { status: "CHECKED_IN" }, select: { room: { select: { number: true } } } } },
  });
  const rooms = inHouse.map((r) => ({ id: r.id, label: `Room ${r.rooms.map((x) => x.room.number).join(", ")} · ${r.guest.fullName}` }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const live = sales.filter((s) => !s.isVoided);
  const sum = (k: string) => live.filter((s) => s.kind === k).reduce((n, s) => n + s.amount, 0);

  return (
    <div className="w-full space-y-4">
      <PageHeader title="Restaurant, bar & other sales" description="Separate from room revenue. Each sale is dated by the 04:00 hotel day and recorded with your name." />
      {supervisor && (
        <form className="flex items-center gap-2">
          <Input type="date" name="date" defaultValue={date} className="w-44" aria-label="Hotel day" />
          <Button type="submit" variant="outline">Show day</Button>
        </form>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard variant="feature" label="Restaurant" value={formatTZS(sum("RESTAURANT"))} icon={<UtensilsCrossed />} sub={formatBusinessDate(date)} />
        <StatCard variant="feature" label="Bar" value={formatTZS(sum("BAR"))} icon={<Beer />} sub={formatBusinessDate(date)} />
        <StatCard label="Other sales" value={formatTZS(sum("OTHER"))} icon={<Coins />} tone="gold" sub={formatBusinessDate(date)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {can(user, "revenue.record") && (
          <Card className="self-start">
            <CardHeader><CardTitle>Record a sale</CardTitle></CardHeader>
            <CardContent><SaleForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} methods={methods} rooms={rooms} /></CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>{supervisor || device ? `Sales on ${formatBusinessDate(date)}` : "Sales you recorded this shift"}</CardTitle></CardHeader>
          <CardContent>
            {sales.length === 0 ? <EmptyState compact title="No sales recorded for this day" description="Record restaurant and bar takings as they happen or at the end of each service." /> : (
              <ul className="divide-y text-sm">
                {sales.map((s) => (
                  <li key={s.id} className={`flex items-center justify-between gap-2 py-2 ${s.isVoided ? "opacity-50" : ""}`}>
                    <div className="min-w-0">
                      <p className={`font-medium ${s.isVoided ? "line-through" : ""}`}>{s.category.name}{s.description && ` · ${s.description}`}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(s.occurredAt)} · → {s.account.name}{supervisor || device ? ` · ${s.recordedBy.fullName}` : ""}{s.isVoided && ` · voided: ${s.voidReason}`}</p>
                    </div>
                    <span className="flex items-center gap-1 tabular-nums">{formatTZS(s.amount)}{can(user, "revenue.void") && !s.isVoided && <VoidSaleButton id={s.id} />}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
