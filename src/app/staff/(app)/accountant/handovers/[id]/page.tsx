import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { handoverDetail } from "@/server/services/cash-handover";
import { formatTZS } from "@/lib/format";
import { CASH_HANDOVER_ON, HANDOVER_EVENT_TEXT, HANDOVER_STATUS_TEXT, HANDOVER_STATUS_TONE } from "@/lib/cash-handover";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { HandoverActions } from "../handover-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Cash handover") };
}
export const dynamic = "force-dynamic";

const SOURCE = { ROOM: "Rooms & bookings", RESTAURANT: "Restaurant & bar", SALE: "Other sales" } as const;

/** One handover: what the person said, the cash records behind it as they stand now, what Finance received, and its whole story. */
export default async function HandoverPage({ params }: PageProps<"/staff/accountant/handovers/[id]">) {
  const user = await requirePagePermission("cash.handover.view", "cash.handover.review");
  if (!CASH_HANDOVER_ON) notFound();
  const t = await getT();
  const { id } = await params;
  const h = await handoverDetail(id);
  if (!h) notFound();
  const review = can(user, "cash.handover.review") && h.status === "SUBMITTED" && h.submittedById !== user.id;
  const cashAccounts = review ? await db.moneyAccount.findMany({ where: { isActive: true, kind: { in: ["CASH", "PETTY_CASH"] } }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }) : [];
  const changed = h.now.expected !== h.expected;
  const live = h.rows.filter((r) => r.counted);
  return (
    <div className="w-full max-w-4xl space-y-4">
      <Link href="/staff/accountant/handovers" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t("Cash handovers")}</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">{h.number}
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", HANDOVER_STATUS_TONE[h.status])}>{t(HANDOVER_STATUS_TEXT[h.status])}</span></h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {h.submittedBy.fullName} · {h.department === "RESTAURANT" ? t("Restaurant Counter") : t("Front desk")} · {t("sent {time}", { time: t.dateTime(h.submittedAt) })}
          </p>
          <p className="text-xs text-muted-foreground">{t("Covers cash recorded from {from} to {to}", { from: t.dateTime(h.periodStart), to: t.dateTime(h.periodEnd) })}
            {h.shift && <> · <Link href={`/staff/shifts/${h.shift.id}`} className="underline-offset-4 hover:underline">{t("their shift")}</Link></>}</p>
        </div>
        {review && <HandoverActions id={h.id} number={h.number} expected={h.expected} declared={h.declared} accountId={h.accountId} accounts={cashAccounts} canAcceptDifference={can(user, "cash.handover.discrepancy")} />}
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={t("Recorded as cash")} value={formatTZS(h.expected)} sub={t("{collected} collected − {refunds} refunded", { collected: formatTZS(h.collected), refunds: formatTZS(h.refunds) })} />
        <Tile label={t("Staff hand over")} value={formatTZS(h.declared)} sub={h.declared === h.expected ? t("as recorded") : `${h.declared < h.expected ? t("short") : t("over")} ${formatTZS(Math.abs(h.declared - h.expected))}`} />
        <Tile label={t("You received")} value={h.received === null ? "—" : formatTZS(h.received)} sub={h.toAccount ? t("into {account}", { account: t(h.toAccount.name) }) : undefined} strong />
        <Tile label={t("Difference")} value={h.difference === null ? "—" : h.difference === 0 ? t("none") : `${h.difference < 0 ? "−" : "+"}${formatTZS(Math.abs(h.difference))}`} tone={h.difference ? "text-amber-700 dark:text-amber-300" : undefined} />
      </dl>

      {(h.declaredNote || h.reviewNote) && (
        <div className="space-y-1 rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm">
          {h.declaredNote && <p><span className="text-muted-foreground">{t("{name} wrote:", { name: h.submittedBy.fullName })}</span> {h.declaredNote}</p>}
          {h.reviewNote && <p><span className="text-muted-foreground">{t("{name} wrote:", { name: h.reviewedBy?.fullName ?? t("Finance") })}</span> {h.reviewNote}</p>}
        </div>
      )}

      {changed && h.status !== "ACCEPTED" && (
        <p className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          {t("The cash records changed after this was sent: they now add up to {now}, it was sent as {then}. Check the records below before you receive it.", { now: formatTZS(h.now.expected), then: formatTZS(h.expected) })}</p>
      )}

      <section className="rounded-3xl border border-border/70 bg-card">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <h2 className="text-sm font-semibold">{t("The cash records behind it")}</h2>
          <p className="text-xs text-muted-foreground">{t.plural(live.length, "{n} record", "{n} records")} · {t("as they stand now")}</p>
        </header>
        {h.rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("No records.")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <tbody className="divide-y divide-border/50">
                {h.rows.map((r) => (
                  <tr key={`${r.source}-${r.id}`} className={cn(!r.counted && "text-muted-foreground line-through")}>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">{t.dateTime(r.at)}</td>
                    <td className="px-2 py-2">{t(SOURCE[r.source])}{r.refund && ` · ${t("refund")}`}</td>
                    <td className="px-2 py-2">{r.href ? <Link href={r.href} className="underline-offset-4 hover:underline">{r.party ?? r.reference}</Link> : (r.party ?? "")}{r.reference && r.party ? <span className="text-muted-foreground"> · {r.reference}</span> : !r.party && !r.href ? (r.reference ?? "") : ""}</td>
                    <td className={cn("px-4 py-2 text-right font-medium tabular-nums", r.refund && "text-rose-600 dark:text-rose-400")}>{r.refund ? "−" : ""}{formatTZS(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">{t("Struck-through lines were reversed or voided and are not counted.")}</p>
      </section>

      <section className="rounded-3xl border border-border/70 bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">{t("What happened")}</h2>
        <ol className="space-y-2 text-sm">
          {h.events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span><span className="font-medium">{t(HANDOVER_EVENT_TEXT[e.kind] ?? e.kind)}</span> · {e.by.fullName}{e.amount !== null && ` · ${formatTZS(e.amount)}`}{e.note && <span className="text-muted-foreground"> — {e.note}</span>}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{t.dateTime(e.createdAt)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Tile({ label, value, sub, strong, tone }: { label: string; value: string; sub?: string; strong?: boolean; tone?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border/70 px-3 py-2.5", strong ? "bg-foreground/[0.04]" : "bg-card")}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-base tabular-nums", strong ? "font-semibold" : "font-medium", tone)}>{value}</dd>
      {sub && <dd className="text-[11px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}
