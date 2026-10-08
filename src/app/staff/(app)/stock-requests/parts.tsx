"use client";

import { useState } from "react";
import { BedDouble, Briefcase, Building2, ChefHat, ConciergeBell, Loader2, UtensilsCrossed, Wine, Wrench, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StockGroup, StockItem } from "@/lib/stock-catalog";
import { statusMeta, unitWord, type StoreItem } from "@/lib/stock-requests";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

/** A picture tile: a catalogue item, a drink from the menu, or a stock item from the stores (`stockId`). */
export type Tile = StockItem & { stockId?: string | null };
export type TileGroup = { key: string; name: string; emoji: string; items: Tile[] };
/** A row of a list being made or changed. `id` is the line's own id when changing a sent request. */
export type Row = { key: number; id?: string | null; name: string; quantity: string; unit: string; custom: boolean; stockId?: string | null };

export const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const DEPT: Record<string, { icon: LucideIcon; tone: string; emoji: string }> = {
  KITCHEN: { icon: ChefHat, tone: "bg-amber-500/12 text-amber-700 dark:text-amber-300", emoji: "🥘" },
  BAR: { icon: Wine, tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300", emoji: "🍾" },
  RESTAURANT: { icon: UtensilsCrossed, tone: "bg-orange-500/12 text-orange-700 dark:text-orange-300", emoji: "🍽️" },
  HOUSEKEEPING: { icon: BedDouble, tone: "bg-teal-500/12 text-teal-700 dark:text-teal-300", emoji: "🧺" },
  MAINTENANCE: { icon: Wrench, tone: "bg-stone-500/15 text-stone-700 dark:text-stone-300", emoji: "🔧" },
  RECEPTION: { icon: ConciergeBell, tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300", emoji: "🛎️" },
  OFFICE: { icon: Briefcase, tone: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300", emoji: "🗂️" },
};
const deptMeta = (code: string) => DEPT[code] ?? { icon: Building2, tone: "bg-muted text-muted-foreground", emoji: "📦" };

/** The department's icon on a soft tile. */
export function DeptBadge({ code, className }: { code: string; className?: string }) {
  const m = deptMeta(code);
  const I = m.icon;
  return <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", m.tone, className)}><I className="size-4" /></span>;
}
export const DeptIcon = ({ code, className }: { code: string; className?: string }) => {
  const I = deptMeta(code).icon;
  return <I className={className} />;
};

export function StatusChip({ status, className }: { status: string; className?: string }) {
  const t = useT();
  const m = statusMeta(status);
  return <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold", m.tone, className)}>{t(m.label)}</span>;
}

/** The item's picture: its photo (drinks from the menu) or a clear icon on a soft tile. */
export function Pic({ item, className }: { item: StockItem; className?: string }) {
  return item.image
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={item.image} alt="" loading="lazy" className={cn("object-cover", className)} />
    : <span aria-hidden className={cn("grid place-items-center bg-linear-to-br from-foreground/[0.07] to-foreground/[0.02] leading-none dark:from-white/[0.09] dark:to-white/[0.02]", className)}>{item.emoji}</span>;
}

/** "From the stores": the department's stock items as tiles (their picture from the catalogue when the name matches). */
export function storeGroup(items: StoreItem[], dept: { id: string; code: string } | null | undefined, catalog: StockGroup[]): TileGroup | null {
  if (!dept) return null;
  const own = items.filter((i) => i.departmentId === dept.id);
  if (!own.length) return null;
  const known = new Map(catalog.flatMap((g) => g.items.map((i) => [norm(i.name), i] as const)));
  return {
    key: "stores", name: msg("From the stores"), emoji: "🏬",
    items: own.map((i) => {
      const k = known.get(norm(i.name));
      return { name: i.name, unit: unitWord(i.unit), emoji: k?.emoji ?? deptMeta(dept.code).emoji, image: k?.image ?? null, stockId: i.id };
    }),
  };
}

/** Pictures by name for every list row: the catalogue and drinks first, then every stock item. */
export function picsFor(groups: TileGroup[], items: StoreItem[], departments: { id: string; code: string }[]) {
  const m = new Map<string, Tile>();
  for (const g of groups) for (const i of g.items) if (!m.has(i.name)) m.set(i.name, i);
  for (const i of items) {
    if (m.has(i.name)) continue;
    const code = departments.find((d) => d.id === i.departmentId)?.code ?? "";
    m.set(i.name, { name: i.name, unit: unitWord(i.unit), emoji: deptMeta(code).emoji, stockId: i.id });
  }
  return m;
}

/** A small "why?" box for sending back, rejecting or correcting: the reason is required (unless `optional`). */
export function ReasonBox({ placeholder, action, tone = "destructive", optional = false, pending, onConfirm, onCancel }: {
  placeholder: string; action: string; tone?: "destructive" | "default"; optional?: boolean; pending: boolean; onConfirm: (reason: string) => void; onCancel: () => void;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  return (
    <div className="flex gap-2">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} autoFocus maxLength={300}
        className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-base sm:text-sm" />
      <Button variant={tone} className="h-11" disabled={pending || (!optional && reason.trim().length < 3)} onClick={() => onConfirm(reason.trim())}>
        {pending && <Loader2 className="animate-spin" />}{action}
      </Button>
      <Button variant="ghost" className="h-11" aria-label={t("Cancel")} onClick={onCancel}><X /></Button>
    </div>
  );
}
