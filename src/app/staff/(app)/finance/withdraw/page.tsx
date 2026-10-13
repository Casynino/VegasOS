import type { Metadata } from "next";
import Link from "next/link";
import { BanknoteArrowUp, CircleCheck, CircleX, Clock, ReceiptText, Search, TriangleAlert } from "lucide-react";
import { getT } from "@/i18n/server";
import { requestMeta, requirePagePermission } from "@/server/auth";
import { businessToday, getSettings } from "@/server/settings";
import { ntzsAvailable, withdrawalsOverview, type WithdrawalView } from "@/server/services/withdrawals";
import { WITHDRAWAL_FILTERS, withdrawalProblem } from "@/lib/withdrawals";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FinanceTabs, PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { AutoSelect } from "@/components/staff/finance/auto-select";
import { LiveRefresh } from "@/components/live-refresh";
import { StatusChip, WithdrawButton, WithdrawalDetails } from "./withdraw-ui";

/** Sending a withdrawal waits for nTZS's answer (up to 20 s) — the page's actions get the time for it. */
export const maxDuration = 60;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Withdraw funds") };
}

const TONES = {
  emerald: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/12",
  sky: "text-sky-700 dark:text-sky-300 bg-sky-500/12",
  amber: "text-amber-700 dark:text-amber-300 bg-amber-500/15",
  rose: "text-rose-700 dark:text-rose-300 bg-rose-500/12",
  zinc: "text-zinc-600 dark:text-zinc-300 bg-zinc-500/12",
} as const;
const NOTICE = "flex flex-wrap items-start gap-x-3 gap-y-1 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm";

/**
 * WITHDRAW FUNDS — the Boss (or the Admin) takes money out of the hotel's nTZS balance without opening nTZS: the
 * balance as nTZS last reported it, what is on its way, and every withdrawal with its real state. The keys, the
 * connection and the limits stay with the administrator and nTZS — nothing on this page can change them.
 */
