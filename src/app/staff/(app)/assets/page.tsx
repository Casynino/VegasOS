import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import Link from "next/link";
import { Boxes, Coins, History, Layers, MoveRight, PackageCheck, Sofa, TriangleAlert, Wrench, type LucideIcon } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { assetsData } from "@/server/services/inventory";
import { cn } from "@/lib/utils";
import { AssetsView, MoveList } from "./assets-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Assets") };
}

const tzs = (v: number) => `TZS ${Math.round(v).toLocaleString("en-US")}`;
/** Big money in a small tile: TZS 4.91M (the full figure shows on hover). */
const short = (v: number) => (Math.abs(v) >= 1_000_000 ? `TZS ${Number((v / 1_000_000).toFixed(2)).toLocaleString("en-US")}M` : tzs(v));

/**
 * The hotel's assets — beds, chairs, TVs, fridges, air conditioners, kitchen and restaurant
 * equipment, computers, POS devices — apart from consumable stock. Where each is, its condition
 * and status, and every move (Restaurant → Meeting room) with who and when.
 */
export default async function AssetsPage() {
  const user = await requirePagePermission("assets.view");
  const t = await getT();
  const perms = { manage: can(user, "assets.manage"), move: can(user, "assets.manage") || can(user, "inventory.approve") };
  const [data, rooms] = await Promise.all([
    assetsData(),
    db.room.findMany({ where: { isActive: true }, orderBy: { number: "asc" }, select: { number: true, roomType: { select: { name: true } } } }),
  ]);
  const places = [...new Set([
    msg("Reception"), msg("Lobby"), msg("Restaurant"), msg("Bar"), msg("Kitchen"), msg("Main store"), msg("Laundry"), msg("Office"), msg("Meeting room"), msg("Outside area"),
    ...rooms.map((r) => `Room ${r.number}`), ...data.assets.map((a) => a.location).filter(Boolean) as string[],
  ])];
  const live = data.assets.filter((a) => !["DISPOSED", "LOST"].includes(a.status));
  const units = live.reduce((sum, a) => sum + a.quantity, 0);
  const repair = live.filter((a) => a.status === "UNDER_REPAIR" || a.status === "OUT_OF_ORDER");
  const attention = live.filter((a) => a.condition === "POOR" || a.condition === "DAMAGED");
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const movedMonth = data.moves.filter((m) => m.kind === "MOVED" && new Date(m.at) >= monthStart).length;
  const figures: { label: string; value: string; sub: string; icon: LucideIcon; tint: string; tone?: string }[] = [
    { label: t("Assets"), value: units.toLocaleString("en-US"), sub: t("{n} records", { n: live.length }), icon: Sofa, tint: "bg-indigo-500/15 text-indigo-500" },
    { label: t("Value (cost)"), value: short(live.reduce((sum, a) => sum + (a.purchaseCost ?? 0), 0)), sub: t("what was paid"), icon: Coins, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.72_0.12_80)]" },
    { label: t("In use"), value: String(live.filter((a) => a.status === "IN_USE").reduce((sum, a) => sum + a.quantity, 0)), sub: t("{n} in store", { n: live.filter((a) => a.status === "IN_STORE").reduce((sum, a) => sum + a.quantity, 0) }), icon: PackageCheck, tint: "bg-emerald-500/15 text-emerald-500" },
    { label: t("Under repair"), value: String(repair.length), sub: t("{n} out of order", { n: repair.filter((a) => a.status === "OUT_OF_ORDER").length }), icon: Wrench, tint: "bg-amber-500/15 text-amber-500", tone: repair.length ? "text-amber-600 dark:text-amber-400" : undefined },
    { label: t("Poor or damaged"), value: String(attention.length), sub: attention.length ? t("check or replace") : t("none"), icon: TriangleAlert, tint: "bg-rose-500/15 text-rose-500", tone: attention.length ? "text-rose-600 dark:text-rose-400" : undefined },
    { label: t("Moved this month"), value: String(movedMonth), sub: t("with who and when"), icon: MoveRight, tint: "bg-sky-500/15 text-sky-500" },
  ];

  return (
    <div className="w-full space-y-4">
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-indigo-400 to-violet-600 text-white shadow-[0_10px_24px_-12px_rgb(99_102_241)]"><Sofa className="size-6" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t("Assets · {role}", { role: t(user.roleName) })}</p>
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{t("Hotel assets")}</h1>
              <p className="text-xs text-muted-foreground">{t("Furniture, equipment and electronics — kept apart from stock that gets used up.")}</p>
            </div>
          </div>
          {can(user, "inventory.view") && <Link href="/staff/inventory" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-card px-3 text-sm font-semibold hover:bg-muted"><Boxes className="size-4" />{t("Inventory")}</Link>}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-3 xl:grid-cols-6">
        {figures.map((c) => (
          <div key={c.label} className="min-w-0 bg-card px-4 py-3.5">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("grid size-5 shrink-0 place-items-center rounded-md [&_svg]:size-3", c.tint)}><c.icon /></span><span className="truncate">{c.label}</span></p>
            <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums", c.tone)}>{c.value}</p>
            <p className="truncate text-[11px] text-muted-foreground">{c.sub}</p>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <AssetsView assets={data.assets} perms={perms}
          opts={{ departments: data.departments, suppliers: data.suppliers, locations: places, categories: [...new Set(data.assets.map((a) => a.category))] }} />
        <section className="rounded-3xl border border-border/70 bg-card px-4 py-3">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold"><History className="size-4 text-muted-foreground" />{t("Latest moves & changes")}</p>
          {data.moves.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t("Nothing moved yet.")}</p> : <MoveList rows={data.moves.slice(0, 15)} withAsset />}
          <p className="mt-2 flex items-center gap-1.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground"><Layers className="size-3" />{t("Every change is kept with who, when and the old and new value.")}</p>
        </section>
      </div>
    </div>
  );
}
