import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Info, Paperclip } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { accountBalances, MOVEMENT_LABELS } from "@/server/services/finance";
import { accountSummaries, KIND_LABEL } from "@/server/services/payment-accounts";
import { formatTZS } from "@/lib/format";
import { getT } from "@/i18n/server";
import { accountLook, ago, spacedNumber } from "@/lib/account-look";
import { Panel } from "@/components/dashboard/kit";
import { FinanceTabs, PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { cn } from "@/lib/utils";
import { MovementButton, PaymentAccountButton, ReverseButton, SettleCountButtons } from "./account-dialogs";

const n = (v: number) => v.toLocaleString("en-US");

/**
 * Payment accounts: where the hotel's money is received and paid from (Cash, LIPA,
 * Lipa M-Pesa, CRDB, NMB …). Each card shows what the hotel's books say the account
 * holds — worked out from recorded payments, sales, expenses and movements, never
 * typed in — and what moved through it in the chosen period. Open a card to see
 * and fix its transactions.
 */
export async function AccountsBoard({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const user = await requirePagePermission("ledger.view", "finance.view");
  const t = await getT();
  const canManage = can(user, "finance.manage");
  const canAdmin = can(user, "settings.manage");
  const limited = !can(user, "finance.view");
  const today = await businessToday();
  const p = readPeriod(sp, today, "month");
  const [accounts, books, movements, counts] = await Promise.all([
    accountSummaries(p.from, p.to),
    accountBalances(today, true),
    db.ledgerEntry.findMany({ orderBy: { occurredAt: "desc" }, take: 30, include: { account: true, toAccount: true, createdBy: { select: { fullName: true } }, reversedBy: { select: { fullName: true } } } }),
    db.cashCount.findMany({ orderBy: [{ status: "asc" }, { countedAt: "desc" }], take: 20, include: { account: true, countedBy: { select: { fullName: true } }, reviewedBy: { select: { fullName: true } } } }),
  ]);
  const held = new Map(books.map((b) => [b.id, b.balance]));
  const shown = [...accounts.filter((a) => a.isActive), ...accounts.filter((a) => !a.isActive && (held.get(a.id) || a.count > 0))];
  const total = shown.reduce((s, a) => s + (held.get(a.id) ?? 0), 0);
  const moved = shown.filter((a) => a.count > 0).length;
  const movementsCount = shown.reduce((s, a) => s + a.count, 0);
  const keep: Record<string, string> = p.key === "custom" ? { from: p.from, to: p.to } : { period: p.key };
  const q = new URLSearchParams(keep).toString();

  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/finance/accounts" limited={limited}
        actions={(canAdmin || canManage) ? <div className="flex gap-2">{canManage && <MovementButton accounts={books.filter((a) => shown.some((x) => x.id === a.id && x.isActive)).map((a) => ({ id: a.id, name: a.name, balance: a.balance }))} />}{canAdmin && <PaymentAccountButton />}</div> : undefined} />

      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(0.75_0.13_80/0.14),transparent_60%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("Across every account · in the books")}</p>
            <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl"><span className="mr-1 text-lg font-medium text-muted-foreground">TZS</span>{n(total)}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Info className="size-3.5" />{t("What the hotel's records add up to — check against the bank statement; it is not read from the bank.")}</p>
          </div>
          <dl className="flex gap-8 text-sm">
            <div><dt className="text-xs text-muted-foreground">{t("Accounts in use")}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{shown.filter((a) => a.isActive).length}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("With movement")}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{moved}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("Movements")}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{movementsCount}</dd></div>
          </dl>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker current={p.key} from={p.from} to={p.to} />
        <p className="text-xs text-muted-foreground">{t("In / out and movements on the cards: {period}", { period: periodLabel(p, t) })}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((a) => {
          const look = accountLook(a.kind);
          const bal = held.get(a.id) ?? 0;
          return (
            <Link key={a.id} href={`/staff/finance/accounts/${a.id}?${q}`}
              className={cn("group flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-linear-to-br to-card transition hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-lg", look.card, !a.isActive && "opacity-60")}>
              <div className="flex-1 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", look.tile)}><look.icon className="size-5" /></span>
                    <div className="min-w-0 leading-tight">
                      <p className="truncate text-[15px] font-semibold">{t(a.name)}</p>
                      <p className="truncate text-xs text-muted-foreground">{a.holderName ?? t(KIND_LABEL[a.kind])}{a.isActive ? "" : ` · ${t("inactive")}`}</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-border/80 bg-background/60 px-2 py-0.5 text-[11px] font-semibold">{a.currency}</span>
                </div>
                <p className={cn("mt-5 text-3xl font-semibold tabular-nums tracking-tight", bal < 0 && "text-rose-600 dark:text-rose-400")}>{formatTZS(bal)}</p>
                <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{t("In the books")}</p>
                <p className="mt-4 font-mono text-sm tracking-[0.18em] text-muted-foreground">{a.accountNumber ? spacedNumber(a.accountNumber) : t(KIND_LABEL[a.kind])}</p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-background/30 px-5 py-3 text-xs">
                <span className="flex items-center gap-3 font-mono tabular-nums">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ArrowDownLeft className="size-3.5" />{n(a.moneyIn)}</span>
                  {a.moneyOut > 0 && <span className="flex items-center gap-1"><ArrowUpRight className="size-3.5" />{n(a.moneyOut)}</span>}
                </span>
                <span className="text-muted-foreground">{t.plural(a.count, "{n} movement", "{n} movements")} · {ago(a.lastAt, new Date(), t)}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title={t("Cash counts")} subtitle={t("Counted vs expected. Differences must be explained and accepted by Admin.")}>
          {counts.length === 0 ? <p className="text-sm text-muted-foreground">{t("No counts yet. Press “Count” on an account to check it.")}</p> : (
            <ul className="space-y-2">
              {counts.map((c) => (
                <li key={c.id} className={cn("rounded-2xl border p-3", c.status === "OPEN" ? "border-rose-500/40 bg-rose-500/[0.05]" : "border-border/70")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{t(c.account.name)} · <span className={cn(c.difference === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{c.difference === 0 ? t("matched") : c.difference > 0 ? t("over {amount}", { amount: formatTZS(Math.abs(c.difference)) }) : t("short {amount}", { amount: formatTZS(Math.abs(c.difference)) })}</span></p>
                      <p className="text-[11px] text-muted-foreground">{t("Expected {expected} · counted {counted}", { expected: formatTZS(c.expected), counted: formatTZS(c.counted) })} · {c.countedBy.fullName}, {t.dateTime(c.countedAt)}</p>
                      {c.note && <p className="mt-1 text-xs">“{c.note}”</p>}
                      {c.status === "ACCEPTED" && c.difference !== 0 && <p className="mt-1 text-[11px] text-muted-foreground">{t("Accepted by {name}", { name: c.reviewedBy?.fullName ?? "—" })}</p>}
                    </div>
                    {c.status === "OPEN" && canManage && <SettleCountButtons id={c.id} />}
                    {c.status === "OPEN" && !canManage && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">{t("Waiting for Admin")}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("Money movements")} subtitle={t("Transfers, owner money, other income and corrections")}>
          {movements.length === 0 ? <p className="text-sm text-muted-foreground">{t("None yet.")}</p> : (
            <ul className="divide-y divide-border/60">
              {movements.map((m) => {
                const off = m.status === "REVERSED";
                return (
                  <li key={m.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2.5", off && "opacity-60")}>
                    <div className="min-w-0">
                      <p className={cn("text-sm font-medium", off && "line-through")}>{m.description}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {m.number} · {t(MOVEMENT_LABELS[m.kind])} · {t(m.account.name)}{m.toAccount ? ` → ${t(m.toAccount.name)}` : ""} · {m.createdBy.fullName}, {t.date(m.businessDate.toISOString().slice(0, 10))}
                        {off && ` · ${t("reversed by {name}: {reason}", { name: m.reversedBy?.fullName ?? "—", reason: m.reversalReason ?? "" })}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {m.attachmentFileId && <a href={`/api/files/${m.attachmentFileId}`} target="_blank" rel="noreferrer" className="grid size-8 place-items-center rounded-lg hover:bg-muted" title={t("Document")}><Paperclip className="size-3.5" /></a>}
                      <span className="text-sm font-semibold tabular-nums">{formatTZS(m.amount)}</span>
                      {!off && canManage && <ReverseButton id={m.id} label={m.number} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
