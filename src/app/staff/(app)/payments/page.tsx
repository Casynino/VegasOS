import type { Metadata } from "next";
import { billMenu } from "@/server/services/restaurant";
import Link from "next/link";
import { BedDouble, Building2, Car, Coins, Presentation, Search, UtensilsCrossed, Wallet, Wine, type LucideIcon } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { incomeRows, payingParties, SOURCE_LABEL, type IncomeRow, type IncomeSource } from "@/server/services/income";
import { recentChargeItems } from "@/server/services/payments";
import { inHouseBalances } from "@/server/services/guest-balances";
import { addDays, toDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { FinanceTabs, PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { AutoSelect } from "@/components/staff/finance/auto-select";
import { CancelButton, PaymentEditButton, SaleEditButton, type PaymentAccountOption } from "@/components/staff/finance/fix-buttons";
import { PageHeader } from "@/components/staff/page-header";
import { cn } from "@/lib/utils";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";
import { RecordIncome } from "./record-income";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Income") };
}

const SOURCE_LOOK: Record<IncomeSource, { icon: LucideIcon; tone: string }> = {
  ROOM: { icon: BedDouble, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-300" },
  RESTAURANT: { icon: UtensilsCrossed, tone: "bg-orange-500/12 text-orange-600 dark:text-orange-300" },
  BAR: { icon: Wine, tone: "bg-rose-500/12 text-rose-600 dark:text-rose-300" },
  ROOM_SERVICE: { icon: BedDouble, tone: "bg-amber-500/12 text-amber-600 dark:text-amber-300" },
  TRANSPORT: { icon: Car, tone: "bg-teal-500/12 text-teal-600 dark:text-teal-300" },
  MEETING: { icon: Presentation, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-300" },
  COMPANY: { icon: Building2, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" },
  OTHER: { icon: Coins, tone: "bg-muted text-muted-foreground" },
};
const n = (v: number) => v.toLocaleString("en-US");
/** A line's note as the income service says it ("Refund", "Reversed: …", "Cancelled: …") — the reason as it was typed. */
const noteText = (t: T, note: string | null) => {
  if (!note) return note;
  const m = note.match(/^(Reversed|Cancelled|Refund)(: [\s\S]*)?$/);
  return m ? `${t(m[1])}${m[2] ?? ""}` : note;
};

/**
 * Income — all money received, from every source (rooms, restaurant, bar, meeting
 * room, companies), with the account it landed in. Any line can be corrected to the
 * right account (the amount is locked). Beside it: guests who still have to pay.
 */
export default async function IncomePage({ searchParams }: PageProps<"/staff/payments">) {
  // Managers and the MD (reception sees its own money in Collections).
  const user = await requirePagePermission("reports.view", "finance.view");
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const [today, t] = await Promise.all([businessToday(), getT()]);
  const p = readPeriod(sp, today);
  const source = str(sp.source) as IncomeSource | "";
  const accountId = str(sp.account);
  const q = str(sp.q).trim().toLowerCase();

  const [all, balances, arriving, accounts, parties, recent] = await Promise.all([
    incomeRows(p.from, p.to),
    inHouseBalances(today),
    db.reservation.findMany({
      where: { status: { in: ["RESERVED", "CONFIRMED", "INQUIRY"] }, arrivalDate: { gte: toDbDate(today), lte: toDbDate(addDays(today, 1)) }, balanceAmount: { gt: 0 } },
      include: { guest: { select: { fullName: true } }, rooms: { select: { room: { select: { number: true } } } } }, orderBy: { arrivalDate: "asc" },
    }),
    db.moneyAccount.findMany({ orderBy: { sortOrder: "asc" } }),
    payingParties(today),
    recentChargeItems(),
  ]);
  // The menu, so food & drinks can be picked onto a staying guest's bill ("Add to bill").
  const menu = can(user, "restaurant.orders") && can(user, "reservations.edit") && can(user, "payments.record") ? await billMenu() : null;
  const rows = all.filter((r) =>
    (!source || r.source === source)
    && (!accountId || r.account.id === accountId)
    && (!q || [r.who, r.detail, r.rooms, r.reference, r.account.name, r.by].some((v) => v?.toLowerCase().includes(q))));

  const counted = all.filter((r) => r.counted);
  const total = counted.reduce((s, r) => s + r.amount, 0);
  const bySource = (s: IncomeSource) => counted.filter((r) => r.source === s).reduce((t, r) => t + r.amount, 0);
  const tiles = (["ROOM", "RESTAURANT", "BAR", "MEETING", "COMPANY"] as const).map((s) => ({ source: s, label: s === "COMPANY" ? msg("Companies") : SOURCE_LABEL[s], value: bySource(s), ...SOURCE_LOOK[s] }));
  const byAccount = accounts.map((a) => ({ ...a, amount: counted.filter((r) => r.account.id === a.id).reduce((s, r) => s + r.amount, 0) })).filter((a) => a.amount !== 0);

  // Days, newest first, each with its total.
  const days: { date: string; total: number; rows: IncomeRow[] }[] = [];
  for (const r of rows) {
    let d = days.at(-1);
    if (d?.date !== r.businessDate) { d = { date: r.businessDate, total: 0, rows: [] }; days.push(d); }
    d.rows.push(r);
    if (r.counted) d.total += r.amount;
  }
  const dayLabel = (d: string) => (d === today ? t("Today") : d === addDays(today, -1) ? t("Yesterday") : t.date(d));

  // To collect: in-house guests who owe (overdue / leaving today first), then arrivals not paid yet.
  const owing = [...balances.owing].sort((a, b) => a.departure.localeCompare(b.departure) || b.outstanding - a.outstanding);
  const toCollect = owing.reduce((s, x) => s + x.outstanding, 0) + arriving.reduce((s, r) => s + r.balanceAmount, 0);

  const perms = { correct: can(user, "payments.record"), reverse: can(user, "payments.reverse"), sale: can(user, "revenue.record"), voidSale: can(user, "revenue.void") };
  const receiving: PaymentAccountOption[] = accounts.filter((a) => a.isActive && a.acceptsPayments).map((a) => ({ id: a.id, name: a.name, number: a.accountNumber, holder: a.holderName }));
  const payAccounts = receiving.map((a) => ({ id: a.id, name: a.name, number: a.number, holder: a.holder }));
  const recorder = (start?: string) => perms.correct
    ? <RecordIncome parties={parties} accounts={payAccounts} recent={recent} menu={menu} menuPayNow={can(user, "revenue.record")} canType={can(user, "payments.record")} canCharge={can(user, "reservations.edit")} start={start} compact={!!start} />
    : null;
  const paymentFix = new Map((await db.payment.findMany({
    where: { id: { in: rows.filter((r) => r.kind === "payment" && r.counted).map((r) => r.id) } },
    include: { method: true, recordedBy: { select: { fullName: true } }, reservation: { select: { reference: true } }, invoice: { select: { number: true } } },
  })).map((x) => [x.id, x]));
  const keep: Record<string, string> = Object.fromEntries(Object.entries({ source, account: accountId, q: str(sp.q), ...(p.key === "custom" ? { from: p.from, to: p.to } : { period: p.key }) }).filter(([, v]) => v));
  const link = (extra: Record<string, string>) => `?${new URLSearchParams(Object.fromEntries(Object.entries({ ...keep, ...extra }).filter(([, v]) => v)))}`;

  function fix(r: IncomeRow) {
    if (!r.counted) return null;
    if (r.kind === "sale") {
      return (
        <>
          {perms.sale && <SaleEditButton sale={{ id: r.id, amount: r.amount, accountId: r.account.id, what: r.who, soldOn: t.date(r.businessDate), recordedBy: r.by }} accounts={receiving} />}
          {perms.voidSale && <CancelButton kind="sale" id={r.id} label="this sale" />}
        </>
      );
    }
    const x = paymentFix.get(r.id);
    if (!x) return null;
    return (
      <>
        {perms.correct && <PaymentEditButton accounts={receiving} canReference={perms.reverse} payment={{
          id: x.id, reservationId: x.reservationId, amount: x.amount, refund: x.kind === "REFUND", accountId: x.accountId, method: x.method.name, reference: x.reference ?? "",
          who: r.who, booking: x.reservation?.reference ?? null, invoice: x.invoice?.number ?? null, paidOn: t.date(r.businessDate), recordedBy: x.recordedBy.fullName,
        }} />}
        {perms.reverse && x.reservationId && <CancelButton kind="payment" id={x.id} reservationId={x.reservationId} label="this payment" />}
      </>
    );
  }

  return (
    <div className="w-full space-y-5">
      {/* The finance bar is this page's title; staff without finance see the heading instead */}
      {can(user, "finance.view") || can(user, "ledger.view")
        ? <FinanceTabs active="/staff/payments" limited={!can(user, "finance.view")} actions={recorder()} />
        : <PageHeader title={t("Income")} description={t("Every shilling received — rooms, restaurant, bar, meeting room and companies — and the account it landed in.")} actions={recorder()} />}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{periodLabel(p, t)}</h2>
        <PeriodPicker current={p.key} from={p.from} to={p.to} keep={Object.fromEntries(Object.entries(keep).filter(([k]) => !["period", "from", "to"].includes(k)))} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="relative overflow-hidden rounded-3xl border border-[oklch(0.75_0.13_80)]/40 bg-linear-to-br from-[oklch(0.75_0.13_80)]/[0.14] to-card p-5 col-span-2 flex flex-wrap items-end justify-between gap-4 sm:col-span-3 lg:col-span-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("Income received")}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{formatTZS(total)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.plural(counted.length, "{n} transaction · refunds deducted", "{n} transactions · refunds deducted")}</p>
          </div>
          {byAccount.length > 0 && (
            <div className="flex max-w-2xl flex-wrap justify-end gap-1.5">
              {byAccount.map((a) => (
                <Link key={a.id} href={link({ account: accountId === a.id ? "" : a.id })} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition", accountId === a.id ? "border-foreground bg-foreground text-background" : "border-border/80 bg-background/50 hover:bg-muted")}>
                  {t(a.name)} · {n(a.amount)}
                </Link>
              ))}
            </div>
          )}
        </div>
        {tiles.map((tile) => (
          <Link key={tile.source} href={link({ source: source === tile.source ? "" : tile.source })}
            className={cn("rounded-3xl border bg-card p-4 transition hover:-translate-y-0.5 hover:border-foreground/25", source === tile.source ? "border-foreground/40 ring-1 ring-foreground/20" : "border-border/70")}>
            <span className={cn("grid size-9 place-items-center rounded-xl", tile.tone)}><tile.icon className="size-4" /></span>
            <p className="mt-3 text-xs text-muted-foreground">{t(tile.label)}</p>
            <p className="mt-0.5 whitespace-nowrap text-base font-semibold tabular-nums">{formatTZS(tile.value)}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <form className="flex flex-wrap gap-2 rounded-3xl border border-border/70 bg-card p-3">
            {Object.entries(keep).filter(([k]) => ["period", "from", "to"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input name="q" defaultValue={str(sp.q)} placeholder={t("Guest, company, room, booking, reference…")} className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm" />
            </div>
            <AutoSelect name="source" value={source} label={t("Source")} options={[{ value: "", label: t("Every source") }, ...(Object.keys(SOURCE_LABEL) as IncomeSource[]).map((k) => ({ value: k, label: t(SOURCE_LABEL[k]) }))]} />
            <AutoSelect name="account" value={accountId} label={t("Received through")} options={[{ value: "", label: t("Every account") }, ...accounts.map((a) => ({ value: a.id, label: t(a.name) }))]} />
          </form>

          {rows.length === 0 ? <p className="rounded-3xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">{t("No income recorded for these filters.")}</p> : days.map((d) => (
            <section key={d.date} className="overflow-hidden rounded-3xl border border-border/70 bg-card">
              <header className="flex items-baseline justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5">
                <p className="text-sm font-semibold">{dayLabel(d.date)}<span className="ml-2 text-xs font-normal text-muted-foreground">{t.plural(d.rows.length, "{n} line", "{n} lines")}</span></p>
                <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatTZS(d.total)}</p>
              </header>
              <ul className="divide-y divide-border/50">
                {d.rows.map((r) => {
                  const look = SOURCE_LOOK[r.source];
                  return (
                    <li key={r.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition hover:bg-muted/30", !r.counted && "opacity-60")}>
                      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", look.tone)}><look.icon className="size-[18px]" /></span>
                      <div className="min-w-0 flex-1 leading-tight">
                        <p className={cn("truncate font-semibold", !r.counted && "line-through")}>
                          {(() => { const who = r.kind === "sale" && r.who === r.detail ? t(r.who) : r.who; return r.href ? <Link href={r.href} className="hover:underline">{who}</Link> : who; })()}
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 align-middle text-[10px] font-medium text-muted-foreground">{r.refund ? t("Refund") : t(SOURCE_LABEL[r.source])}</span>
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {[t.time(r.at), r.rooms && t("Room {number}", { number: r.rooms }), r.kind === "sale" && r.detail ? t(r.detail) : r.detail, r.reference, t("by {name}", { name: r.by }), noteText(t, r.note)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="hidden w-44 shrink-0 leading-tight md:block">
                        <p className="truncate text-sm font-medium">{t(r.account.name)}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">{r.account.number ?? t(r.method)}</p>
                      </div>
                      <span className={cn("shrink-0 text-right text-[15px] font-semibold tabular-nums sm:order-last sm:min-w-28", !r.counted ? "line-through" : r.amount < 0 ? "text-rose-600 dark:text-rose-400" : "")}>{r.amount < 0 ? "−" : ""}{formatTZS(Math.abs(r.amount))}</span>
                      <div className="flex w-full flex-wrap items-center gap-1.5 pl-[52px] empty:hidden sm:w-auto sm:pl-0">{fix(r)}</div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <aside className="space-y-4 2xl:sticky 2xl:top-24">
          <section className="overflow-hidden rounded-3xl border border-amber-500/30 bg-card">
            <div className="bg-linear-to-br from-amber-500/[0.12] to-transparent p-4">
              <p className="flex items-center gap-2 font-semibold"><Wallet className="size-4 text-amber-600" />{t("To collect")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{formatTZS(toCollect)}</p>
              <p className="text-xs text-muted-foreground">{t("Guests in the hotel who still owe, and arrivals not paid yet. It becomes income only when paid.")}</p>
            </div>
            {owing.length === 0 && arriving.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("Everyone has paid.")}</p> : (
              <>
              {/* Most urgent first; beyond 6 guests the rest fold away behind "Show all". */}
              <input id="collect-all" type="checkbox" className="peer sr-only" />
              <ul className="divide-y divide-border/60 [&>li:nth-child(n+7)]:hidden peer-checked:[&>li]:flex">
                {owing.map((g) => {
                  const overdue = g.departure < today;
                  const leaving = g.departure === today;
                  return (
                    <li key={g.reservationId} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 leading-tight">
                        <p className="truncate text-sm font-semibold">{g.guest}</p>
                        <p className="truncate text-xs text-muted-foreground">{t("Room {number}", { number: g.rooms.join(", ") })} · {overdue ? <span className="font-semibold text-rose-600">{t("overdue")}</span> : leaving ? <span className="font-semibold text-amber-600">{t("leaving today")}</span> : t("leaves {date}", { date: t.date(g.departure) })}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">{formatTZS(g.outstanding)}</p>
                        {recorder(`r-${g.reservationId}`) ?? <Link href={`/staff/check-out?id=${g.reservationId}`} className="text-[11px] font-semibold text-[oklch(0.55_0.11_76)] hover:underline dark:text-[#f0cf86]">{t("Open →")}</Link>}
                      </div>
                    </li>
                  );
                })}
                {arriving.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-sm font-semibold">{r.guest.fullName}</p>
                      <p className="truncate text-xs text-muted-foreground">{t("Room {number}", { number: r.rooms.map((x) => x.room.number).join(", ") })} · {r.arrivalDate.toISOString().slice(0, 10) === today ? t("arriving today") : t("arriving tomorrow")} · {r.status === "INQUIRY" ? t("not paid · room not held") : t("not paid")}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">{formatTZS(r.balanceAmount)}</p>
                      {recorder(`r-${r.id}`) ?? <Link href={`/staff/reservations/${r.id}`} className="text-[11px] font-semibold text-[oklch(0.55_0.11_76)] hover:underline dark:text-[#f0cf86]">{t("Open booking →")}</Link>}
                    </div>
                  </li>
                ))}
              </ul>
              {owing.length + arriving.length > 6 && (
                <label htmlFor="collect-all" className="block cursor-pointer border-t border-border/60 px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground hover:text-foreground">
                  <span className="[.peer:checked~label_&]:hidden">{t("Show all {n}", { n: owing.length + arriving.length })}</span>
                  <span className="hidden [.peer:checked~label_&]:inline">{t("Show fewer")}</span>
                </label>
              )}
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
