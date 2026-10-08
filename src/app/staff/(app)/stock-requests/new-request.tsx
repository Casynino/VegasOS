"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChefHat, ChevronDown, ClipboardList, Flame, Loader2, Minus, Pencil, Plus, Search, Send, StickyNote, Target, Trash2, Wine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { STOCK_UNITS, type StockGroup } from "@/lib/stock-catalog";
import type { DepartmentOption, StoreItem } from "@/lib/stock-requests";
import { createStockRequestAction } from "./actions";
import { DeptIcon, Pic, norm, storeGroup, type Row, type Tile, type TileGroup } from "./parts";
import { StockSheet, SheetTools, type SheetLine } from "./sheet";
import { useT } from "@/i18n/client";

/** The tile groups in the order a department wants them: the bar its drinks, others their stores first. */
export function groupsFor(code: string, deptId: string | null, kitchen: StockGroup[], drinks: StockGroup[], storeItems: StoreItem[], departments: DepartmentOption[]): TileGroup[] {
  const stores = storeGroup(storeItems, departments.find((d) => d.id === deptId) ?? null, [...kitchen, ...drinks]);
  const s = stores ? [stores] : [];
  if (code === "KITCHEN" || code === "RESTAURANT") return [...kitchen, ...drinks, ...s];
  if (code === "BAR") return [...drinks, ...s, ...kitchen];
  // Housekeeping, maintenance, reception…: their own stock items, then the everyday supplies, then the rest.
  return [...s, ...kitchen.filter((g) => g.key === "supplies"), ...kitchen.filter((g) => g.key !== "supplies"), ...drinks];
}

/* ─────────────── A new request: pick, check, send ─────────────── */

