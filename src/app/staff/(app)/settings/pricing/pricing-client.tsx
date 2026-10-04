"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgePercent, CalendarRange, Loader2, Pencil, Plus, Power } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTZS } from "@/lib/format";
import { priceNight, WEEKDAYS, type PriceRuleLite, type PromoRule } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { saveDiscountRulesAction, savePriceRuleAction, savePromotionAction, setPriceRuleActiveAction, setPromotionActiveAction, updateRoomPriceAction } from "./actions";

export type PricingType = { id: string; name: string; baseRate: number; rooms: { id: string; number: string }[] };
export type PromotionData = {
  id?: string; name: string; type: "PERCENT" | "FIXED"; value: number; scope: "ALL" | "ROOM_TYPES" | "ROOMS";
  roomTypeIds: string[]; roomIds: string[]; channel: "ALL" | "WEBSITE" | "STAFF"; startDate: string; endDate: string; isActive: boolean;
  daysOfWeek: number[]; priority: number | null;
};
export type PriceRuleData = {
  id?: string; name: string; scope: "ALL" | "ROOM_TYPES" | "ROOMS"; roomTypeIds: string[]; roomIds: string[]; price: number;
  startDate: string; endDate: string; daysOfWeek: number[]; priority: number | null; isActive: boolean;
};
/** What is already running, so the preview shows the real price on each date. */
export type PricingContext = { today: string; promos: PromoRule[]; rules: PriceRuleLite[] };

/** Current price of one room type, with an inline editor. */
export function PriceEditor({ type }: { type: PricingType }) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted">
        <Pencil className="size-3" />Edit price
      </button>
    );
  }
  return (
    <ActionForm action={updateRoomPriceAction} onSuccess={() => { setEditing(false); router.refresh(); }} className="flex flex-wrap items-start gap-2">
      {({ pending, fieldErrors: e }) => (
        <>
          <input type="hidden" name="roomTypeId" value={type.id} />
          <div>
            <Input name="baseRate" type="number" min={1000} step={1000} defaultValue={type.baseRate} autoFocus aria-label={`New price for ${type.name}`} className="h-8 w-32 tabular-nums" />
            <FieldError message={e?.baseRate} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </>
      )}
    </ActionForm>
  );
}

const EMPTY: PromotionData = { name: "", type: "PERCENT", value: 10, scope: "ALL", roomTypeIds: [], roomIds: [], channel: "ALL", startDate: "", endDate: "", isActive: true, daysOfWeek: [], priority: null };
const defaultPriority = (scope: string, rule = false) => (rule ? (scope === "ROOMS" ? 20 : 10) : scope === "ROOMS" ? 30 : scope === "ROOM_TYPES" ? 20 : 10);

