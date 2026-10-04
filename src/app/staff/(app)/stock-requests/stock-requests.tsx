"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronRight, ClipboardList, Coins, Copy, CornerUpLeft, Flame, MessageCircle, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import type { StockGroup } from "@/lib/stock-catalog";
import {
  OPEN_STATUSES, num, person, toBuyQty, when,
  type DepartmentOption, type PurchaseOptionsView, type PurchasingSummaryView, type StockReqView, type StoreItem, type Viewer,
} from "@/lib/stock-requests";
import { DeptBadge, StatusChip, norm, picsFor } from "./parts";
import { NewRequest, groupsFor } from "./new-request";
import { RequestDialog } from "./request-dialog";

type Counter = { key: string; label: string; value: number; statuses: string[]; tone: string; dot: string; sub?: string };

/** Is it this person's turn? The manager reviews and approves, the buyer buys, the asker changes what was sent back. */
function yourTurn(r: StockReqView, me: Viewer) {
  return (r.status === "SUBMITTED" && me.reviewer) || (r.status === "PENDING_APPROVAL" && me.reviewer)
    || ((r.status === "APPROVED" || r.status === "PURCHASING") && me.buyer) || (r.status === "SENT_BACK" && r.byId === me.id);
}

/**
 * Stock requests for every department. Staff pick what they need (the kitchen's ingredients and
 * supplies, the bar's drinks with their photos, each department's own stock items), check the list
 * — print or save it — and send it. The manager reviews it, the buyer records what was actually
 * bought, and the manager's final approval puts it into stock with ONE expense. Someone who only
 * asks sees their own requests, never the money.
 */
