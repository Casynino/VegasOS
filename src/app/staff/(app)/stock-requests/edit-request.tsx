"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Flame, Loader2, MessageSquareText, Plus, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toBuyQty, type StockReqView } from "@/lib/stock-requests";
import { editStockRequestAction, resubmitStockRequestAction } from "./actions";
import { Pic, norm, type Row, type Tile, type TileGroup } from "./parts";
import { RowsEditor } from "./new-request";
import { useT } from "@/i18n/client";

/**
 * Change a request's list. The manager ("review") changes the amounts approved — items added or
 * taken off — and always says why. The person who asked ("resend"), once it was sent back to them,
 * changes what they ask for and sends it again. Lines keep their identity.
 */
export function EditRequest({ r, mode, groups, pics, onDone, onCancel }: {
  r: StockReqView; mode: "review" | "resend"; groups: TileGroup[]; pics: Map<string, Tile>; onDone: () => void; onCancel: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<Row[]>(() => r.lines.map((l, n) => ({
    // The manager changes amounts, not what was asked for — only the person who asked renames their own items.
    key: n + 1, id: l.id, name: l.name, quantity: String(mode === "review" ? toBuyQty(l) : l.quantity), unit: l.unit, custom: mode === "resend" && !pics.has(l.name), stockId: l.stockItem?.id ?? null,
  })));
  const [next, setNext] = useState(r.lines.length + 1);
  const [urgent, setUrgent] = useState(r.urgent);
  const [note, setNote] = useState(r.note ?? "");
  const [why, setWhy] = useState("");
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const needle = norm(q.trim());
  const seen = new Set<string>();
  const found = needle ? groups.flatMap((g) => g.items).filter((i) => (norm(i.name).includes(needle) || norm(t(i.name)).includes(needle)) && !seen.has(i.name) && seen.add(i.name)).slice(0, 8) : [];
  const addItem = (i: Pick<Tile, "name" | "unit" | "stockId">, custom: boolean) => {
    const have = rows.find((x) => x.name === i.name);
    if (have) setRows((rs) => rs.map((x) => (x.key === have.key ? { ...x, quantity: String((Number(x.quantity) || 0) + 1), stockId: i.stockId ?? x.stockId ?? null } : x)));
    else { setRows((rs) => [{ key: next, name: i.name, quantity: "1", unit: i.unit, custom, stockId: i.stockId ?? null }, ...rs]); setNext((n) => n + 1); }
    setQ("");
  };
  const ready = rows.filter((x) => x.name.trim() && Number(x.quantity) > 0);
  const needsWhy = mode === "review" && why.trim().length < 3;
  const save = () => start(async () => {
    const res = await editStockRequestAction({
      id: r.id, urgent, note: note.trim(), reason: mode === "review" ? why.trim() : undefined,
      items: ready.map((x) => ({ id: x.id ?? null, name: x.name.trim(), quantity: Number(x.quantity), unit: x.unit, inventoryItemId: x.stockId ?? null })),
    });
    if (!res.ok) { toast.error(res.error); return; }
    if (mode === "resend") {
      const again = await resubmitStockRequestAction({ id: r.id });
      if (!again.ok) { toast.error(again.error); return; }
      toast.success(t("{number} changed and sent to the manager again.", { number: r.number }));
    } else toast.success(t("Request updated — the approved amounts are changed."));
    onDone();
  });
  return (
    <div className="space-y-3 px-5 pb-5">
      <p className="text-xs text-muted-foreground">
        {mode === "review" ? t("Change the amounts to buy, take items off or add some. What was asked stays in the history.") : t("Change what you ask for, then send it to the manager again.")}
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Add an item — search the list…")} className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-base sm:text-sm" />
        {needle && (
          <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
            {found.map((i) => (
              <button key={i.name} type="button" onClick={() => addItem(i, false)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted">
                <Pic item={i} className="size-7 rounded-md text-base" />{t(i.name)}<span className="ml-auto text-xs text-muted-foreground">{t("by {unit}", { unit: t(i.unit) })}</span>
              </button>
            ))}
            <button type="button" onClick={() => addItem({ name: q.trim(), unit: "pcs" }, true)} className="flex w-full items-center gap-2.5 border-t border-border/60 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted">
              <Plus className="size-4" />{t("Add “{name}”", { name: q.trim() })}
            </button>
          </div>
        )}
      </div>
      <div className="rounded-2xl border border-border/70 px-3">
        {rows.length ? <RowsEditor rows={rows} setRows={setRows} pics={pics} /> : <p className="py-6 text-center text-sm text-muted-foreground">{mode === "review" ? t("No items — add one, or reject the request.") : t("No items — add one, or cancel the request.")}</p>}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button type="button" onClick={() => setUrgent((u) => !u)} aria-pressed={urgent}
          className={cn("flex h-10 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold", urgent ? "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-300" : "border-border text-muted-foreground")}>
          <Flame className="size-4" />{urgent ? t("Urgent") : t("Not urgent")}
        </button>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t("A note")} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-base sm:text-sm" />
      </div>
      {mode === "review" && (
        <label className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-3">
          <MessageSquareText className="size-4 shrink-0 text-amber-500" />
          <input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} placeholder={t("Why do you change it? e.g. We still have 10 kg in the store")}
            className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/80 sm:text-sm" />
        </label>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button variant="ghost" className="h-11" onClick={onCancel}>{t("Cancel")}</Button>
        <Button className="h-11" disabled={pending || !ready.length || needsWhy} onClick={save}>
          {pending ? <Loader2 className="animate-spin" /> : mode === "resend" ? <Send /> : <Check />}{mode === "resend" ? t("Send again to the manager") : t("Save changes")}
        </Button>
      </div>
    </div>
  );
}