/** "New promotion" / "Edit" button that opens the promotion builder. */
export function PromotionButton({ types, initial, label, context }: { types: PricingType[]; initial?: PromotionData; label?: string; context: PricingContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={initial ? "sm" : "default"} variant={initial ? "outline" : "default"} onClick={() => setOpen(true)}>
        {initial ? <Pencil /> : <Plus />}{label ?? (initial ? "Edit" : "New promotion")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader icon={<BadgePercent />} eyebrow="Pricing" tone="violet">
            <DialogTitle>{initial?.id ? "Edit promotion" : "Create a promotion"}</DialogTitle>
            <DialogDescription>Reception and the website pick it up automatically. Booked nights keep their price.</DialogDescription>
          </DialogHeader>
          {open && <PromotionBuilder types={types} initial={initial ?? EMPTY} context={context} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PromotionBuilder({ types, initial, onDone, context }: { types: PricingType[]; initial: PromotionData; onDone: () => void; context: PricingContext }) {
  const router = useRouter();
  const [p, setP] = useState<PromotionData>(initial);
  const [pending, start] = useTransition();
  const set = <K extends keyof PromotionData>(k: K, v: PromotionData[K]) => setP((x) => ({ ...x, [k]: v }));
  const toggle = (k: "roomTypeIds" | "roomIds", id: string) => set(k, p[k].includes(id) ? p[k].filter((x) => x !== id) : [...p[k], id]);

  const priority = p.priority ?? defaultPriority(p.scope);
  const candidate: PromoRule = {
    id: initial.id ?? "candidate", name: p.name || "This promotion", type: p.type, value: p.value || 0, scope: p.scope, roomTypeIds: p.roomTypeIds, roomIds: p.roomIds,
    channel: p.channel, startDate: p.startDate || null, endDate: p.endDate || null, daysOfWeek: p.daysOfWeek, priority,
  };

  function save() {
    start(async () => {
      const res = await savePromotionAction({ ...p, startDate: p.startDate || null, endDate: p.endDate || null, priority });
      if (res.ok) { toast.success(res.message ?? "Promotion saved."); onDone(); router.refresh(); }
      else toast.error(res.error, { duration: 9000 });
    });
  }

  const seg = (on: boolean) => cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", on ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground");
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="pr-name">Name</Label>
        <Input id="pr-name" value={p.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. September Promotion" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Discount</Label>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl bg-muted p-0.5">
              <button type="button" className={seg(p.type === "PERCENT")} onClick={() => set("type", "PERCENT")}>%</button>
              <button type="button" className={seg(p.type === "FIXED")} onClick={() => set("type", "FIXED")}>TZS</button>
            </div>
            <Input type="number" min={1} max={p.type === "PERCENT" ? 100 : undefined} step={p.type === "PERCENT" ? 1 : 1000} value={p.value || ""}
              onChange={(e) => set("value", Math.max(0, Math.round(Number(e.target.value) || 0)))} className="h-9 w-32 tabular-nums" aria-label="Discount value" />
            <span className="text-sm text-muted-foreground">{p.type === "PERCENT" ? "% off" : "off per night"}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Who gets it</Label>
          <div className="flex rounded-xl bg-muted p-0.5">
            {([["ALL", "Everyone"], ["STAFF", "Desk bookings"], ["WEBSITE", "Website only"]] as const).map(([v, l]) => (
              <button key={v} type="button" className={cn(seg(p.channel === v), "flex-1")} onClick={() => set("channel", v)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Applies to</Label>
        <div className="flex rounded-xl bg-muted p-0.5">
          {([["ALL", "All rooms"], ["ROOM_TYPES", "Room types"], ["ROOMS", "Single rooms"]] as const).map(([v, l]) => (
            <button key={v} type="button" className={cn(seg(p.scope === v), "flex-1")} onClick={() => set("scope", v)}>{l}</button>
          ))}
        </div>
        {p.scope === "ROOM_TYPES" && (
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => (
              <button key={t.id} type="button" aria-pressed={p.roomTypeIds.includes(t.id)} onClick={() => toggle("roomTypeIds", t.id)}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", p.roomTypeIds.includes(t.id) ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{t.name}</button>
            ))}
          </div>
        )}
        {p.scope === "ROOMS" && (
          <div className="space-y-2">
            {types.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-1.5">
                <span className="w-32 shrink-0 text-xs text-muted-foreground">{t.name}</span>
                {t.rooms.map((r) => (
                  <button key={r.id} type="button" aria-pressed={p.roomIds.includes(r.id)} onClick={() => toggle("roomIds", r.id)}
                    className={cn("h-8 min-w-12 rounded-lg border px-2 text-xs font-semibold tabular-nums", p.roomIds.includes(r.id) ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{r.number}</button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="pr-start">Valid from (first night)</Label><Input id="pr-start" type="date" value={p.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pr-end">Valid until (last night)</Label><Input id="pr-end" type="date" value={p.endDate} min={p.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <div className="flex rounded-xl bg-muted p-0.5">
            <button type="button" className={cn(seg(p.isActive), "flex-1")} onClick={() => set("isActive", true)}>On</button>
            <button type="button" className={cn(seg(!p.isActive), "flex-1")} onClick={() => set("isActive", false)}>Off</button>
          </div>
        </div>
      </div>
      <p className="-mt-2 text-[11px] text-muted-foreground">Every promotion has a first and a last night — it starts and stops by itself. A guest who changes dates gets the price of the new dates.</p>
      <DaysAndPriority days={p.daysOfWeek} onDays={(d) => set("daysOfWeek", d)} priority={priority} onPriority={(n) => set("priority", n)}
        hint="If two promotions cover the same night, the higher priority wins. Two with the same priority cannot overlap — the system will refuse to save." />

      <CalendarPreview types={types} context={context} scope={p.scope} roomTypeIds={p.roomTypeIds} roomIds={p.roomIds}
        start={p.startDate} end={p.endDate} channel={p.channel === "WEBSITE" ? "WEBSITE" : "STAFF"}
        withRule={(ps, rs) => ({ promos: [...ps.filter((x) => x.id !== candidate.id), ...(p.isActive ? [candidate] : [])], rules: rs })} />

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button onClick={save} disabled={pending || !p.name.trim() || !p.value || !p.startDate || !p.endDate}>{pending ? <Loader2 className="animate-spin" /> : <BadgePercent />}Save promotion</Button>
      </div>
    </div>
  );
}

export function PromotionSwitch({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending}
      onClick={() => start(async () => {
        const res = await setPromotionActiveAction({ id, isActive: !isActive });
        if (res.ok) { toast.success(res.message ?? "Saved."); router.refresh(); } else toast.error(res.error);
      })}>
      {pending ? <Loader2 className="animate-spin" /> : <Power />}{isActive ? "Switch off" : "Switch on"}
    </Button>
  );
}

export function DiscountRulesForm({ rules }: { rules: { manualDiscountMax: number; receptionCanDiscount: boolean; managerCanDiscount: boolean } }) {
  const router = useRouter();
  return (
    <ActionForm action={saveDiscountRulesAction} onSuccess={() => router.refresh()} className="space-y-4">
      {({ pending, fieldErrors: e }) => (
        <>
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" name="receptionCanDiscount" defaultChecked={rules.receptionCanDiscount} className="size-4 accent-[oklch(0.75_0.13_80)]" />Receptionists may give a discount</label>
            <label className="flex items-center gap-2.5 text-sm"><input type="checkbox" name="managerCanDiscount" defaultChecked={rules.managerCanDiscount} className="size-4 accent-[oklch(0.75_0.13_80)]" />Managers may give a discount</label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="max">Most off a room, per night (TZS)</Label>
            <Input id="max" name="manualDiscountMax" type="number" min={0} step={1000} defaultValue={rules.manualDiscountMax} className="w-40 tabular-nums" />
            <FieldError message={e?.manualDiscountMax} />
            <p className="text-[11px] text-muted-foreground">Staff see buttons of 5k, 10k, 15k … up to this amount. Every discount is logged with who gave it and why.</p>
          </div>
          <Button type="submit" size="sm" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save rules</Button>
        </>
      )}
    </ActionForm>
  );
}

/** Days of the week (none = every night) and priority. */
function DaysAndPriority({ days, onDays, priority, onPriority, hint }: { days: number[]; onDays: (d: number[]) => void; priority: number; onPriority: (n: number) => void; hint: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
      <div className="space-y-1.5">
        <Label>Nights of the week</Label>
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => onDays([])} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", !days.length ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>Every night</button>
          {WEEKDAYS.map((d, i) => {
            const on = days.includes(i);
            return <button key={d} type="button" onClick={() => onDays(on ? days.filter((x) => x !== i) : [...days, i].sort())} className={cn("w-11 rounded-full border py-1 text-xs font-medium", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{d}</button>;
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="prio">Priority</Label>
        <Input id="prio" type="number" min={1} max={100} value={priority} onChange={(e) => onPriority(Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))))} className="h-9 w-24 tabular-nums" />
      </div>
      <p className="-mt-2 text-[11px] text-muted-foreground sm:col-span-2">{hint}</p>
    </div>
  );
}

/**
 * Calendar effect: every date from a little before the start to a little after
 * the end, the price for each affected room type without and with this rule.
 */
function CalendarPreview({ types, context, scope, roomTypeIds, roomIds, start, end, channel, withRule }: {
  types: PricingType[]; context: PricingContext; scope: string; roomTypeIds: string[]; roomIds: string[]; start: string; end: string; channel: "STAFF" | "WEBSITE";
  withRule: (promos: PromoRule[], rules: PriceRuleLite[]) => { promos: PromoRule[]; rules: PriceRuleLite[] };
}) {
  const affected = types.filter((t) => scope === "ALL" || (scope === "ROOM_TYPES" && roomTypeIds.includes(t.id)) || (scope === "ROOMS" && t.rooms.some((r) => roomIds.includes(r.id))));
  const [typeId, setTypeId] = useState<string | null>(null);
  const t = affected.find((x) => x.id === typeId) ?? affected[0];
  if (!start || !end || end < start) return <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Choose the first and last night to see the calendar effect.</p>;
  if (!t) return <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Choose which rooms it applies to.</p>;
  const roomId = scope === "ROOMS" ? t.rooms.find((r) => roomIds.includes(r.id))?.id ?? null : null;
  const add = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const days: string[] = [];
  for (let d = add(start, -2); d <= add(end, 2) && days.length < 24; d = add(d, 1)) days.push(d);
  if (days.at(-1)! < add(end, 2)) days.push("…", add(end, 1), add(end, 2));
  const next = withRule(context.promos, context.rules);
  const at = (d: string, promos: PromoRule[], rules: PriceRuleLite[]) => priceNight({ date: d, base: t.baseRate, roomTypeId: t.id, roomId, channel, promos, rules });
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-4 py-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price preview — night by night{roomId ? ` · room ${t.rooms.find((r) => r.id === roomId)?.number}` : ""}</p>
        {affected.length > 1 && (
          <select value={t.id} onChange={(e) => setTypeId(e.target.value)} className="h-7 rounded-md border border-border bg-background px-2 text-xs">
            {affected.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
      </div>
      <ul className="grid max-h-72 grid-cols-1 overflow-y-auto sm:grid-cols-2">
        {days.map((d, i) => {
          if (d === "…") return <li key={`gap-${i}`} className="px-4 py-1 text-xs text-muted-foreground">…</li>;
          const was = at(d, context.promos, context.rules);
          const now = at(d, next.promos, next.rules);
          const inside = d >= start && d <= end;
          const changed = now.net !== was.net;
          return (
            <li key={d} className={cn("flex items-center justify-between gap-2 border-b border-border/50 px-4 py-1.5 text-xs", inside ? "bg-emerald-500/[0.05]" : "text-muted-foreground")}>
              <span>{new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span>
              <span className="tabular-nums">
                {changed ? <><span className="text-muted-foreground line-through">{was.net.toLocaleString("en-US")}</span> → <strong>{now.net.toLocaleString("en-US")}</strong></> : now.net.toLocaleString("en-US")}
                {(now.priceRule || now.promotion) && <span className="ml-1 text-[10px] text-muted-foreground">({[now.priceRule?.name, now.promotion?.name].filter(Boolean).join(" + ")})</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const EMPTY_RULE: PriceRuleData = { name: "", scope: "ROOM_TYPES", roomTypeIds: [], roomIds: [], price: 0, startDate: "", endDate: "", daysOfWeek: [], priority: null, isActive: true };

/** Date prices (weekend, holiday, season): a different room price on the nights it covers. */
export function PriceRuleButton({ types, initial, context }: { types: PricingType[]; initial?: PriceRuleData; context: PricingContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={initial ? "sm" : "default"} variant="outline" onClick={() => setOpen(true)}>{initial ? <Pencil /> : <Plus />}{initial ? "Edit" : "New date price"}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader icon={<CalendarRange />} eyebrow="Pricing" tone="violet">
            <DialogTitle>{initial?.id ? "Edit date price" : "Date price (weekend, holiday, season)"}</DialogTitle>
            <DialogDescription>On the nights it covers, rooms cost this price instead of their normal price. Promotions still apply on top. Booked nights keep their price.</DialogDescription>
          </DialogHeader>
          {open && <PriceRuleBuilder types={types} initial={initial ?? EMPTY_RULE} context={context} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PriceRuleBuilder({ types, initial, context, onDone }: { types: PricingType[]; initial: PriceRuleData; context: PricingContext; onDone: () => void }) {
  const router = useRouter();
  const [r, setR] = useState<PriceRuleData>(initial);
  const [pending, start] = useTransition();
  const set = <K extends keyof PriceRuleData>(k: K, v: PriceRuleData[K]) => setR((x) => ({ ...x, [k]: v }));
  const toggle = (k: "roomTypeIds" | "roomIds", id: string) => set(k, r[k].includes(id) ? r[k].filter((x) => x !== id) : [...r[k], id]);
  const priority = r.priority ?? defaultPriority(r.scope, true);
  const candidate: PriceRuleLite = { id: initial.id ?? "candidate", name: r.name || "This date price", scope: r.scope, roomTypeIds: r.roomTypeIds, roomIds: r.roomIds, price: r.price || 0, startDate: r.startDate, endDate: r.endDate, daysOfWeek: r.daysOfWeek, priority };
  const seg = (on: boolean) => cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", on ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground");
  function save() {
    start(async () => {
      const res = await savePriceRuleAction({ ...r, priority });
      if (res.ok) { toast.success(res.message ?? "Saved."); onDone(); router.refresh(); } else toast.error(res.error, { duration: 9000 });
    });
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <div className="space-y-1.5"><Label htmlFor="rule-name">Name</Label><Input id="rule-name" value={r.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Weekend, Christmas, High season" /></div>
        <div className="space-y-1.5"><Label htmlFor="rule-price">Price per night (TZS)</Label><Input id="rule-price" type="number" min={1000} step={1000} value={r.price || ""} onChange={(e) => set("price", Math.max(0, Math.round(Number(e.target.value) || 0)))} className="tabular-nums" /></div>
      </div>
      <div className="space-y-2">
        <Label>Rooms</Label>
        <div className="flex rounded-xl bg-muted p-0.5">
          {([["ROOM_TYPES", "Room types"], ["ROOMS", "Single rooms"], ["ALL", "All rooms"]] as const).map(([v, l]) => (
            <button key={v} type="button" className={cn(seg(r.scope === v), "flex-1")} onClick={() => set("scope", v)}>{l}</button>
          ))}
        </div>
        {r.scope === "ROOM_TYPES" && (
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => <button key={t.id} type="button" onClick={() => toggle("roomTypeIds", t.id)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", r.roomTypeIds.includes(t.id) ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{t.name} <span className="opacity-60">{formatTZS(t.baseRate).replace("TZS ", "")}</span></button>)}
          </div>
        )}
        {r.scope === "ROOMS" && (
          <div className="space-y-2">
            {types.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-1.5">
                <span className="w-32 shrink-0 text-xs text-muted-foreground">{t.name}</span>
                {t.rooms.map((x) => <button key={x.id} type="button" onClick={() => toggle("roomIds", x.id)} className={cn("h-8 min-w-12 rounded-lg border px-2 text-xs font-semibold", r.roomIds.includes(x.id) ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{x.number}</button>)}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="rule-start">From (first night)</Label><Input id="rule-start" type="date" value={r.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="rule-end">Until (last night)</Label><Input id="rule-end" type="date" min={r.startDate || undefined} value={r.endDate} onChange={(e) => set("endDate", e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <div className="flex rounded-xl bg-muted p-0.5">
            <button type="button" className={cn(seg(r.isActive), "flex-1")} onClick={() => set("isActive", true)}>On</button>
            <button type="button" className={cn(seg(!r.isActive), "flex-1")} onClick={() => set("isActive", false)}>Off</button>
          </div>
        </div>
      </div>
      <DaysAndPriority days={r.daysOfWeek} onDays={(d) => set("daysOfWeek", d)} priority={priority} onPriority={(n) => set("priority", n)}
        hint="E.g. Weekend = Fri + Sat nights all year. A holiday price with a higher priority beats the weekend price on its dates. Same priority + same rooms + same nights is refused." />
      <CalendarPreview types={types} context={context} scope={r.scope} roomTypeIds={r.roomTypeIds} roomIds={r.roomIds} start={r.startDate} end={r.endDate} channel="STAFF"
        withRule={(ps, rs) => ({ promos: ps, rules: [...rs.filter((x) => x.id !== candidate.id), ...(r.isActive && r.price ? [candidate] : [])] })} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button onClick={save} disabled={pending || !r.name.trim() || !r.price || !r.startDate || !r.endDate}>{pending && <Loader2 className="animate-spin" />}Save date price</Button>
      </div>
    </div>
  );
}

export function PriceRuleSwitch({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending}
      onClick={() => start(async () => {
        const res = await setPriceRuleActiveAction({ id, isActive: !isActive });
        if (res.ok) { toast.success(res.message ?? "Saved."); router.refresh(); } else toast.error(res.error, { duration: 9000 });
      })}>
      {pending ? <Loader2 className="animate-spin" /> : <Power />}{isActive ? "Switch off" : "Switch on"}
    </Button>
  );
}
