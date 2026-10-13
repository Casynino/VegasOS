import Link from "next/link";
import { AlertCircle, Banknote, BadgeCheck, Coins, CreditCard, Info, Landmark, Smartphone, TrendingUp, Wallet } from "lucide-react";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";

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

/**
 * Where the money is: one card per account — what the hotel's records say it holds (opening + in − out), today's movement and its
 * share of the total. The nTZS card also says what nTZS itself last reported, and the difference, so money that sits at nTZS but
 * is not in the books yet is never hidden.
 */
export function AccountCards({ accounts, canWithdraw, canOpen, t }: {
  accounts: AccountCardData[]; canWithdraw: boolean; canOpen: boolean; t: T;
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
          const body = (
            <>
              <div className="flex items-center gap-3">
                <span className={cn("grid size-10 shrink-0 place-items-center rounded-2xl [&_svg]:size-5", k.chip)}>{k.icon}</span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{t(a.name)}</p>
                {share > 0 && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">{share}%</span>}
              </div>
              <p className={cn("mt-3 text-2xl font-semibold tabular-nums tracking-tight", a.balance < 0 && "text-rose-600 dark:text-rose-400")}>{formatTZS(a.balance)}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", k.bar)} style={{ width: `${share}%` }} /></div>
              <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
                {a.dayIn !== 0 || a.dayOut !== 0 ? <>{t("today")} <span className="text-emerald-600 dark:text-emerald-300">+{formatTZS(a.dayIn)}</span> · <span className="text-rose-600 dark:text-rose-300">−{formatTZS(a.dayOut)}</span></> : t("nothing moved today")}
              </p>
            </>
          );
          return (
            <li key={a.id} className={cn("rounded-3xl border border-border/70 bg-card p-4", isNtzs && "sm:col-span-2 xl:col-span-1")}>
              {canOpen ? <Link href={`/staff/finance/accounts/${a.id}`} className="block rounded-2xl transition-colors hover:bg-muted/30">{body}</Link> : body}
              {isNtzs && canWithdraw && <div className="mt-3 border-t border-dashed border-border pt-3"><Link href="/staff/finance/withdraw" className="text-xs font-medium underline-offset-4 hover:underline">{t("Withdraw funds")}</Link></div>}
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
    <div className="@container"><dl className="grid grid-cols-1 gap-2.5 @[17rem]:grid-cols-2 @[26rem]:grid-cols-3">
      {items.map((i) => (
        <div key={i.label} className="min-w-0 rounded-2xl border border-border/60 bg-muted/20 px-3 py-2.5">
          <dt className="text-[11px] text-muted-foreground">{i.label}</dt>
          <dd className={cn("mt-0.5 text-base font-semibold tabular-nums", i.tone === "warn" && "text-amber-700 dark:text-amber-300", i.tone === "bad" && "text-rose-600 dark:text-rose-400", i.tone === "good" && "text-emerald-600 dark:text-emerald-300")}>{i.value}</dd>
          {i.sub && <dd className="text-[11px] text-muted-foreground">{i.sub}</dd>}
        </div>
      ))}
    </dl></div>
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
              {r.map((c, j) => <td key={j} className={cn("px-2 py-2 align-top first:pl-0 last:pr-0", right.includes(j) && "whitespace-nowrap text-right tabular-nums")}>{c}</td>)}
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

/**
 * One bar cut into parts, with every part named underneath (colour is never the only sign): for "how late" and "when it falls due".
 * Parts with nothing in them are left out of the bar and shown greyed in the list, so the list is always the same.
 */
export function SplitBar({ rows, empty, total }: { rows: { label: string; amount: number; count: number; color: string; note?: string }[]; empty: string; total: number }) {
  if (total <= 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {rows.filter((r) => r.amount > 0).map((r) => <div key={r.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${Math.max(2, (r.amount / total) * 100)}%`, background: r.color }} />)}
      </div>
      <ul className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className={cn("grid grid-cols-[0.75rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 text-sm", r.amount === 0 && "text-muted-foreground")}>
            <span className="size-2.5 translate-y-px rounded-sm" style={{ background: r.amount > 0 ? r.color : "var(--muted)" }} />
            <span className="min-w-0 truncate">{r.label}{r.note && <span className="ml-2 text-[11px] text-muted-foreground">{r.note}</span>}</span>
            <span className="text-right tabular-nums"><span className="font-semibold">{formatTZS(r.amount)}</span><span className="ml-2 inline-block w-9 text-[11px] text-muted-foreground">{Math.round((r.amount / total) * 100)}%</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TINT = {
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-300", sky: "bg-sky-500/15 text-sky-600 dark:text-sky-300", emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300", rose: "bg-rose-500/15 text-rose-600 dark:text-rose-300", slate: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
} as const;
export type PanelTone = keyof typeof TINT;

/** A figure with its change against the period before and a short line under it, each with a small tinted icon. */
export function KpiCards({ items }: { items: { label: string; value: string; change?: React.ReactNode; sub?: string; icon?: React.ReactNode; tone?: PanelTone }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col rounded-2xl border border-border/60 bg-linear-to-br from-muted/40 to-card px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            {i.icon && <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl [&_svg]:size-4", TINT[i.tone ?? "slate"])}>{i.icon}</span>}
            <dt className="min-w-0 text-xs font-medium leading-tight text-muted-foreground">{i.label}</dt>
          </div>
          <dd className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{i.value}</dd>
          {i.change && <dd className="mt-1.5">{i.change}</dd>}
          {i.sub && <dd className="mt-1 text-[11px] leading-snug text-muted-foreground">{i.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A part of the page: a tinted icon, the name, one line about it, and where to go for more. The id is where the page's "jump to" links land. */
export function PartHeading({ id, icon, tone = "violet", title, subtitle, action }: { id?: string; icon: React.ReactNode; tone?: PanelTone; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-28 items-center justify-between gap-3 border-b border-border/60 pb-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-2xl [&_svg]:size-5", TINT[tone])}>{icon}</span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight tracking-tight text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** "Jump to": the parts of this long page as small links (no tabs — everything is on the page). */
export function JumpNav({ label, items }: { label: string; items: { id: string; label: string; icon: React.ReactNode }[] }) {
  return (
    <nav aria-label={label} className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] md:flex-wrap md:overflow-visible">
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground [&_svg]:size-3.5">
          {i.icon}{i.label}
        </a>
      ))}
    </nav>
  );
}

/** One bar per day of the week: how much each earns on average, the full amount at the end of each bar; the best day stands out. */
export function WeekColumns({ days, best, bestLabel }: { days: { label: string; value: number; sub?: string }[]; best: number; bestLabel: string }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <ul className="space-y-3" aria-label={days.map((d) => `${d.label}: ${formatTZS(d.value)}`).join("; ")}>
      {days.map((d) => {
        const top = d.value > 0 && d.value === best;
        return (
          <li key={d.label} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 text-sm" title={d.sub}>
            <span className={cn("text-muted-foreground", top && "font-semibold text-foreground")}>{d.label}</span>
            <div className="h-3.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.max(d.value ? 2 : 0, (d.value / max) * 100)}%`, background: top ? "linear-gradient(90deg,#10b981,#34d399)" : "linear-gradient(90deg,#8b5cf6,#a78bfa)" }} />
            </div>
            <span className="min-w-[7.5rem] text-right font-semibold tabular-nums">{formatTZS(d.value)}{top && <span className="ml-1.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">{bestLabel}</span>}</span>
          </li>
        );
      })}
    </ul>
  );
}

const INSIGHT = {
  bad: { icon: <AlertCircle />, chip: "bg-rose-500/15 text-rose-600 dark:text-rose-300" },
  warn: { icon: <Info />, chip: "bg-amber-500/15 text-amber-600 dark:text-amber-300" },
  info: { icon: <Info />, chip: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  good: { icon: <TrendingUp />, chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
} as const;

/** The few sentences worth reading, most serious first; one with a place to act on it is a link. */
export function InsightList({ items }: { items: { id: string; tone: keyof typeof INSIGHT; text: React.ReactNode; href?: string }[] }) {
  return (
    <ul className="grid gap-2 lg:grid-cols-2">
      {items.map((i) => {
        const k = INSIGHT[i.tone];
        const body = (
          <>
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl [&_svg]:size-4", k.chip)}>{i.tone === "good" ? <BadgeCheck /> : k.icon}</span>
            <span className="min-w-0 text-sm leading-snug">{i.text}</span>
          </>
        );
        return (
          <li key={i.id}>
            {i.href
              ? <Link href={i.href} className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/20 px-3 py-2.5 transition-colors hover:bg-muted/40">{body}</Link>
              : <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/20 px-3 py-2.5">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
