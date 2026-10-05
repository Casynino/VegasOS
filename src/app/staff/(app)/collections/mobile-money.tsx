import Link from "next/link";
import { Smartphone } from "lucide-react";
import { formatDateTime, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SOURCE_LABEL, type OnlinePaymentRow } from "@/server/services/online-payments-admin";

/** Where each request stands, in plain words — paid, still waiting for the customer's PIN, or not paid (and why). */
const STATE: Record<string, { label: string; cls: string; group: "paid" | "waiting" | "unpaid" }> = {
  COMPLETED: { label: "Paid", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", group: "paid" },
  PENDING: { label: "Waiting for the customer", cls: "bg-sky-500/12 text-sky-700 dark:text-sky-300", group: "waiting" },
  FAILED: { label: "Not paid", cls: "bg-rose-500/12 text-rose-700 dark:text-rose-300", group: "unpaid" },
  EXPIRED: { label: "Not paid · time ran out", cls: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300", group: "unpaid" },
  CANCELLED: { label: "Not paid · cancelled", cls: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300", group: "unpaid" },
};
export const mobileGroup = (status: string) => STATE[status]?.group ?? "unpaid";

/**
 * MOBILE MONEY on Collections (owner, 2026-10-05: reception and the restaurant must see every mobile-money payment —
 * paid or not — "so they won't get confused"): each payment request, who it was for, the amount, where it stands
 * (and why it did not go through), and who started it (the customer from their phone, or a member of staff).
 * Only "Paid" is money in; the others are not.
 */
export function MobileMoneyList({ rows, filter, href, scope, timezone }: {
  rows: OnlinePaymentRow[];
  filter: "all" | "paid" | "waiting" | "unpaid";
  /** The link for a filter chip. */
  href: (f: string) => string;
  /** What the list covers, e.g. "This shift · the hotel". */
  scope: string;
  timezone: string;
}) {
  const sum = (g: string) => rows.filter((r) => mobileGroup(r.status) === g);
  const groups = { paid: sum("paid"), waiting: sum("waiting"), unpaid: sum("unpaid") };
  const shown = filter === "all" ? rows : groups[filter];
  const chips: { key: typeof filter; label: string; count: number; amount: number; tone: string }[] = [
    { key: "all", label: "All", count: rows.length, amount: 0, tone: "" },
    { key: "paid", label: "Paid", count: groups.paid.length, amount: groups.paid.reduce((t, r) => t + r.amount, 0), tone: "bg-emerald-500" },
    { key: "waiting", label: "Waiting", count: groups.waiting.length, amount: groups.waiting.reduce((t, r) => t + r.amount, 0), tone: "bg-sky-500" },
    { key: "unpaid", label: "Not paid", count: groups.unpaid.length, amount: groups.unpaid.reduce((t, r) => t + r.amount, 0), tone: "bg-rose-500" },
  ];
  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <header className="border-b border-border/60 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Smartphone className="size-4 text-sky-500" />Mobile money · every request<span className="text-xs font-normal text-muted-foreground">{scope}</span></h2>
          <p className="text-xs text-muted-foreground">Only <span className="font-semibold text-emerald-600 dark:text-emerald-400">Paid</span> is money in — the others never arrived.</p>
        </div>
        <nav aria-label="Mobile money filter" className="mt-2.5 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Link key={c.key} href={href(c.key)} aria-current={filter === c.key ? "true" : undefined}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors",
                filter === c.key ? "bg-[oklch(0.72_0.12_80/0.14)] text-foreground ring-1 ring-inset ring-[oklch(0.75_0.12_80/0.45)]" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {c.tone && <span className={cn("size-1.5 rounded-full", c.tone)} />}{c.label}
              <span className="rounded-full bg-muted px-1.5 tabular-nums">{c.count}</span>
              {c.amount > 0 && <span className="tabular-nums text-muted-foreground">{formatTZS(c.amount)}</span>}
            </Link>
          ))}
        </nav>
      </header>
      {shown.length === 0 ? (
        <p className="p-10 text-center text-sm text-muted-foreground">{rows.length ? "None with this status." : "No mobile-money payment requests here yet."}</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {shown.map((r) => {
            const st = STATE[r.status] ?? { label: r.status, cls: "bg-muted", group: "unpaid" as const };
            return (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3">
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                    {r.href ? <Link href={r.href} className="font-semibold underline-offset-2 hover:underline">{r.what}</Link> : <span className="font-semibold">{r.what}</span>}
                    <span className="text-xs text-muted-foreground">{SOURCE_LABEL[r.source ?? ""] ?? r.source ?? ""}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {r.customer ?? "Customer"} · {r.phone} · {formatDateTime(r.at, timezone)}{r.paidAt && r.status === "COMPLETED" ? ` · paid ${formatDateTime(r.paidAt, timezone)}` : ""}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">Started by {r.by === "Customer, online" ? "the customer, from their phone" : r.by}</span>
                  {r.status !== "COMPLETED" && (r.attention ?? r.error) && <span className="mt-1 block text-xs text-rose-700 dark:text-rose-300">{r.attention ?? r.error}</span>}
                </span>
                <span className="text-right">
                  <span className={cn("block text-sm font-semibold tabular-nums", st.group === "paid" ? "text-emerald-600 dark:text-emerald-400" : st.group === "unpaid" ? "text-muted-foreground line-through decoration-1" : "")}>{formatTZS(r.amount)}</span>
                  <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
