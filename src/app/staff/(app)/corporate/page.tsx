import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Phone } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { companyAccount } from "@/server/services/company-billing";
import { formatTZS } from "@/lib/format";
import { termsLabel } from "@/lib/billing";
import { FinanceTabs } from "@/components/staff/finance/finance-nav";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { cn } from "@/lib/utils";
import { NewCorporateDialog } from "./new-corporate-dialog";
import { ACCOUNT_WORD } from "@/lib/group-types";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Companies") };
}

export default async function CorporatePage() {
  const user = await requirePagePermission("corporate.view");
  const today = await businessToday();
  const t = await getT();
  const companies = await db.corporateCustomer.findMany({ orderBy: [{ status: "asc" }, { companyName: "asc" }] });
  const rows = await Promise.all(companies.map(async (c) => ({ c, a: (await companyAccount(c.id, today))! })));
  const owed = rows.reduce((s, r) => s + r.a.balance, 0);
  const overdue = rows.reduce((s, r) => s + r.a.overdueAmount, 0);
  const pending = rows.reduce((s, r) => s + r.a.unbilled + r.a.draftTotal, 0);

  return (
    <div className="w-full space-y-5">
      {/* The finance bar is this page's title; staff without finance see the heading instead */}
      {can(user, "finance.view") || can(user, "ledger.view")
        ? <FinanceTabs active="/staff/corporate" limited={!can(user, "finance.view")} actions={(can(user, "corporate.manage") || can(user, "reservations.create")) && <NewCorporateDialog />} />
        : <PageHeader title={t("Companies")} description={t("Companies that send guests and pay by invoice — what each one owes, what is overdue and how much credit is left.")} actions={(can(user, "corporate.manage") || can(user, "reservations.create")) && <NewCorporateDialog />} />}
      {companies.length === 0 ? (
        <EmptyState icon={<Building2 />} title={t("No companies yet")} description={t("Add a company to book its staff on account, send one invoice, and track what it owes.")} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile label={t("Companies owe")} value={formatTZS(owed)} note={t("{n} with unpaid invoices", { n: rows.filter((r) => r.a.balance > 0).length })} dark />
            <Tile label={t("Overdue")} value={formatTZS(overdue)} note={t("{n} companies late", { n: rows.filter((r) => r.a.overdueAmount > 0).length })} warn={overdue > 0} />
            <Tile label={t("Not invoiced yet")} value={formatTZS(pending)} note={t("Stays in progress and draft invoices")} />
          </div>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {rows.map(({ c, a }) => {
              const used = c.creditLimit ? Math.min(100, Math.round((a.committed / c.creditLimit) * 100)) : null;
              return (
                <Link key={c.id} href={`/staff/corporate/${c.id}`}
                  className={cn("group rounded-3xl border border-border/70 bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-22px_rgba(15,23,42,0.5)]", c.status !== "ACTIVE" && "opacity-70")}>
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#15110c] font-display text-lg font-semibold text-[#f0cf86]">{c.companyName.trim()[0]?.toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate font-semibold">{c.companyName}{c.kind !== "COMPANY" && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{t(ACCOUNT_WORD[c.kind].title)}</span>}</p>
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">{c.contactPerson ?? t("No contact")}{c.phone && <><Phone className="ml-1 size-3" />{c.phone}</>}</p>
                    </div>
                    {c.status !== "ACTIVE" && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300">{c.status === "ON_HOLD" ? t("Suspended") : t("Inactive")}</span>}
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] text-muted-foreground">{t("Owes")}</p>
                      <p className={cn("text-2xl font-semibold tabular-nums", a.balance > 0 ? "" : "text-muted-foreground")}>{formatTZS(a.balance)}</p>
                    </div>
                    <div className="text-right text-[11px]">
                      {a.overdueAmount > 0 ? <p className="font-semibold text-rose-600 dark:text-rose-400">{t("{amount} overdue", { amount: formatTZS(a.overdueAmount) })}</p> : <p className="text-emerald-600 dark:text-emerald-400">{t("Nothing overdue")}</p>}
                      <p className="text-muted-foreground">{termsLabel(c.paymentTermDays, t)} · {t.plural(a.reservations, "{n} stay", "{n} stays")}</p>
                    </div>
                  </div>
                  {used != null && (
                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", used >= 90 ? "bg-rose-500" : used >= 70 ? "bg-amber-400" : "bg-[oklch(0.75_0.13_80)]")} style={{ width: `${used}%` }} /></div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{t("{amount} credit left of {limit}", { amount: formatTZS(Math.max(0, a.available ?? 0)), limit: formatTZS(c.creditLimit!) })}</p>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note, dark, warn }: { label: string; value: string; note: string; dark?: boolean; warn?: boolean }) {
  return (
    <div className={cn("rounded-3xl border px-5 py-4", dark ? "border-transparent bg-[#15110c] text-white" : "border-border/70 bg-card")}>
      <p className={cn("text-xs", dark ? "text-white/55" : "text-muted-foreground")}>{label}</p>
      <p className={cn("mt-0.5 text-2xl font-semibold tabular-nums", dark && "text-[#f0cf86]", warn && "text-rose-600 dark:text-rose-400")}>{value}</p>
      <p className={cn("text-[11px]", dark ? "text-white/45" : "text-muted-foreground")}>{note}</p>
    </div>
  );
}
