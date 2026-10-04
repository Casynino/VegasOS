/**
 * Hotel-wide inventory — the parts both the server and the screens need: units (and converting
 * between them), why stock moves, and what an item's level means (low, out, too much).
 */

export type UnitFamily = "mass" | "volume" | "count";
export const UNITS: { code: string; label: string; plural: string; family: UnitFamily; base: number }[] = [
  { code: "KG", label: "kg", plural: "kg", family: "mass", base: 1000 },
  { code: "G", label: "g", plural: "g", family: "mass", base: 1 },
  { code: "L", label: "L", plural: "L", family: "volume", base: 1000 },
  { code: "ML", label: "ml", plural: "ml", family: "volume", base: 1 },
  { code: "PIECE", label: "piece", plural: "pieces", family: "count", base: 1 },
  { code: "BOTTLE", label: "bottle", plural: "bottles", family: "count", base: 1 },
  { code: "CAN", label: "can", plural: "cans", family: "count", base: 1 },
  { code: "CARTON", label: "carton", plural: "cartons", family: "count", base: 1 },
  { code: "CRATE", label: "crate", plural: "crates", family: "count", base: 1 },
  { code: "BOX", label: "box", plural: "boxes", family: "count", base: 1 },
  { code: "PACK", label: "pack", plural: "packs", family: "count", base: 1 },
  { code: "DOZEN", label: "dozen", plural: "dozen", family: "count", base: 12 },
  { code: "TRAY", label: "tray", plural: "trays", family: "count", base: 1 },
  { code: "BAG", label: "bag", plural: "bags", family: "count", base: 1 },
  { code: "ROLL", label: "roll", plural: "rolls", family: "count", base: 1 },
  { code: "BUNCH", label: "bunch", plural: "bunches", family: "count", base: 1 },
  { code: "TIN", label: "tin", plural: "tins", family: "count", base: 1 },
  { code: "SLICE", label: "slice", plural: "slices", family: "count", base: 1 },
  { code: "CYLINDER", label: "cylinder", plural: "cylinders", family: "count", base: 1 },
  { code: "SET", label: "set", plural: "sets", family: "count", base: 1 },
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

/** "59 kg", "28 L", "120 bottles", "1 bottle", "2.5 kg". */
export function formatQty(q: number, unit: string) {
  const u = unitOf(unit);
  const n = round3(q);
  const s = Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return `${s} ${Math.abs(n) === 1 ? u.label : u.plural}`;
}

// ── Why stock moves ──

export type MovementKind = "RECEIVE" | "USE" | "SALE" | "WASTE" | "COUNT" | "ADJUST";
export const KIND_LABEL: Record<MovementKind, string> = {
  RECEIVE: "Received", USE: "Used", SALE: "Sold (recipe)", WASTE: "Waste", COUNT: "Stock count", ADJUST: "Adjustment",
};

/** Stock going out for work. */
export const USE_REASONS = [
  { code: "KITCHEN_USAGE", label: "Kitchen usage" },
  { code: "RESTAURANT_USAGE", label: "Restaurant consumption" },
  { code: "BAR_USAGE", label: "Bar usage" },
  { code: "HOUSEKEEPING_USAGE", label: "Housekeeping usage" },
  { code: "MAINTENANCE_USAGE", label: "Maintenance usage" },
  { code: "RECEPTION_USAGE", label: "Reception / office usage" },
  { code: "TRANSFER", label: "Internal transfer" },
] as const;
/** Stock lost — a manager reviews it before it leaves the books. */
export const WASTE_REASONS = [
  { code: "SPOILED", label: "Spoiled" },
  { code: "EXPIRED", label: "Expired" },
  { code: "DAMAGED", label: "Damaged / broken" },
  { code: "WASTED", label: "Wasted (cooking, spilt)" },
  { code: "RETURNED", label: "Returned by guest" },
] as const;
/** Why a physical count differs from the system. */
export const COUNT_REASONS = [
  { code: "MEASUREMENT", label: "Measurement difference" },
  { code: "WASTE", label: "Waste" },
  { code: "SPOILAGE", label: "Spoilage" },
  { code: "UNRECORDED_USAGE", label: "Unrecorded usage" },
  { code: "UNRECORDED_RECEIPT", label: "Delivery not recorded" },
  { code: "OTHER", label: "Other" },
] as const;
export const RECEIVE_REASON = "RECEIVED";
/** Received from a stock purchase (a request that was bought and given its final approval). */
export const PURCHASE_REASON = "PURCHASE";
export const SALE_REASON = "RECIPE";
export const ADJUST_REASON = "ADJUSTMENT";

const REASON_LABEL = new Map<string, string>([
  ...[...USE_REASONS, ...WASTE_REASONS, ...COUNT_REASONS].map((r) => [r.code, r.label] as [string, string]),
  [RECEIVE_REASON, "Received"], [PURCHASE_REASON, "Bought — purchase"], [SALE_REASON, "Sold — recipe"], [ADJUST_REASON, "Adjustment"],
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
  OUT: { label: "Out of stock", dot: "bg-rose-500", chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300", bar: "bg-rose-500" },
  LOW: { label: "Low stock", dot: "bg-amber-500", chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300", bar: "bg-amber-500" },
  REORDER: { label: "Time to reorder", dot: "bg-sky-500", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300", bar: "bg-sky-500" },
  OVER: { label: "Overstock", dot: "bg-violet-500", chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300", bar: "bg-violet-500" },
  OK: { label: "In stock", dot: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500" },
};

/** Days before an expiry date when a delivery shows as "expiring". */
export const EXPIRY_WARN_DAYS = 3;

// ── Assets ──

export const ASSET_CONDITIONS = [
  { code: "NEW", label: "New" }, { code: "GOOD", label: "Good" }, { code: "FAIR", label: "Fair" }, { code: "POOR", label: "Poor" }, { code: "DAMAGED", label: "Damaged" },
] as const;
export const ASSET_STATUSES = [
  { code: "IN_USE", label: "In use", chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  { code: "IN_STORE", label: "In store", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  { code: "UNDER_REPAIR", label: "Under repair", chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  { code: "OUT_OF_ORDER", label: "Out of order", chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  { code: "DISPOSED", label: "Disposed", chip: "bg-muted text-muted-foreground" },
  { code: "LOST", label: "Lost / missing", chip: "bg-muted text-muted-foreground" },
] as const;
export const ASSET_CATEGORIES = [
  "Beds & mattresses", "Furniture", "TVs & electronics", "Air conditioners", "Fridges & freezers", "Laundry machines",
  "Kitchen equipment", "Restaurant equipment", "Computers & printers", "POS devices", "Bathroom fittings", "Other",
];
