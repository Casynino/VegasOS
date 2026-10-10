/**
 * Hotel-wide inventory — the parts both the server and the screens need: units (and converting
 * between them), why stock moves, and what an item's level means (low, out, too much).
 */
import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";

export type UnitFamily = "mass" | "volume" | "count";
export const UNITS: { code: string; label: string; plural: string; family: UnitFamily; base: number }[] = [
  { code: "KG", label: "kg", plural: "kg", family: "mass", base: 1000 },
  { code: "G", label: "g", plural: "g", family: "mass", base: 1 },
  { code: "L", label: "L", plural: "L", family: "volume", base: 1000 },
  { code: "ML", label: "ml", plural: "ml", family: "volume", base: 1 },
  { code: "PIECE", label: msg("piece"), plural: msg("pieces"), family: "count", base: 1 },
  { code: "BOTTLE", label: msg("bottle"), plural: msg("bottles"), family: "count", base: 1 },
  { code: "CAN", label: msg("can"), plural: msg("cans"), family: "count", base: 1 },
  { code: "CARTON", label: msg("carton"), plural: msg("cartons"), family: "count", base: 1 },
  { code: "CRATE", label: msg("crate"), plural: msg("crates"), family: "count", base: 1 },
  { code: "BOX", label: msg("box"), plural: msg("boxes"), family: "count", base: 1 },
  { code: "PACK", label: msg("pack"), plural: msg("packs"), family: "count", base: 1 },
  { code: "DOZEN", label: msg("dozen"), plural: msg("dozen"), family: "count", base: 12 },
  { code: "TRAY", label: msg("tray"), plural: msg("trays"), family: "count", base: 1 },
  { code: "BAG", label: msg("bag"), plural: msg("bags"), family: "count", base: 1 },
  { code: "ROLL", label: msg("roll"), plural: msg("rolls"), family: "count", base: 1 },
  { code: "BUNCH", label: msg("bunch"), plural: msg("bunches"), family: "count", base: 1 },
  { code: "TIN", label: msg("tin"), plural: msg("tins"), family: "count", base: 1 },
  { code: "SLICE", label: msg("slice"), plural: msg("slices"), family: "count", base: 1 },
  { code: "CYLINDER", label: msg("cylinder"), plural: msg("cylinders"), family: "count", base: 1 },
  { code: "SET", label: msg("set"), plural: msg("sets"), family: "count", base: 1 },
];
const UNIT = new Map(UNITS.map((u) => [u.code, u]));
export const unitOf = (code: string) => UNIT.get(code) ?? { code, label: code.toLowerCase(), plural: code.toLowerCase(), family: "count" as UnitFamily, base: 1 };

/** Units a recipe line may use for an item kept in `unit`: grams for kg, ml for litres; counted things stay as they are. */
export function compatibleUnits(unit: string) {
  const u = unitOf(unit);
  return u.family === "count" ? [u.code] : UNITS.filter((x) => x.family === u.family).map((x) => x.code);
}

/** 150 G in KG → 0.15. Different kinds of unit (kg vs bottles) cannot convert: null. */
export function convertQty(qty: number, from: string, to: string): number | null {
  if (from === to) return qty;
  const a = unitOf(from), b = unitOf(to);
  if (a.family !== b.family || a.family === "count") return null;
  return round3((qty * a.base) / b.base);
}

export const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * "59 kg", "28 L", "120 bottles", "1 bottle", "2.5 kg". English by default (it is also written into history and
 * messages); pass the reader's `t` to show the unit in their language.
 */
export function formatQty(q: number, unit: string, t: T = englishT) {
  const p = qtyParts(q, unit);
  return `${p.n} ${t(p.unit)}`;
}

/** formatQty's two parts: the number as written and the unit's English word ("2.5" + "kg", "1" + "bottle"). */
export function qtyParts(q: number, unit: string) {
  const u = unitOf(unit);
  const n = round3(q);
  const s = Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return { n: s, unit: Math.abs(n) === 1 ? u.label : u.plural };
}

// ── Why stock moves ──

export type MovementKind = "RECEIVE" | "USE" | "SALE" | "WASTE" | "COUNT" | "ADJUST";
export const KIND_LABEL: Record<MovementKind, string> = {
  RECEIVE: msg("Received"), USE: msg("Used"), SALE: msg("Sold (recipe)"), WASTE: msg("Waste"), COUNT: msg("Stock count"), ADJUST: msg("Adjustment"),
};

