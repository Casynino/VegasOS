import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Clock, Search, ShieldCheck, Smartphone, XCircle } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { businessToday, getSettings } from "@/server/settings";
import { siteOrigin } from "@/server/site-origin";
import {
  onlineAttentionRows, onlinePayments, onlinePaymentStatus, onlinePaymentTotals, PURPOSE_LABEL, reconcileOnlinePayments, SOURCE_LABEL, type OnlineStatusFilter,
} from "@/server/services/online-payments-admin";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FinanceTabs, PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { AutoSelect } from "@/components/staff/finance/auto-select";
import { MobileMoneyAttention } from "../../mobile-pay/attention";
import { OnlinePaySwitches, TestConnection } from "./controls";

export const metadata: Metadata = { title: "Online payments" };

const tzs = (n: number) => `TZS ${n.toLocaleString("en-US")}`;
const STATUS: Record<string, { label: string; cls: string }> = {
  COMPLETED: { label: "Paid", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  PENDING: { label: "Waiting", cls: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  FAILED: { label: "Failed", cls: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  EXPIRED: { label: "Timed out", cls: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300" },
  CANCELLED: { label: "Cancelled", cls: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300" },
};
const FILTERS: { value: OnlineStatusFilter; label: string }[] = [
  { value: "all", label: "Every status" }, { value: "paid", label: "Paid" }, { value: "pending", label: "Waiting" }, { value: "failed", label: "Not completed" }, { value: "attention", label: "Needs a person" },
];

/**
 * ONLINE PAYMENTS — nTZS, the hotel's one online payment: connected and on (and for which services), every attempt
 * with its reference, what needs a person, and the reconciliation against the hotel's books.
 */
export default async function OnlinePaymentsPage({ searchParams }: PageProps<"/staff/finance/online">) {
  const user = await requirePagePermission("finance.view");
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const today = await businessToday();
  const p = readPeriod(sp, today, "week");
  const status = (FILTERS.some((f) => f.value === str(sp.status)) ? str(sp.status) : "all") as OnlineStatusFilter;
  const purpose = str(sp.purpose) in PURPOSE_LABEL ? str(sp.purpose) : null;
  const q = str(sp.q).trim().slice(0, 60);
  const settings = await getSettings();
  const [state, totals, rows, recon, attention, origin] = await Promise.all([
    onlinePaymentStatus(settings), onlinePaymentTotals(p.from, p.to), onlinePayments({ from: p.from, to: p.to, status, purpose, q }),
    reconcileOnlinePayments(p.from, p.to), onlineAttentionRows(), siteOrigin().catch(() => process.env.NEXT_PUBLIC_SITE_URL ?? ""),
  ]);
  const keep = Object.fromEntries(Object.entries({ status: status === "all" ? "" : status, purpose: purpose ?? "", q }).filter(([, v]) => v));
  const period = p.key === "custom" ? { from: p.from, to: p.to } : { period: p.key };
  const active = state.connected && state.enabled;

  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/finance/online" />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-3xl border border-border/70 bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={cn("grid size-11 place-items-center rounded-2xl", active ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}><Smartphone className="size-5" /></span>
              <div className="leading-tight">
                <h1 className="text-lg font-semibold">Online payment · NTZS</h1>
                <p className="text-sm text-muted-foreground">{!state.connected ? "Not set up" : active ? `Connected · active · ${state.live ? "live" : "test"} mode` : "Connected · switched off"}</p>
              </div>
            </div>
            {state.connected && <TestConnection />}
          </div>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <Fact ok={state.connected} label="API key" value={state.connected ? `Set on the server (${state.live ? "live" : "test"})` : "Missing — add NTZS_API_KEY"} />
            <Fact ok={state.webhookSecret} label="Webhook" value={state.webhookSecret ? (state.lastWebhookAt ? `Last confirmation ${formatDateTime(state.lastWebhookAt, settings.timezone)}` : "Set — no confirmation yet") : "Missing — add NTZS_WEBHOOK_SECRET"} />
            <Fact ok={state.enabled} label="Customers" value={state.enabled ? "See Pay online where a service is on" : "Do not see Pay online"} />
            <div className="rounded-2xl bg-muted/40 px-3 py-2"><dt className="text-xs text-muted-foreground">Webhook address (nTZS dashboard)</dt><dd className="mt-0.5 break-all font-mono text-xs">{origin}/api/webhooks/ntzs</dd></div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Keys stay on the server — never on a screen. Cash, bank, manual mobile money and Charge to room keep working whatever is set here.</p>
        </section>

        <section className="rounded-3xl border border-border/70 bg-card p-5">
          <h2 className="text-base font-semibold">Where customers can pay online</h2>
          <div className="mt-3"><OnlinePaySwitches enabled={state.enabled} services={state.services} canManage={can(user, "settings.manage")} connected={state.connected} /></div>
        </section>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{periodLabel(p)}</h2>
        <PeriodPicker current={p.key} from={p.from} to={p.to} keep={keep} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={CheckCircle2} tone="emerald" label="Paid online" value={tzs(totals.paid.amount)} sub={`${totals.paid.count} payment${totals.paid.count === 1 ? "" : "s"}`} />
        <Tile icon={Clock} tone="sky" label="Waiting" value={String(totals.pending)} sub="on the customer's phone" />
        <Tile icon={XCircle} tone="zinc" label="Not completed" value={String(totals.failed)} sub="failed, timed out or stopped" />
        <Tile icon={CircleAlert} tone={totals.attention ? "amber" : "zinc"} label="Needs a person" value={String(totals.attention)} sub="any time" />
      </div>

      <MobileMoneyAttention rows={attention} />

      <section className="rounded-3xl border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="size-4 text-emerald-600" />Reconciliation</h2>
            <p className="text-xs text-muted-foreground">Every payment nTZS confirmed in this period, checked against the hotel&apos;s books — recorded once, for the same amount.</p>
          </div>
          <p className="text-right text-sm"><span className="font-semibold tabular-nums">{recon.matched} of {recon.confirmed}</span> match<span className="block text-xs text-muted-foreground">{tzs(recon.confirmedAmount)} confirmed · {tzs(recon.recorded)} on the books</span></p>
        </div>
        {recon.issues.length === 0
          ? <p className="mt-3 rounded-2xl bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">{recon.confirmed ? "Everything nTZS confirmed is on the books." : "Nothing confirmed by nTZS in this period."}</p>
          : <ul className="mt-3 space-y-2">{recon.issues.map((i) => (
              <li key={`${i.id}-${i.problem}`} className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 text-sm">
                <span className="min-w-0"><span className="font-medium">{i.what}</span> · {tzs(i.amount)}<span className="block text-xs text-muted-foreground">{i.problem}</span></span>
                <span className="text-xs text-muted-foreground">{formatDateTime(i.at, settings.timezone)}</span>
              </li>
            ))}</ul>}
      </section>

      <form className="flex flex-wrap gap-2 rounded-3xl border border-border/70 bg-card p-3">
        {Object.entries(period).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={q} placeholder="nTZS reference, phone…" className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm" />
        </div>
        <AutoSelect name="status" value={status} label="Status" options={FILTERS} />
        <AutoSelect name="purpose" value={purpose ?? ""} label="Service" options={[{ value: "", label: "Every service" }, ...Object.entries(PURPOSE_LABEL).map(([value, label]) => ({ value, label }))]} />
      </form>

      {rows.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No online payments match.</p>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-border/70 bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border/70">
                <th className="px-4 py-2.5 font-medium">When</th><th className="px-4 py-2.5 font-medium">For</th><th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">nTZS reference</th><th className="px-4 py-2.5 font-medium">Started by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(r.at, settings.timezone)}{r.paidAt && r.status === "COMPLETED" && <span className="block text-xs text-muted-foreground">paid {formatDateTime(r.paidAt, settings.timezone)}</span>}</td>
                  <td className="px-4 py-2.5">{r.href ? <Link href={r.href} className="font-medium underline-offset-2 hover:underline">{r.what}</Link> : <span className="font-medium">{r.what}</span>}<span className="block text-xs text-muted-foreground">{SOURCE_LABEL[r.source ?? ""] ?? r.source ?? "—"}</span></td>
                  <td className="px-4 py-2.5">{r.customer ?? "—"}<span className="block text-xs tabular-nums text-muted-foreground">{r.phone}</span></td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{tzs(r.amount)}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS[r.status]?.cls)}>{STATUS[r.status]?.label ?? r.status}</span>
                    {r.attention && <span className="mt-1 block max-w-56 text-xs text-amber-700 dark:text-amber-300">{r.attention}</span>}
                    {r.error && <span className="mt-1 block max-w-56 text-xs text-muted-foreground">{r.error}</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.reference ?? "—"}{!r.live && <span className="ml-1 rounded bg-muted px-1 py-px font-sans text-[10px]">test</span>}</td>
                  <td className="px-4 py-2.5 text-xs">{r.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Fact({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl bg-muted/40 px-3 py-2">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />}
      <span className="min-w-0 leading-tight"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm">{value}</dd></span>
    </div>
  );
}

const TONES = { emerald: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/12", sky: "text-sky-700 dark:text-sky-300 bg-sky-500/12", amber: "text-amber-700 dark:text-amber-300 bg-amber-500/15", zinc: "text-zinc-600 dark:text-zinc-300 bg-zinc-500/12" };
function Tile({ icon: Icon, tone, label, value, sub }: { icon: typeof Clock; tone: keyof typeof TONES; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-card p-4">
      <span className={cn("grid size-8 place-items-center rounded-xl", TONES[tone])}><Icon className="size-4" /></span>
      <p className="mt-2 text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