export function StockRequests({ open, closed, me, hotel, today, kitchen, drinks, departments, storeItems, defaultDepartment, summary, options }: {
  open: StockReqView[]; closed: StockReqView[]; me: Viewer; hotel: string; today: string; kitchen: StockGroup[]; drinks: StockGroup[];
  departments: DepartmentOption[]; storeItems: StoreItem[]; defaultDepartment: string; summary: PurchasingSummaryView | null; options: PurchaseOptionsView | null;
}) {
  const money = me.reviewer || me.buyer;
  const sentBackToMe = open.filter((r) => r.status === "SENT_BACK" && r.byId === me.id).length;
  const [tab, setTab] = useState<"new" | "requests">(me.asker && !money && !sentBackToMe ? "new" : "requests");
  const [filter, setFilter] = useState<string | null>(null);
  const pics = useMemo(() => picsFor([...kitchen, ...drinks], storeItems, departments), [kitchen, drinks, storeItems, departments]);
  const turn = open.filter((r) => yourTurn(r, me)).length;

  const counters: Counter[] = money && summary ? [
    { key: "review", label: "To review", value: summary.toReview, statuses: ["SUBMITTED"], tone: "text-sky-600 dark:text-sky-300", dot: "bg-sky-400" },
    { key: "buy", label: "To buy", value: summary.toBuy, statuses: ["APPROVED"], tone: "text-amber-600 dark:text-amber-300", dot: "bg-amber-400" },
    { key: "buying", label: "Being bought", value: summary.buying, statuses: ["PURCHASING"], tone: "text-violet-600 dark:text-violet-300", dot: "bg-violet-400" },
    { key: "approve", label: "To approve", value: summary.toApprove, statuses: ["PENDING_APPROVAL"], tone: "text-fuchsia-600 dark:text-fuchsia-300", dot: "bg-fuchsia-400", sub: summary.toApprove ? formatTZS(summary.toApproveAmount) : undefined },
  ] : [
    { key: "waiting", label: "Waiting", value: open.filter((r) => r.status === "SUBMITTED" || r.status === "SENT_BACK").length, statuses: ["SUBMITTED", "SENT_BACK"], tone: "text-sky-600 dark:text-sky-300", dot: "bg-sky-400" },
    { key: "approved", label: "Approved", value: open.filter((r) => ["APPROVED", "PURCHASING", "PENDING_APPROVAL"].includes(r.status)).length, statuses: ["APPROVED", "PURCHASING", "PENDING_APPROVAL"], tone: "text-amber-600 dark:text-amber-300", dot: "bg-amber-400" },
    { key: "done", label: "Done lately", value: closed.filter((r) => r.status === "COMPLETED").length, statuses: ["COMPLETED"], tone: "text-emerald-600 dark:text-emerald-300", dot: "bg-emerald-400" },
  ];
  const active = counters.find((c) => c.key === filter) ?? null;
  const showList = () => { if (tab !== "requests") setTab("requests"); };

  return (
    <div className="space-y-5">
      {/* The top: one tidy card — the title, the counts (tap one to see just those), and the two parts of the page */}
      <header className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-[oklch(0.75_0.13_80)]/[0.12] blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-[oklch(0.85_0.1_84)] to-[oklch(0.68_0.12_76)] text-[oklch(0.2_0.03_60)] shadow-[0_10px_24px_-14px_oklch(0.7_0.12_80)]">
            <PackagePlus className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.11_82)]">{money ? "Every department · purchasing" : "Ask for stock"}</p>
            <h1 className="font-display text-[26px] font-semibold leading-tight">Stock requests</h1>
          </div>
          <div role="group" aria-label="Requests at each step" className="flex max-w-full items-stretch divide-x divide-border/70 overflow-x-auto rounded-2xl bg-background/40 ring-1 ring-border/60 [scrollbar-width:none]">
            {counters.map((c) => (
              <div key={c.key} className="shrink-0">
                <button type="button" onClick={() => { setFilter((f) => (f === c.key ? null : c.key)); showList(); }} aria-pressed={filter === c.key}
                  className={cn("h-full px-4 py-2 text-center transition sm:px-5", filter === c.key ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]")}>
                  <span className={cn("block text-[22px] font-semibold leading-none tabular-nums", c.value ? c.tone : "text-muted-foreground/70")}>{c.value}</span>
                  <span className="mt-1 flex items-center justify-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground"><span className={cn("size-1.5 rounded-full", c.dot)} />{c.label}</span>
                  {c.sub && <span className="mt-0.5 block whitespace-nowrap text-[10.5px] font-semibold tabular-nums text-muted-foreground">{c.sub}</span>}
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-2 sm:px-3">
          {me.asker ? (
            <nav className="flex" aria-label="Stock requests">
              {([["new", "New request", PackagePlus], ["requests", "Requests", ClipboardList]] as const).map(([v, label, I]) => (
                <button key={v} type="button" onClick={() => setTab(v)} aria-current={tab === v ? "page" : undefined}
                  className={cn("relative flex items-center gap-2 px-3 py-3 text-sm font-medium transition",
                    tab === v ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  <I className={cn("size-4", tab === v && "text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.11_82)]")} />{label}
                  {v === "requests" && turn > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-[11px] font-semibold tabular-nums text-amber-700 dark:text-amber-300">{turn}</span>}
                  {tab === v && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[oklch(0.78_0.12_80)]" />}
                </button>
              ))}
            </nav>
          ) : <p className="px-2 py-3 text-sm text-muted-foreground">What every department needs — review it, buy it, give the final approval.</p>}
          <p className="hidden px-2 text-xs text-muted-foreground md:block">
            {tab === "new" && me.asker ? "Tap the pictures · check the list · send it to the manager" : "Open a request to see it, work on it, print or save it"}
          </p>
        </div>
      </header>

      {sentBackToMe > 0 && tab === "new" && (
        <button type="button" onClick={() => { setTab("requests"); setFilter(null); }}
          className="flex w-full items-center gap-3 rounded-2xl border border-orange-500/40 bg-orange-500/[0.07] px-4 py-3 text-left text-sm">
          <CornerUpLeft className="size-4 shrink-0 text-orange-500" />
          <span className="flex-1">{sentBackToMe === 1 ? "One of your requests was" : `${sentBackToMe} of your requests were`} sent back to you — change it and send it again.</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      )}

      {me.asker && tab === "new" ? (
        <NewRequest kitchen={kitchen} drinks={drinks} storeItems={storeItems} departments={departments} defaultDepartment={defaultDepartment}
          pics={pics} me={me.name} hotel={hotel} onSent={() => setTab("requests")} />
      ) : (
        <Requests open={open} closed={closed} me={me} active={active} clearFilter={() => setFilter(null)} summary={summary} options={options}
          kitchen={kitchen} drinks={drinks} storeItems={storeItems} departments={departments} pics={pics} hotel={hotel} today={today} />
      )}
    </div>
  );
}

/* ─────────────── The requests: open first (urgent on top), then the finished ones ─────────────── */

function Requests({ open, closed, me, active, clearFilter, summary, options, kitchen, drinks, storeItems, departments, pics, hotel, today }: {
  open: StockReqView[]; closed: StockReqView[]; me: Viewer; active: Counter | null; clearFilter: () => void;
  summary: PurchasingSummaryView | null; options: PurchaseOptionsView | null; kitchen: StockGroup[]; drinks: StockGroup[]; storeItems: StoreItem[];
  departments: DepartmentOption[]; pics: ReturnType<typeof picsFor>; hotel: string; today: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const money = me.reviewer || me.buyer;
  const keep = (r: StockReqView) => !active || active.statuses.includes(r.status);
  const openList = open.filter(keep);
  const doneList = closed.filter(keep);
  const opened = [...open, ...closed].find((r) => r.id === openId) ?? null;
  const toBuy = open.filter((r) => r.status === "APPROVED" || r.status === "PURCHASING");
  const groups = useMemo(() => (opened ? groupsFor(opened.department, opened.departmentId, kitchen, drinks, storeItems, departments) : []), [opened, kitchen, drinks, storeItems, departments]);

  return (
    <div className="space-y-4">
      {money && summary && <Spending summary={summary} />}
      {money && toBuy.length > 0 && !active && <ShoppingList open={toBuy} />}
      <section className="rounded-3xl border border-border/70 bg-card p-2 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2 pt-1">
          <h2 className="text-sm font-semibold">
            {active ? <>Showing: {active.label}</> : <>Open · {openList.length}</>}
          </h2>
          {active
            ? <Button size="sm" variant="ghost" onClick={clearFilter}>Show all</Button>
            : <span className="text-xs text-muted-foreground">Tap a request to see it{money ? " and work on it" : ""}</span>}
        </div>
        {openList.length === 0 && doneList.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{active ? "Nothing here right now." : me.asker && !money ? "You have not asked for anything yet." : "No requests yet."}</p>
        ) : (
          <>
            {openList.length > 0 ? <RequestRows list={openList} me={me} onOpen={setOpenId} />
              : !active && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing waiting — all requests are done.</p>}
            {doneList.length > 0 && (
              <>
                <p className="mt-3 border-t border-border/60 px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Finished</p>
                <RequestRows list={doneList} me={me} onOpen={setOpenId} />
              </>
            )}
          </>
        )}
      </section>
      {opened && (
        <RequestDialog key={opened.id} r={opened} me={me} groups={groups} pics={pics} hotel={hotel} today={today} options={options} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function RequestRows({ list, me, onOpen }: { list: StockReqView[]; me: Viewer; onOpen: (id: string) => void }) {
  const money = me.reviewer || me.buyer;
  return (
    <ul className="divide-y divide-border/50">
      {list.map((r) => {
        const summary = r.lines.slice(0, 3).map((i) => `${i.name} ${num(toBuyQty(i))} ${i.unit}`).join(" · ") + (r.lines.length > 3 ? ` · +${r.lines.length - 3} more` : "");
        const live = OPEN_STATUSES.includes(r.status);
        const amount = money ? r.purchase?.expense?.amount ?? r.purchase?.total ?? null : null;
        return (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)} className={cn("flex w-full items-center gap-3 rounded-2xl px-2.5 py-3 text-left transition hover:bg-muted/50", !live && "opacity-80")}>
              <DeptBadge code={r.department} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                  <span className="font-mono">{r.number}</span>
                  <span className="text-xs font-medium text-muted-foreground">{r.departmentName}</span>
                  {r.urgent && live && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-300"><Flame className="size-3" />Urgent</span>}
                  {live && yourTurn(r, me) && <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">Your turn</span>}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
              </span>
              <span className="hidden shrink-0 text-right text-[11px] leading-tight text-muted-foreground md:block">
                {person(r.by)}<span className="block">{when(r.at)}</span>
              </span>
              {amount != null && amount > 0 && <span className="hidden shrink-0 text-sm font-semibold tabular-nums sm:block">{formatTZS(amount)}</span>}
              <StatusChip status={r.status} />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** What stock purchases cost — the purchases' own expenses, already in the ledger (never added twice). */
function Spending({ summary }: { summary: PurchasingSummaryView }) {
  const top = summary.byDepartment.slice(0, 6);
  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-3xl border border-border/70 bg-card px-4 py-3 sm:px-5">
      <span className="flex items-center gap-2 text-sm font-semibold"><Coins className="size-4 text-amber-500" />Spent on stock</span>
      <span className="text-sm"><span className="text-muted-foreground">Today </span><span className="font-semibold tabular-nums">{formatTZS(summary.spentToday)}</span></span>
      <span className="text-sm"><span className="text-muted-foreground">This month </span><span className="font-semibold tabular-nums">{formatTZS(summary.spentMonth)}</span></span>
      {top.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {top.map((d) => (
            <span key={d.name} className="rounded-full bg-muted/60 px-2.5 py-1 text-[11.5px]">{d.name} <span className="font-semibold tabular-nums">{formatTZS(d.amount)}</span></span>
          ))}
        </span>
      )}
      <span className="basis-full text-[11px] text-muted-foreground">From the approved purchases&apos; expenses — the same money the ledger shows, never added twice.</span>
    </section>
  );
}

/** For the manager and the buyer: everything approved and not yet bought, added up — the approved amounts. */
function ShoppingList({ open }: { open: StockReqView[] }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => {
    const m = new Map<string, { name: string; unit: string; quantity: number; urgent: boolean }>();
    for (const r of open) for (const i of r.lines) {
      const k = `${norm(i.name)}|${i.unit}`;
      const x = m.get(k) ?? { name: i.name, unit: i.unit, quantity: 0, urgent: false };
      x.quantity += toBuyQty(i); x.urgent ||= r.urgent;
      m.set(k, x);
    }
    return [...m.values()].filter((l) => l.quantity > 0).sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.name.localeCompare(b.name));
  }, [open]);
  const text = () => `Shopping list — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}\n${lines.map((l) => `• ${l.name}: ${num(l.quantity)} ${l.unit}${l.urgent ? " (urgent)" : ""}`).join("\n")}`;
  const copy = () => navigator.clipboard?.writeText(text()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); toast.success("Shopping list copied."); }).catch(() => {});
  return (
    <section className="rounded-3xl border border-amber-500/30 bg-amber-500/[0.05] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><ClipboardList className="size-4 text-amber-500" />Shopping list</h2>
          <p className="text-xs text-muted-foreground">Everything approved and not yet bought · {open.length} request{open.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</Button>
          <Button size="sm" variant="outline" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text())}`, "_blank", "noopener")}><MessageCircle />WhatsApp</Button>
        </div>
      </div>
      <ul className="mt-3 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
        {lines.map((l) => (
          <li key={`${l.name}|${l.unit}`} className="flex items-baseline justify-between gap-3 border-b border-border/50 py-1.5 text-sm">
            <span className="min-w-0 truncate">{l.urgent && <Flame className="-mt-0.5 mr-1 inline size-3.5 text-rose-400" />}{l.name}</span>
            <span className="shrink-0 font-semibold tabular-nums">{num(l.quantity)} {l.unit}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