/** Stock going out for work. */
export const USE_REASONS = [
  { code: "KITCHEN_USAGE", label: msg("Kitchen usage") },
  { code: "RESTAURANT_USAGE", label: msg("Restaurant consumption") },
  { code: "BAR_USAGE", label: msg("Bar usage") },
  { code: "HOUSEKEEPING_USAGE", label: msg("Housekeeping usage") },
  { code: "MAINTENANCE_USAGE", label: msg("Maintenance usage") },
  { code: "RECEPTION_USAGE", label: msg("Reception / office usage") },
  { code: "TRANSFER", label: msg("Internal transfer") },
] as const;
/** Stock lost — a manager reviews it before it leaves the books. */
export const WASTE_REASONS = [
  { code: "SPOILED", label: msg("Spoiled") },
  { code: "EXPIRED", label: msg("Expired") },
  { code: "DAMAGED", label: msg("Damaged / broken") },
  { code: "WASTED", label: msg("Wasted (cooking, spilt)") },
  { code: "RETURNED", label: msg("Returned by guest") },
] as const;
/** Why a physical count differs from the system. */
export const COUNT_REASONS = [
  { code: "MEASUREMENT", label: msg("Measurement difference") },
  { code: "WASTE", label: msg("Waste") },
  { code: "SPOILAGE", label: msg("Spoilage") },
  { code: "UNRECORDED_USAGE", label: msg("Unrecorded usage") },
  { code: "UNRECORDED_RECEIPT", label: msg("Delivery not recorded") },
  { code: "OTHER", label: msg("Other") },
] as const;
export const RECEIVE_REASON = "RECEIVED";
/** Received from a stock purchase (a request that was bought and given its final approval). */
export const PURCHASE_REASON = "PURCHASE";
export const SALE_REASON = "RECIPE";
export const ADJUST_REASON = "ADJUSTMENT";

const REASON_LABEL = new Map<string, string>([
  ...[...USE_REASONS, ...WASTE_REASONS, ...COUNT_REASONS].map((r) => [r.code, r.label] as [string, string]),
  [RECEIVE_REASON, msg("Received")], [PURCHASE_REASON, msg("Bought — purchase")], [SALE_REASON, msg("Sold — recipe")], [ADJUST_REASON, msg("Adjustment")],
]);
export const reasonLabel = (code: string) => REASON_LABEL.get(code) ?? code.toLowerCase().replace(/_/g, " ");

/** The usual reason when a department takes stock out. */
export function usageReasonFor(departmentCode: string | null | undefined) {
  return ({ KITCHEN: "KITCHEN_USAGE", RESTAURANT: "RESTAURANT_USAGE", BAR: "BAR_USAGE", HOUSEKEEPING: "HOUSEKEEPING_USAGE", MAINTENANCE: "MAINTENANCE_USAGE", RECEPTION: "RECEPTION_USAGE", OFFICE: "RECEPTION_USAGE" } as Record<string, string>)[departmentCode ?? ""] ?? "KITCHEN_USAGE";
}

// ── What a level means ──

export type StockLevel = "OUT" | "LOW" | "REORDER" | "OVER" | "OK";
export function stockLevel(i: { quantity: number; minStock: number | null; reorderLevel: number | null; maxStock: number | null }): StockLevel {
  if (i.quantity <= 0) return "OUT";
  if (i.minStock != null && i.quantity < i.minStock) return "LOW";
  if (i.reorderLevel != null && i.quantity <= i.reorderLevel) return "REORDER";
  if (i.maxStock != null && i.maxStock > 0 && i.quantity > i.maxStock) return "OVER";
  return "OK";
}
export const LEVEL_META: Record<StockLevel, { label: string; dot: string; chip: string; bar: string }> = {
  OUT: { label: msg("Out of stock"), dot: "bg-rose-500", chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300", bar: "bg-rose-500" },
  LOW: { label: msg("Low stock"), dot: "bg-amber-500", chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300", bar: "bg-amber-500" },
  REORDER: { label: msg("Time to reorder"), dot: "bg-sky-500", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300", bar: "bg-sky-500" },
  OVER: { label: msg("Overstock"), dot: "bg-violet-500", chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300", bar: "bg-violet-500" },
  OK: { label: msg("In stock"), dot: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500" },
};

/** Days before an expiry date when a delivery shows as "expiring". */
export const EXPIRY_WARN_DAYS = 3;

// ── Assets ──

export const ASSET_CONDITIONS = [
  { code: "NEW", label: msg("New") }, { code: "GOOD", label: msg("Good") }, { code: "FAIR", label: msg("Fair") }, { code: "POOR", label: msg("Poor") }, { code: "DAMAGED", label: msg("Damaged") },
] as const;
export const ASSET_STATUSES = [
  { code: "IN_USE", label: msg("In use"), chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  { code: "IN_STORE", label: msg("In store"), chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  { code: "UNDER_REPAIR", label: msg("Under repair"), chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  { code: "OUT_OF_ORDER", label: msg("Out of order"), chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  { code: "DISPOSED", label: msg("Disposed"), chip: "bg-muted text-muted-foreground" },
  { code: "LOST", label: msg("Lost / missing"), chip: "bg-muted text-muted-foreground" },
] as const;
export const ASSET_CATEGORIES = [
  msg("Beds & mattresses"), msg("Furniture"), msg("TVs & electronics"), msg("Air conditioners"), msg("Fridges & freezers"), msg("Laundry machines"),
  msg("Kitchen equipment"), msg("Restaurant equipment"), msg("Computers & printers"), msg("POS devices"), msg("Bathroom fittings"), msg("Other"),
];