export default async function WithdrawFundsPage({ searchParams }: PageProps<"/staff/finance/withdraw">) {
  const user = await requirePagePermission("withdrawals.manage");
  const t = await getT();
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const today = await businessToday();
  const p = readPeriod(sp, today, "month");
  const status = WITHDRAWAL_FILTERS.some((f) => f.key === str(sp.status)) ? str(sp.status) : "all";
  const person = str(sp.person).slice(0, 40);
  const q = str(sp.q).trim().slice(0, 80);
  const [settings, { ipAddress }] = await Promise.all([getSettings(), requestMeta()]);
  const av = await ntzsAvailable();
  const o = await withdrawalsOverview(
    { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions },
    { from: p.from, to: p.to, status, person: person || null, q: q || null },
  );
  const tz = settings.timezone;
  const keep = Object.fromEntries(Object.entries({ status: status === "all" ? "" : status, person, q }).filter(([, v]) => v));
  const period = p.key === "custom" ? { from: p.from, to: p.to } : { period: p.key };
  const filtered = status !== "all" || !!person || !!q;
  const problem = o.setupProblem ? withdrawalProblem(o.setupProblem) : null;
  /** A fee is said for a withdrawal that left (or may leave) the balance — not for one that never went. */
  const feeOf = (r: WithdrawalView) => (r.feeTzs !== null && !["REJECTED", "FAILED", "CANCELLED"].includes(r.status) ? r.feeTzs : null);

  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/finance/withdraw" />
      <LiveRefresh active={o.inFlight.count > 0} every={20} />

      <section className="rounded-3xl border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", TONES.emerald)}><BanknoteArrowUp className="size-5" /></span>
            <div className="leading-tight">
              <h1 className="text-lg font-semibold">{t("Withdraw funds")}</h1>
              <p className="text-sm text-muted-foreground">{t("Take money out of the hotel's nTZS balance — to a phone, a Lipa number or a bank account.")}</p>
            </div>
          </div>
          <WithdrawButton available={av.available} disabled={!o.enabled || !!o.unsettled} accounts={o.accounts} destinations={o.destinations} lastBooks={o.lastBooks} timezone={tz} />
        </div>
        {(!o.enabled || !o.live || problem || o.unsettled) && (
          <div className="mt-4 space-y-2">
            {!o.enabled && <p className={NOTICE}><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" /><span className="min-w-0 flex-1">{t("Withdrawals are not switched on yet — the administrator has to connect the hotel's nTZS account.")}</span></p>}
            {o.enabled && !o.live && <p className="rounded-2xl bg-muted/60 px-3 py-2 text-sm">{t("Test mode — the hotel's nTZS account is connected with a test key, so no real money moves.")}</p>}
            {problem && <p className={NOTICE}><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" /><span className="min-w-0 flex-1">{t(problem)}</span></p>}
            {o.unsettled && (
              <p className={NOTICE}>
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span className="min-w-0 flex-1">{t("Withdrawal {number} has no clear answer from nTZS yet. No other withdrawal can be sent until it is settled — so the same money is never sent twice.", { number: o.unsettled.number ?? "" })}</span>
                <WithdrawalDetails id={o.unsettled.id} label={t("Open it")} timezone={tz} />
              </p>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-3xl border border-border/70 bg-card p-5">
          <p className="text-sm text-muted-foreground">{t("Available to withdraw")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatTZS(av.available)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("In the nTZS account's books: {amount}.", { amount: formatTZS(av.books) })}
            {o.bookAccountId && <Link href={`/staff/finance/accounts/${o.bookAccountId}`} className="mt-0.5 block font-medium text-foreground underline-offset-4 hover:underline">{t("Open the account")}</Link>}
            {av.onItsWay > 0 && <span className="mt-0.5 block text-amber-700 dark:text-amber-300">{t("{amount} is on its way out and not counted.", { amount: formatTZS(av.onItsWay) })}</span>}
          </p>
        </section>
        <section className="rounded-3xl border border-border/70 bg-card p-5">
          <p className="text-sm text-muted-foreground">{t("On its way")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatTZS(o.inFlight.total)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{o.inFlight.count ? t.plural(o.inFlight.count, "{n} withdrawal sent and not finished yet.", "{n} withdrawals sent and not finished yet.") : t("Nothing is waiting.")}</p>
        </section>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{periodLabel(p, t)}</h2>
        <PeriodPicker current={p.key} from={p.from} to={p.to} keep={keep} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={CircleCheck} tone="emerald" label={t("Withdrawn")} value={formatTZS(o.period.withdrawn)} sub={t.plural(o.period.completed, "{n} withdrawal completed", "{n} withdrawals completed")} />
        <Tile icon={ReceiptText} tone="zinc" label={t("nTZS fees")} value={formatTZS(o.period.fees)} sub={o.period.fees === 0 ? t("on completed withdrawals") : o.period.feesAllConfirmed ? t("confirmed by nTZS") : t("includes estimates nTZS has not confirmed")} />
        <Tile icon={Clock} tone={o.period.pending ? "sky" : "zinc"} label={t("Pending")} value={String(o.period.pending)} sub={t("sent, not finished yet")} />
        <Tile icon={CircleX} tone={o.period.failed ? "rose" : "zinc"} label={t("Failed or refused")} value={String(o.period.failed)} sub={t("the money stayed at nTZS")} />
      </div>

      <form className="flex flex-wrap gap-2 rounded-3xl border border-border/70 bg-card p-3">
        {Object.entries(period).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={q} aria-label={t("Search")} placeholder={t("Number, nTZS reference, name or amount…")} className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm" />
        </div>
        <AutoSelect name="status" value={status} label={t("Status")} options={WITHDRAWAL_FILTERS.map((f) => ({ value: f.key, label: f.key === "all" ? t("Every status") : t(f.label) }))} />
        {o.people.length > 1 && <AutoSelect name="person" value={person} label={t("Asked by")} options={[{ value: "", label: t("Everyone") }, ...o.people.map((x) => ({ value: x.id, label: x.name }))]} />}
      </form>

      {o.rows.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{filtered ? t("No withdrawals match.") : t("No withdrawals in this period.")}</p>
      ) : (
        <>
          {/* A phone: one card per withdrawal */}
          <ul className="space-y-2 md:hidden">
            {o.rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border/70 bg-card p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="shrink-0 text-base font-semibold whitespace-nowrap tabular-nums">{formatTZS(r.amount)}</p>
                  <StatusChip status={r.status} test={r.test} />
                </div>
                <p className="mt-1 truncate">{r.recipientName ? `${r.recipientName} · ` : ""}<span className="tabular-nums">{r.destination}</span></p>
                <p className="text-xs text-muted-foreground">{t.dateTime(r.createdAt, tz)} · {r.requestedBy}</p>
                {r.attention.length > 0 && <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300"><TriangleAlert className="size-3.5" />{t("Needs a look")}</p>}
                <p className="mt-2"><WithdrawalDetails id={r.id} label={r.number ? t("Open {number}", { number: r.number }) : t("Open")} timezone={tz} /></p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-3xl border border-border/70 bg-card md:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t("When")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("Withdrawal")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("To")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("Amount")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("Status")}</th>
                  <th className="px-4 py-2.5 font-medium">{t("nTZS reference")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {o.rows.map((r) => {
                  const fee = feeOf(r);
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-2.5 whitespace-nowrap">{t.dateTime(r.createdAt, tz)}<span className="block text-xs text-muted-foreground">{r.requestedBy}</span></td>
                      <td className="px-4 py-2.5 whitespace-nowrap"><WithdrawalDetails id={r.id} label={r.number ?? t("Open")} timezone={tz} /></td>
                      <td className="px-4 py-2.5">{r.recipientName && <span className="block">{r.recipientName}</span>}<span className={cn("tabular-nums", r.recipientName && "text-xs text-muted-foreground")}>{r.destination}</span></td>
                      <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap tabular-nums">
                        {formatTZS(r.amount)}
                        {fee !== null && <span className="block text-xs font-normal text-muted-foreground">{r.feeConfirmed ? t("fee {amount}", { amount: formatTZS(fee) }) : t("fee about {amount}", { amount: formatTZS(fee) })}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusChip status={r.status} test={r.test} />
                        {r.attention.length > 0 && <span className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300"><TriangleAlert className="size-3.5" />{t("Needs a look")}</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs break-all text-muted-foreground">{r.payoutReference ?? r.providerId ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {o.rows.length >= 200 && <p className="text-center text-xs text-muted-foreground">{t("The latest 200 are shown — choose shorter dates to see earlier ones.")}</p>}
        </>
      )}

      <p className="text-xs text-muted-foreground">{t("A withdrawal moves money out of nTZS — it is never counted as income or as an expense. It enters the hotel's books only when nTZS confirms the money arrived; only nTZS's fee is recorded as a cost.")}</p>
    </div>
  );
}

function Tile({ icon: Icon, tone, label, value, sub }: { icon: typeof Clock; tone: keyof typeof TONES; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-card p-4">
      <span className={cn("grid size-9 place-items-center rounded-xl", TONES[tone])}><Icon className="size-4" /></span>
      <p className="mt-3 text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
