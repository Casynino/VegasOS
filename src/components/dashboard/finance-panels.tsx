import Link from "next/link";
import { Banknote, CircleHelp, Coins, CreditCard, Landmark, Smartphone, Wallet } from "lucide-react";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { CheckBalanceButton } from "@/app/staff/(app)/finance/withdraw/withdraw-ui";

/** The pieces Finance's Home is made of: account cards, bars, a pipeline and tables. Plain data in, no money logic here. */

const KIND: Record<string, { icon: React.ReactNode; chip: string; bar: string }> = {
  CASH: { icon: <Banknote />, chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", bar: "bg-emerald-500" },
  BANK: { icon: <Landmark />, chip: "bg-sky-500/15 text-sky-600 dark:text-sky-300", bar: "bg-sky-500" },
  MOBILE_MONEY: { icon: <Smartphone />, chip: "bg-amber-500/15 text-amber-600 dark:text-amber-300", bar: "bg-amber-500" },
  CARD: { icon: <CreditCard />, chip: "bg-violet-500/15 text-violet-600 dark:text-violet-300", bar: "bg-violet-500" },
  PETTY_CASH: { icon: <Coins />, chip: "bg-slate-500/15 text-slate-600 dark:text-slate-300", bar: "bg-slate-500" },
  OTHER: { icon: <Wallet />, chip: "bg-slate-500/15 text-slate-600 dark:text-slate-300", bar: "bg-slate-500" },
};

export interface AccountCardData { id: string; code: string; name: string; kind: string; balance: number; dayIn: number; dayOut: number }
export interface NtzsReport { available: number; at: string; live: boolean; sentSince: number }

/**
 * Where the money is: one card per account — what the hotel's records say it holds (opening + in − out), today's movement and its
 * share of the total. The nTZS card also says what nTZS itself last reported, and the difference, so money that sits at nTZS but
 * is not in the books yet is never hidden.
 */
export function AccountCards({ accounts, ntzs, canCheckNtzs, ntzsNeedsPhone, canOpen, t }: {
  accounts: AccountCardData[]; ntzs: NtzsReport | null; canCheckNtzs: boolean; ntzsNeedsPhone: boolean; canOpen: boolean; t: T;
}) {
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const positive = accounts.reduce((s, a) => s + Math.max(0, a.balance), 0);
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">{t("In all accounts, by the hotel's own records")} <strong className="ml-1 text-base font-semibold tabular-nums text-foreground">{formatTZS(total)}</strong></p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => {
          const k = KIND[a.kind] ?? KIND.OTHER;
          const share = positive > 0 && a.balance > 0 ? Math.round((a.balance / positive) * 100) : 0;
          const isNtzs = a.code === "NTZS";
          const gap = isNtzs && ntzs ? ntzs.available - a.balance : 0;
          const body = (
            <>
              <div className="flex items-start gap-3">
                <span className={cn("grid size-10 shrink-0 place-items-center rounded-2xl [&_svg]:size-5", k.chip)}>{k.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t(a.name)}</p>
                  <p className={cn("mt-0.5 text-xl font-semibold tabular-nums tracking-tight", a.balance < 0 && "text-rose-600 dark:text-rose-400")}>{formatTZS(a.balance)}</p>
                </div>
                {share > 0 && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{share}%</span>}
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", k.bar)} style={{ width: `${share}%` }} /></div>
              <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
                {a.dayIn !== 0 || a.dayOut !== 0 ? <>{t("today")} <span className="text-emerald-600 dark:text-emerald-300">+{formatTZS(a.dayIn)}</span> · <span className="text-rose-600 dark:text-rose-300">−{formatTZS(a.dayOut)}</span></> : t("nothing moved today")}
              </p>
            </>
          );
          return (
            <li key={a.id} className={cn("rounded-3xl border border-border/70 bg-card p-4", isNtzs && "sm:col-span-2 xl:col-span-1")}>
              {canOpen ? <Link href={`/staff/finance/accounts/${a.id}`} className="block rounded-2xl transition-colors hover:bg-muted/30">{body}</Link> : body}
              {isNtzs && (
                <div className="mt-3 space-y-1.5 border-t border-dashed border-border pt-3 text-xs">
                  {ntzs ? (
                    <>
                      <p className="flex items-baseline justify-between gap-2"><span className="text-muted-foreground">{t("nTZS itself reported")}</span><strong className="text-sm tabular-nums">{formatTZS(ntzs.available)}</strong></p>
                      <p className="text-[11px] text-muted-foreground">{t("at {time}", { time: t.dateTime(ntzs.at) })}{!ntzs.live && ` · ${t("test key — no real money")}`}{ntzs.sentSince > 0 && ` · ${t.plural(ntzs.sentSince, "{n} withdrawal sent since", "{n} withdrawals sent since")}`}</p>
                      {gap > 0 && <p className="rounded-xl bg-amber-500/10 px-2.5 py-1.5 font-medium text-amber-700 dark:text-amber-300">{t("{amount} is at nTZS but not in the books yet", { amount: formatTZS(gap) })}</p>}
                      {gap < 0 && <p className="rounded-xl bg-amber-500/10 px-2.5 py-1.5 font-medium text-amber-700 dark:text-amber-300">{t("The books show {amount} more than nTZS reported", { amount: formatTZS(-gap) })}</p>}
                      {gap === 0 && <p className="text-emerald-600 dark:text-emerald-300">{t("The books and nTZS agree")}</p>}
                    </>
                  ) : (
                    <p className="flex items-start gap-1.5 text-muted-foreground"><CircleHelp className="mt-0.5 size-3.5 shrink-0" />{t("nTZS does not show its balance by itself. Check it here to see what it holds.")}</p>
                  )}
                  {canCheckNtzs && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5"><CheckBalanceButton needsPhone={ntzsNeedsPhone} /><Link href="/staff/finance/withdraw" className="text-xs font-medium underline-offset-4 hover:underline">{t("Withdraw funds")}</Link></div>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Horizontal bars: each row's share of the biggest one. For "where it came from" and "where it went". */
export function HBars({ rows, empty, t }: { rows: { label: string; value: number; sub?: string; color?: string }[]; empty: string; t?: T }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0 || max <= 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{t ? t(r.label) : r.label}{r.sub && <span className="ml-2 text-[11px] text-muted-foreground">{r.sub}</span>}</span>
            <span className="shrink-0 font-semibold tabular-nums">{formatTZS(r.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round((r.value / max) * 100))}%`, background: r.color ?? "#8b5cf6" }} /></div>
        </li>
      ))}
    </ul>
  );
}

/** A row of figures in cards: a big number under a small label. */
export function FigureCards({ items }: { items: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {items.map((i) => (
        <div key={i.label} className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2.5">
          <dt className="text-[11px] text-muted-foreground">{i.label}</dt>
          <dd className={cn("mt-0.5 text-base font-semibold tabular-nums", i.tone === "warn" && "text-amber-700 dark:text-amber-300", i.tone === "bad" && "text-rose-600 dark:text-rose-400", i.tone === "good" && "text-emerald-600 dark:text-emerald-300")}>{i.value}</dd>
          {i.sub && <dd className="text-[11px] text-muted-foreground">{i.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A table that scrolls sideways on a phone instead of squeezing: header, rows, right-aligned money columns. */
export function DataTable({ head, right = [], rows, empty, label }: { head: string[]; right?: number[]; rows: React.ReactNode[][]; empty: string; label: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className="w-full min-w-[26rem] text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            {head.map((h, i) => <th key={h} scope="col" className={cn("px-2 py-2 font-medium first:pl-0 last:pr-0", right.includes(i) && "text-right")}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-muted/30">
              {r.map((c, j) => <td key={j} className={cn("px-2 py-2 align-top first:pl-0 last:pr-0", right.includes(j) && "text-right tabular-nums")}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The purchases pipeline: each stage's amount as a bar. Stages are not added — a request is not an expense, an approval is not a payment. */
export function Pipeline({ steps }: { steps: { label: string; amount: number; sub?: string; color: string }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.amount));
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => (
        <li key={s.label} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-2.5">
          <span className="grid size-5 place-items-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
          <div>
            <div className="flex items-baseline justify-between gap-3 text-sm"><span className="truncate">{s.label}{s.sub && <span className="ml-2 text-[11px] text-muted-foreground">{s.sub}</span>}</span><span className="shrink-0 font-semibold tabular-nums">{formatTZS(s.amount)}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${s.amount > 0 ? Math.max(2, Math.round((s.amount / max) * 100)) : 0}%`, background: s.color }} /></div>
          </div>
        </li>
      ))}
    </ol>
  );
}
