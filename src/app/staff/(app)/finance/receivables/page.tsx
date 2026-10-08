import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { receivables } from "@/server/services/finance";
import { addDays } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { Panel } from "@/components/dashboard/kit";
import { FinanceTabs } from "@/components/staff/finance/finance-nav";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Who owes us") };
}

/** Accounts receivable: guests with open balances and unpaid invoices, by how late they are. */
export default async function ReceivablesPage() {
  await requirePagePermission("finance.view");
  const t = await getT();
  const today = await businessToday();
  const r = await receivables(today);
  const week = addDays(today, 7);
  const inv = r.invoices;
  const sum = (xs: { balance: number }[]) => xs.reduce((s, x) => s + x.balance, 0);
  const overdue = inv.filter((i) => i.dueDate && i.dueDate < today);
  const dueToday = inv.filter((i) => i.dueDate === today);
  const dueWeek = inv.filter((i) => i.dueDate && i.dueDate > today && i.dueDate <= week);
  const total = sum(r.guests) + sum(inv);
  const byCompany = [...inv.reduce((m, i) => {
    const e = m.get(i.customer) ?? { id: i.companyId, balance: 0, overdue: 0 };
    e.balance += i.balance; if (i.dueDate && i.dueDate < today) e.overdue += i.balance;
    return m.set(i.customer, e);
  }, new Map<string, { id: string | null; balance: number; overdue: number }>())].sort((a, b) => b[1].balance - a[1].balance);

  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/finance/receivables" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card label={t("Total outstanding")} value={total} strong />
        <Card label={t("Guests & meetings")} value={sum(r.guests)} note={t.plural(r.guests.length, "{n} booking", "{n} bookings")} />
        <Card label={t("Overdue invoices")} value={sum(overdue)} note={t.plural(overdue.length, "{n} invoice", "{n} invoices")} tone="rose" />
        <Card label={t("Due today")} value={sum(dueToday)} note={`${dueToday.length}`} tone="amber" />
        <Card label={t("Due in 7 days")} value={sum(dueWeek)} note={`${dueWeek.length}`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel title={t("Company invoices")} subtitle={t("Oldest due first. Overdue invoices are marked in red.")} action={<Link href="/staff/invoices" className="text-xs font-medium text-primary">{t("All invoices →")}</Link>}>
          {inv.length === 0 ? <p className="text-sm text-muted-foreground">{t("No unpaid invoices.")}</p> : (
            <ul className="divide-y divide-border/60">
              {inv.map((i) => {
                const days = i.dueDate ? Math.round((Date.parse(i.dueDate) - Date.parse(today)) / 86_400_000) : null;
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <Link href={`/staff/invoices/${i.id}`} className="font-medium hover:underline">{i.customer}</Link>
                      <p className="text-[11px] text-muted-foreground">{i.number} · {t("of {amount}", { amount: formatTZS(i.total) })} · {i.dueDate ? t("due {date}", { date: t.date(i.dueDate) }) : t("no due date")}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatTZS(i.balance)}</p>
                      {days !== null && (
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", days < 0 ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : days <= 7 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
                          {days < 0 ? t.plural(-days, "Overdue {n} day", "Overdue {n} days") : days === 0 ? t("Due today") : t.plural(days, "Due in {n} day", "Due in {n} days")}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title={t("By company")} subtitle={t("What each company owes in total")}>
          {byCompany.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nothing owed by companies.")}</p> : (
            <ul className="divide-y divide-border/60 text-sm">{byCompany.map(([c, v]) => (
              <li key={c} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  {v.id ? <Link href={`/staff/corporate/${v.id}`} className="font-medium hover:underline">{c}</Link> : <span className="font-medium">{c}</span>}
                  {v.overdue > 0 && <span className="block text-[11px] font-medium text-rose-600 dark:text-rose-400">{t("{amount} overdue", { amount: formatTZS(v.overdue) })}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <strong className="tabular-nums">{formatTZS(v.balance)}</strong>
                  {v.id && <Link href={`/staff/corporate/${v.id}/statement`} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium hover:bg-muted">{t("Statement")}</Link>}
                </span>
              </li>
            ))}</ul>
          )}
        </Panel>
      </div>

      <Panel title={t("Guests & meeting bookings with a balance")} subtitle={t("In the hotel or meeting room, coming, or already left without paying everything")}>
        {r.guests.length === 0 ? <p className="text-sm text-muted-foreground">{t("No guest owes anything.")}</p> : (
          <ul className="divide-y divide-border/60">
            {r.guests.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <Link href={`/staff/reservations/${g.id}`} className="font-medium hover:underline">{g.name}</Link>
                  <p className="text-[11px] text-muted-foreground">{g.reference} · {g.meeting ? t("Room {rooms} — Meeting room", { rooms: g.rooms.join(", ") }) : t("room {rooms}", { rooms: g.rooms.join(", ") || "—" })} · {g.status === "CHECKED_OUT" ? (g.meeting ? t("completed") : t("left")) : g.status === "CHECKED_IN" ? (g.meeting ? t("in use") : t("in the hotel")) : t("coming")}{g.company ? ` · ${g.company}` : ""}{g.phone ? ` · ${g.phone}` : ""}</p>
                </div>
                <div className="text-right"><p className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatTZS(g.balance)}</p><p className="text-[11px] text-muted-foreground">{t("paid {paid} of {total}", { paid: formatTZS(g.paid), total: formatTZS(g.total) })}</p></div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Card({ label, value, note, tone, strong }: { label: string; value: number; note?: string; tone?: "rose" | "amber"; strong?: boolean }) {
  return (
    <div className={cn("rounded-2xl border bg-card px-4 py-3", strong ? "border-foreground/20" : "border-border/70")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", tone === "rose" && value > 0 && "text-rose-600 dark:text-rose-400", tone === "amber" && value > 0 && "text-amber-600 dark:text-amber-400")}>{formatTZS(value)}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}
