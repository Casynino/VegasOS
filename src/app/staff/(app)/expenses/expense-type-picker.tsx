"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, Check, ChevronRight, History, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { expenseLook } from "@/lib/expense-look";
import { FREQUENCY_LABEL, type ExpenseFrequency } from "@/lib/expense-catalog";
import type { ExpenseTypes } from "@/server/services/expenses";

export type PickedType =
  | { kind: "item"; id: string; name: string; group: string; groupId: string; icon: string | null; payee: string | null; amount: number | null }
  | { kind: "new"; name: string; group: string; groupId: string; icon: string | null; frequency: ExpenseFrequency };

type Group = ExpenseTypes["groups"][number];
type Item = Group["items"][number] & { group: Group };

/**
 * Step 1 of recording an expense — "What did you pay for?"
 * One search box, then two quiet columns: groups on the left ("Used most" first),
 * that group's expenses on the right. Not there? Add it — saved for next time.
 */
export function ExpenseTypePicker({ types, onPick }: { types: ExpenseTypes; onPick: (v: PickedType) => void }) {
  const [q, setQ] = useState("");
  const all = useMemo<Item[]>(() => types.groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g }))), [types]);
  const recent = types.mostUsed.map((id) => all.find((i) => i.id === id)).filter((x): x is Item => !!x);
  const [groupId, setGroupId] = useState<string>(recent.length ? "recent" : types.groups[0]?.id ?? "");
  const [adding, setAdding] = useState<{ name: string; groupId: string } | null>(null);
  const pick = (i: Item) => onPick({ kind: "item", id: i.id, name: i.name, group: i.group.name, groupId: i.group.id, icon: i.group.icon, payee: i.payee, amount: i.amount });
  const needle = q.trim().toLowerCase();

  if (adding) {
    return <NewType types={types} initial={adding} onBack={() => setAdding(null)}
      onDone={(name, gid, frequency) => { const g = types.groups.find((x) => x.id === gid)!; onPick({ kind: "new", name, group: g.name, groupId: gid, icon: g.icon, frequency }); }} />;
  }

  const group = types.groups.find((g) => g.id === groupId) ?? null;
  const shown = needle
    ? all.filter((i) => i.name.toLowerCase().includes(needle) || (i.payee ?? "").toLowerCase().includes(needle) || i.group.name.toLowerCase().includes(needle))
    : groupId === "recent" ? recent : all.filter((i) => i.group.id === groupId);
  const navItem = (id: string, label: string, icon: React.ReactNode, count: number) => (
    <button key={id} type="button" onClick={() => { setGroupId(id); setQ(""); }} aria-pressed={!needle && groupId === id}
      className={cn("flex w-full shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition md:w-auto",
        !needle && groupId === id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      {icon}<span className="flex-1 truncate font-medium">{label}</span><span className="text-[11px] opacity-60">{count}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search — DAWASA, fuel, salaries, Netflix…"
          className="h-12 w-full rounded-2xl border border-border bg-muted/40 pl-11 pr-10 text-[15px] outline-none transition focus:border-foreground/30 focus:bg-background" />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="size-3.5" /></button>}
      </div>

      <div className="grid overflow-hidden rounded-2xl border border-border/80 md:grid-cols-[15.5rem_minmax(0,1fr)]">
        {/* Groups: a column on wide screens, a sliding row on phones */}
        <nav aria-label="Expense groups" className="flex gap-1 overflow-x-auto border-b border-border/70 bg-muted/20 p-1.5 md:max-h-[22rem] md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
          {recent.length > 0 && navItem("recent", "Used most", <History className="size-4 shrink-0" />, recent.length)}
          {types.groups.map((g) => {
            const { icon: Icon } = expenseLook(g.icon);
            return navItem(g.id, g.name, <Icon className="size-4 shrink-0" />, g.items.length);
          })}
        </nav>

        {/* Expenses in the group (or search results) */}
        <div className="flex max-h-[22rem] min-h-[14rem] flex-col">
          <p className="border-b border-border/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {needle ? `${shown.length} match${shown.length === 1 ? "" : "es"}` : groupId === "recent" ? "Used most" : group?.name}
          </p>
          <ul className="flex-1 overflow-y-auto">
            {shown.map((i) => {
              const { icon: Icon, tone } = expenseLook(i.group.icon);
              return (
                <li key={i.id}>
                  <button type="button" onClick={() => pick(i)} className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-muted/60">
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", tone)}><Icon className="size-3.5" /></span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-medium">{i.name}</span>
                      {(needle || groupId === "recent" || i.payee) && <span className="text-[11px] text-muted-foreground">{[(needle || groupId === "recent") && i.group.name, i.payee && `to ${i.payee}`].filter(Boolean).join(" · ")}</span>}
                    </span>
                    {i.frequency === "MONTHLY" && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300"><CalendarClock className="size-3" />Monthly</span>}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </button>
                </li>
              );
            })}
            {needle && shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing called “{q.trim()}” yet.</li>}
          </ul>
          <button type="button" onClick={() => setAdding({ name: needle ? q.trim() : "", groupId: !needle && groupId !== "recent" ? groupId : "" })}
            className="flex items-center gap-2 border-t border-border/60 px-4 py-2.5 text-left text-sm font-medium text-muted-foreground transition hover:bg-muted/50 hover:text-foreground">
            <Plus className="size-4" />{needle ? `Add “${q.trim()}” as a new expense` : "Something else — add a new expense"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewType({ types, initial, onBack, onDone }: { types: ExpenseTypes; initial: { name: string; groupId: string }; onBack: () => void; onDone: (name: string, groupId: string, f: ExpenseFrequency) => void }) {
  const [name, setName] = useState(initial.name);
  const [groupId, setGroupId] = useState(initial.groupId);
  const [frequency, setFrequency] = useState<ExpenseFrequency>("OCCASIONAL");
  const ok = name.trim().length >= 2 && !!groupId;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back" className="grid size-9 place-items-center rounded-xl border border-border hover:bg-muted"><ArrowLeft className="size-4" /></button>
        <div className="leading-tight"><p className="font-semibold">New expense</p><p className="text-xs text-muted-foreground">Saved to the list, so next time you just pick it.</p></div>
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Name, e.g. Swimming pool chemicals"
        className="h-12 w-full rounded-2xl border border-border bg-muted/40 px-4 text-[15px] outline-none focus:border-foreground/30 focus:bg-background" />
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Which group?</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {types.groups.map((g) => {
            const { icon: Icon, tone } = expenseLook(g.icon);
            const on = groupId === g.id;
            return (
              <button key={g.id} type="button" onClick={() => setGroupId(g.id)} aria-pressed={on}
                className={cn("flex items-center gap-2 rounded-xl border p-2 text-left text-[13px] font-medium leading-tight transition", on ? "border-foreground bg-foreground/[0.04] ring-1 ring-foreground" : "border-border hover:bg-muted/60")}>
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", tone)}><Icon className="size-3.5" /></span>{g.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">How often is it paid?</p>
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-muted/60 p-1">
          {(["DAILY", "MONTHLY", "OCCASIONAL"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFrequency(f)} aria-pressed={frequency === f}
              className={cn("rounded-xl py-2 text-sm font-medium transition", frequency === f ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{FREQUENCY_LABEL[f]}</button>
          ))}
        </div>
        {frequency === "MONTHLY" && <p className="text-xs text-muted-foreground">It will appear on the monthly bills checklist.</p>}
      </div>
      <button type="button" disabled={!ok} onClick={() => onDone(name.trim(), groupId, frequency)}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-sm font-semibold text-background transition disabled:opacity-40">
        <Check className="size-4" />Continue
      </button>
    </div>
  );
}