export function NewRequest({ kitchen, drinks, storeItems, departments, defaultDepartment, pics, me, hotel, onSent }: {
  kitchen: StockGroup[]; drinks: StockGroup[]; storeItems: StoreItem[]; departments: DepartmentOption[]; defaultDepartment: string;
  pics: Map<string, Tile>; me: string; hotel: string; onSent: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [dept, setDept] = useState(defaultDepartment);
  const deptObj = departments.find((d) => d.code === dept) ?? null;
  const shownGroups = useMemo(() => groupsFor(dept, deptObj?.id ?? null, kitchen, drinks, storeItems, departments), [dept, deptObj, kitchen, drinks, storeItems, departments]);
  const [group, setGroup] = useState<string>(shownGroups[0]?.key ?? "");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState(1);
  const [urgent, setUrgent] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [pending, start] = useTransition();

  const quick = departments.filter((d) => d.code === "KITCHEN" || d.code === "BAR");
  const others = departments.filter((d) => d.code !== "KITCHEN" && d.code !== "BAR");
  const choose = (code: string) => {
    setDept(code);
    const d = departments.find((x) => x.code === code);
    setGroup(groupsFor(code, d?.id ?? null, kitchen, drinks, storeItems, departments)[0]?.key ?? "");
  };

  const current = shownGroups.find((x) => x.key === group) ?? shownGroups[0];
  const needle = norm(q.trim());
  const items: (Tile & { group: string })[] = needle
    ? shownGroups.flatMap((x) => x.items.filter((i) => norm(i.name).includes(needle) || norm(t(i.name)).includes(needle)).map((i) => ({ ...i, group: x.key })))
    : (current?.items ?? []).map((i) => ({ ...i, group: current!.key }));
  const inList = (name: string) => rows.find((r) => !r.custom && r.name === name);

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = (i: Tile) => {
    const have = inList(i.name);
    if (have) { set(have.key, { quantity: String((Number(have.quantity) || 0) + 1), stockId: i.stockId ?? have.stockId ?? null }); return; }
    setRows((rs) => [{ key: next, name: i.name, quantity: "1", unit: i.unit, custom: false, stockId: i.stockId ?? null }, ...rs]);
    setNext((n) => n + 1);
  };
  const custom = () => { setRows((rs) => [{ key: next, name: "", quantity: "1", unit: "pcs", custom: true }, ...rs]); setNext((n) => n + 1); };
  const ready = rows.filter((r) => r.name.trim() && Number(r.quantity) > 0);
  const lines: SheetLine[] = ready.map((r) => ({ name: r.name.trim(), quantity: Number(r.quantity), unit: r.unit }));
  const send = () => start(async () => {
    const res = await createStockRequestAction({
      department: dept, urgent, reason: reason.trim() || undefined, note: note.trim() || undefined,
      items: ready.map((r) => ({ name: r.name.trim(), quantity: Number(r.quantity), unit: r.unit, inventoryItemId: r.stockId ?? null })),
    });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(t("{number} sent — it is waiting for the manager.", { number: res.data.number }));
    setRows([]); setUrgent(false); setReason(""); setNote(""); setReviewing(false);
    router.refresh();
    onSent();
  });
  const deptName = deptObj?.name ?? "Kitchen";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
      {/* ── The list to pick from ── */}
      <section className="min-w-0 rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Who it is for: the kitchen and the bar at a tap, every other department in one small list */}
          <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-xl bg-muted p-1">
            {quick.map((d) => (
              <button key={d.code} type="button" onClick={() => choose(d.code)} aria-pressed={dept === d.code}
                className={cn("flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition", dept === d.code ? "bg-background shadow-sm" : "text-muted-foreground")}>
                {d.code === "KITCHEN" ? <ChefHat className="size-4" /> : <Wine className="size-4" />}{t(d.name)}
              </button>
            ))}
            {others.length > 0 && (
              <label className={cn("relative flex items-center rounded-lg transition", others.some((d) => d.code === dept) ? "bg-background shadow-sm" : "text-muted-foreground")}>
                {others.some((d) => d.code === dept) && <DeptIcon code={dept} className="pointer-events-none absolute left-2.5 size-4" />}
                <select value={others.some((d) => d.code === dept) ? dept : ""} onChange={(e) => e.target.value && choose(e.target.value)} aria-label={t("Other department")}
                  className={cn("h-8 appearance-none rounded-lg bg-transparent pr-7 text-sm font-medium outline-none", others.some((d) => d.code === dept) ? "pl-8" : "pl-3")}>
                  <option value="" disabled>{t("Other department…")}</option>
                  {others.map((d) => <option key={d.code} value={d.code}>{t(d.name)}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 size-3.5 opacity-70" />
              </label>
            )}
          </div>
          <label className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search — rice, chicken, Safari, gas…")} className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-base sm:text-sm" />
          </label>
        </div>
        {!needle && (
          <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {shownGroups.map((x) => (
              <button key={x.key} type="button" onClick={() => setGroup(x.key)}
                className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition", current?.key === x.key ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:text-foreground")}>
                <span aria-hidden className="text-sm leading-none">{x.emoji}</span>{t(x.name)}
              </button>
            ))}
          </div>
        )}
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-8">
          {items.map((i) => {
            const have = inList(i.name);
            return (
              <li key={`${i.group}-${i.name}`}>
                <button type="button" onClick={() => add(i)} title={i.stockId ? t("{name} · by {unit} · kept in the stores", { name: t(i.name), unit: t(i.unit) }) : t("{name} · by {unit}", { name: t(i.name), unit: t(i.unit) })}
                  className={cn("group relative flex w-full flex-col overflow-hidden rounded-2xl border text-left transition active:scale-[0.97]", have ? "border-amber-400/70 bg-amber-500/10" : "border-border/70 bg-background/40 hover:border-foreground/25")}>
                  <Pic item={i} className="aspect-[4/3] w-full text-[34px]" />
                  <span className="block px-2 pb-2 pt-1.5 leading-tight">
                    <span className="line-clamp-2 min-h-[2.2em] text-[12px] font-medium">{t(i.name)}</span>
                    <span className="text-[10.5px] text-muted-foreground">{t("by {unit}", { unit: t(i.unit) })}</span>
                  </span>
                  <span className={cn("absolute right-1.5 top-1.5 grid min-w-6 place-items-center rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums shadow",
                    have ? "bg-amber-400 text-black" : "bg-black/55 text-white opacity-0 transition group-hover:opacity-100")}>
                    {have ? have.quantity : <Plus className="size-3.5" />}
                  </span>
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={custom} className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <Plus className="size-5" />{t.ctx("stock", "Something else")}
            </button>
          </li>
        </ul>
        {items.length === 0 && <p className="mt-2 text-center text-sm text-muted-foreground">{t("Not in the list — add it as “Something else”.")}</p>}
      </section>

      {/* ── Your list: it scrolls on its own; urgent, what it is for, the note and "Check the list" stay in view ── */}
      <section className="flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-card xl:sticky xl:top-4 xl:max-h-[calc(100svh-6rem)]">
        <div className="flex items-baseline justify-between border-b border-border/60 px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-base font-semibold"><ClipboardList className="size-4 text-amber-400" />{t("Your list")}</h2>
          <span className="text-xs text-muted-foreground">{t.plural(ready.length, "{n} item", "{n} items")} · {t(deptName)}</span>
        </div>
        <div className="max-h-[360px] min-h-0 flex-1 overflow-y-auto px-4 sm:px-5 xl:max-h-none [scrollbar-width:thin]">
          {rows.length === 0
            ? <p className="my-4 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{t("Tap the pictures to add them here.")}</p>
            : <RowsEditor rows={rows} setRows={setRows} pics={pics} />}
        </div>
        <div className="space-y-3 border-t border-border/60 px-4 py-4 sm:px-5">
          <div className={cn("overflow-hidden rounded-2xl border bg-background/50 transition-colors", urgent ? "border-rose-500/50" : "border-border/80")}>
            <button type="button" onClick={() => setUrgent((u) => !u)} role="switch" aria-checked={urgent} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full transition-colors", urgent ? "bg-rose-500/15 text-rose-500 dark:text-rose-300" : "bg-muted text-muted-foreground")}><Flame className="size-4" /></span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-sm font-medium">{t("Urgent")}</span>
                <span className="block text-[11.5px] text-muted-foreground">{urgent ? t("The manager sees it first") : t("Normal — on the next shopping")}</span>
              </span>
              <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", urgent ? "bg-rose-500" : "bg-muted-foreground/30")}>
                <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", urgent ? "left-[18px]" : "left-0.5")} />
              </span>
            </button>
            <label className="flex items-center gap-3 border-t border-border/60 px-3.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><Target className="size-4" /></span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t("What is it for? (optional)")} className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 sm:text-sm" />
            </label>
            <label className="flex items-center gap-3 border-t border-border/60 px-3.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><StickyNote className="size-4" /></span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t("Note for the manager (optional)")} className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 sm:text-sm" />
            </label>
          </div>
          <Button className="h-12 w-full text-[15px]" disabled={ready.length === 0} onClick={() => setReviewing(true)}><ClipboardList />{ready.length ? t.plural(ready.length, "Check the list · {n} item", "Check the list · {n} items") : t("Check the list")}</Button>
        </div>
      </section>

      {/* ── Check before sending: print or download it, change it, or send it ── */}
      <Dialog open={reviewing} onOpenChange={setReviewing}>
        <DialogContent className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out. */}
          <DialogHeader icon={<ClipboardList />} eyebrow={t("Stock request")} tone="amber" className="mx-0 mt-0">
            <DialogTitle>{t("Check your list")}</DialogTitle>
            <DialogDescription>{t("Print it or save it if you like — then send it to the manager.")}</DialogDescription>
          </DialogHeader>
          <div className="bg-muted/30 p-3 sm:p-5">
            <StockSheet id="stock-sheet-new" hotel={hotel} number={null} deptName={deptName} by={me} at={new Date().toISOString()} urgent={urgent}
              reason={reason.trim() || null} note={note.trim() || null} lines={lines} pics={pics} />
          </div>
          <div className="sticky bottom-0 space-y-2 border-t border-border/70 bg-popover/95 px-5 py-4 backdrop-blur">
            <SheetTools target="stock-sheet-new" fileName={`stock-request-${dept.toLowerCase()}`} />
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button variant="outline" className="h-11" onClick={() => setReviewing(false)}><Pencil />{t("Change it")}</Button>
              <Button className="h-11" disabled={pending || !lines.length} onClick={send}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{t.plural(lines.length, "Send {n} item to the manager", "Send {n} items to the manager")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The rows of a list: picture, name, − amount +, unit, remove. */
export function RowsEditor({ rows, setRows, pics }: { rows: Row[]; setRows: React.Dispatch<React.SetStateAction<Row[]>>; pics: Map<string, Tile> }) {
  const t = useT();
  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const step = (r: Row, d: number) => {
    const v = Math.round(((Number(r.quantity) || 0) + d) * 100) / 100;
    if (v <= 0) setRows((rs) => rs.filter((x) => x.key !== r.key)); else set(r.key, { quantity: String(v) });
  };
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((r) => {
        const item = pics.get(r.name);
        return (
          <li key={r.key} className="flex items-center gap-2.5 py-2">
            {item ? <Pic item={item} className="size-9 shrink-0 rounded-lg text-lg" /> : <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground"><Plus className="size-4" /></span>}
            {r.custom
              ? <input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder={t("What is it?")} autoFocus className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm" />
              : <span className="min-w-0 flex-1 truncate text-sm font-medium">{t(r.name)}</span>}
            <span className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border">
              <button type="button" onClick={() => step(r, -1)} aria-label={t("Less {name}", { name: t(r.name) })} className="grid h-full w-7 place-items-center text-muted-foreground hover:text-foreground">{Number(r.quantity) <= 1 ? <Trash2 className="size-3.5" /> : <Minus className="size-3.5" />}</button>
              <input value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" aria-label={t("How many")}
                className="h-full w-9 bg-transparent text-center text-sm font-semibold tabular-nums outline-none" />
              <button type="button" onClick={() => step(r, 1)} aria-label={t("More {name}", { name: t(r.name) })} className="grid h-full w-7 place-items-center text-muted-foreground hover:text-foreground"><Plus className="size-3.5" /></button>
            </span>
            <select value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value })} aria-label={t("Unit")} className="h-8 w-[74px] shrink-0 rounded-lg border border-border bg-background px-1 text-xs">
              {[...new Set([r.unit, ...STOCK_UNITS])].map((u) => <option key={u} value={u}>{t(u)}</option>)}
            </select>
          </li>
        );
      })}
    </ul>
  );
}
