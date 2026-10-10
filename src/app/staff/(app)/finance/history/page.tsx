import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import Link from "next/link";
import { ArrowRight, History, Search } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { financeHistory, HISTORY_GROUPS, type HistoryGroup } from "@/server/services/finance-history";
import { Initials } from "@/components/dashboard/kit";
import { FinanceTabs, PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { AutoSelect } from "@/components/staff/finance/auto-select";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Edit history") };
}

/** The record's plain name when it has no number or name of its own (shown in the reader's language). */
const RECORD_WORDS = new Set(["Booking", "Expense", "Payment", "Invoice", "Company", "Stock request", "Cash count", "Money movement"]);

const TONE: Record<HistoryGroup, string> = {
  expenses: "bg-rose-500/12 text-rose-700 dark:text-rose-300", payments: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  prices: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", bookings: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  invoices: "bg-violet-500/12 text-violet-700 dark:text-violet-300", cash: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300",
};

/** Who changed what: old value → new value, when and why. Nothing financial changes silently. */
export default async function EditHistoryPage({ searchParams }: PageProps<"/staff/finance/history">) {
  await requirePagePermission("finance.view");
  const t = await getT();
  const rec = (r: string) => (RECORD_WORDS.has(r) ? t(r) : r);
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const today = await businessToday();
  const p = readPeriod(sp, today, "week");
  const group = (str(sp.group) in HISTORY_GROUPS ? str(sp.group) : "") as HistoryGroup | "";
  const userId = str(sp.user) || null;
  const q = str(sp.q).trim();
  const [items, users] = await Promise.all([
    financeHistory({ from: p.from, to: p.to, group: group || null, userId, q }),
    db.user.findMany({ where: { role: { code: { not: "DRIVER" } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  const keep = Object.fromEntries(Object.entries({ group, user: userId ?? "", q, ...(p.key === "custom" ? { from: p.from, to: p.to } : { period: p.key }) }).filter(([, v]) => v));

  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/finance/history" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{periodLabel(p, t)} · {t.plural(items.length, "{n} change", "{n} changes")}</h2>
        <PeriodPicker current={p.key} from={p.from} to={p.to} keep={Object.fromEntries(Object.entries(keep).filter(([k]) => !["period", "from", "to"].includes(k)))} />
      </div>
      <form className="flex flex-wrap gap-2 rounded-3xl border border-border/70 bg-card p-3">
        {Object.entries(keep).filter(([k]) => ["period", "from", "to"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={q} placeholder={t("Name, expense number, booking, amount…")} className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm" />
        </div>
        <AutoSelect name="group" value={group} label={t("What")} options={[{ value: "", label: t("Everything") }, ...Object.entries(HISTORY_GROUPS).map(([value, label]) => ({ value, label: t(label) }))]} />
        <AutoSelect name="user" value={userId ?? ""} label={t("Who")} options={[{ value: "", label: t("Anyone") }, ...users.map((u) => ({ value: u.id, label: u.fullName }))]} />
      </form>

      {items.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"><History className="mx-auto mb-2 size-5" />{t("No changes in this period.")}</p>
      ) : (
        <ol className="space-y-2.5">
          {items.map((i) => (
            <li key={i.id} className="rounded-2xl border border-border/70 bg-card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <Initials name={i.who} className="size-9 text-xs" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm"><strong>{i.who === "System" ? t("System") : i.who}</strong> {t(i.label)}
                    {i.href ? <> · <Link href={i.href} className="font-medium underline-offset-2 hover:underline">{rec(i.record)}</Link></> : <> · <span className="font-medium">{rec(i.record)}</span></>}
                  </p>
                  <p className="text-xs text-muted-foreground">{t.dateTime(i.at)}</p>
                </div>
                <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", TONE[i.group])}>{t(HISTORY_GROUPS[i.group])}</span>
              </div>
              {i.changes.length > 0 && (
                <dl className="mt-3 grid gap-1.5 rounded-xl bg-muted/40 p-3 text-xs sm:grid-cols-2">
                  {i.changes.map((c) => (
                    <div key={c.field} className="flex flex-wrap items-center gap-1.5">
                      <dt className="min-w-24 text-muted-foreground">{t(c.field)}</dt>
                      <dd className="flex flex-wrap items-center gap-1.5">
                        {c.from && <span className="rounded bg-rose-500/10 px-1.5 py-px tabular-nums text-rose-700 line-through decoration-rose-400/60 dark:text-rose-300">{c.from}</span>}
                        {c.from && c.to && <ArrowRight className="size-3 text-muted-foreground" />}
                        {c.to && <span className="rounded bg-emerald-500/10 px-1.5 py-px font-medium tabular-nums text-emerald-700 dark:text-emerald-300">{c.to}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {i.reason && <p className="mt-2 text-xs"><span className="text-muted-foreground">{t("Reason:")}</span> <span className="font-medium">{i.reason}</span></p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
