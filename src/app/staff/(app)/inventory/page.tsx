import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, Boxes, ClipboardList, Coins, Flame, Hourglass, Layers, PackageX, Sofa, TrendingDown, Trash2, Wrench, type LucideIcon } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { assetSummary, expiringStock, inventoryDay, inventorySetup, recentMovements, recipesData } from "@/server/services/inventory";
import { formatShortDate } from "@/lib/format";
import { KIND_LABEL, formatQty, type MovementKind } from "@/lib/inventory";
import { cn } from "@/lib/utils";
import { StockView, ReceivePicker } from "./stock-view";
import { NewItemButton } from "./item-form";
import { MovementList } from "./item-sheet";
import { AlertsPanel } from "./alerts-panel";
import { CountView } from "./count-view";
import { WasteView } from "./waste-view";
import { RecipesView } from "./recipes-view";
import { SetupView } from "./setup-view";

export const metadata: Metadata = { title: "Inventory" };

type View = "overview" | "stock" | "movements" | "waste" | "count" | "recipes" | "setup";
const tzs = (v: number) => `TZS ${Math.round(v).toLocaleString("en-US")}`;
/** Big money in a small tile: TZS 4.91M (the full figure shows on hover). */
const short = (v: number) => (Math.abs(v) >= 1_000_000 ? `TZS ${Number((v / 1_000_000).toFixed(2)).toLocaleString("en-US")}M` : tzs(v));

/**
 * Hotel-wide inventory: consumable stock by department (the kitchen sees its own), alerts, what
 * came in and went out today, waste to approve, counts, recipes and the setup. Assets (furniture,
 * equipment) are on their own page — the two never mix.
 */
export default async function InventoryPage({ searchParams }: PageProps<"/staff/inventory">) {
  const user = await requirePagePermission("inventory.view");
  const sp = await searchParams;
  const perms = { receive: can(user, "inventory.receive"), use: can(user, "inventory.use"), approve: can(user, "inventory.approve"), manage: can(user, "inventory.manage") };
  // Purchase prices and suppliers on the stock movements: only for those who buy or approve stock.
  const seesPrices = perms.receive || perms.approve || can(user, "expenses.approve") || can(user, "finance.view");
  const today = await businessToday();
  const setup = await inventorySetup();
  const setupProps = { departments: setup.departments, categories: setup.categories, suppliers: setup.suppliers, locations: setup.locations };

  // The Mpishi lands on the kitchen's stock; everyone else on the whole hotel.
  const code = typeof sp.d === "string" ? sp.d.toUpperCase() : user.roleCode === "KITCHEN" ? "KITCHEN" : "ALL";
  const dept = setup.departments.find((d) => d.code === code) ?? null;
  const supervisor = perms.approve || perms.manage;
  const views: { key: View; label: string; show: boolean }[] = [
    { key: "overview", label: "Overview", show: true },
    { key: "stock", label: "Stock", show: true },
    { key: "movements", label: "Movements", show: true },
    { key: "waste", label: "Waste", show: true },
    { key: "count", label: "Count", show: perms.approve },
    { key: "recipes", label: "Recipes", show: perms.manage },
    { key: "setup", label: "Setup", show: perms.manage || perms.approve },
  ];
  const raw = typeof sp.v === "string" ? sp.v : supervisor ? "overview" : "stock";
  const view: View = views.some((v) => v.show && v.key === raw) ? (raw as View) : "overview";
  const href = (p: { d?: string; v?: View }) => {
    const q = new URLSearchParams();
    const d = p.d ?? (dept?.code ?? "ALL");
    if (d !== (user.roleCode === "KITCHEN" ? "KITCHEN" : "ALL")) q.set("d", d.toLowerCase());
    const v = p.v ?? view;
    if (v !== (supervisor ? "overview" : "stock")) q.set("v", v);
    const s = q.toString();
    return `/staff/inventory${s ? `?${s}` : ""}`;
  };

  const items = (dept ? setup.items.filter((i) => i.department.id === dept.id) : setup.items);
  const active = items.filter((i) => i.isActive);
  const pendingAll = await recentMovements({ money: seesPrices, status: "PENDING", kind: "WASTE", take: 100, departmentId: dept?.id });
  const title = dept ? `${dept.name} stock` : "Hotel inventory";

  return (
    <div className="w-full space-y-4">
      {/* Slim header */}
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-amber-400 to-orange-600 text-white shadow-[0_10px_24px_-12px_rgb(234_88_12)]"><Boxes className="size-6" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">Inventory · {user.roleName}</p>
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{title}</h1>
              <p className="text-xs text-muted-foreground">{active.length} items · worth {tzs(active.reduce((t, i) => t + i.value, 0))} · {formatShortDate(today)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can(user, "inventory.request") && !supervisor && <Link href="/staff/stock-requests" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-card px-3 text-sm font-semibold hover:bg-muted"><ClipboardList className="size-4" />Ask for stock</Link>}
            {can(user, "assets.view") && <Link href="/staff/assets" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-card px-3 text-sm font-semibold hover:bg-muted"><Sofa className="size-4" />Assets</Link>}
            {perms.manage && <NewItemButton setup={setupProps} defaultDepartmentId={dept?.id} />}
            {perms.receive && <ReceivePicker items={items} perms={perms} setup={setupProps} />}
          </div>
        </div>
      </section>

      {/* Department — one bar that slides on phones */}
      <nav aria-label="Department" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
        <div className="flex w-max gap-1 rounded-2xl border border-border/70 bg-card p-1">
          {[{ code: "ALL", name: "Whole hotel", id: null as string | null }, ...setup.departments.filter((d) => d.isActive)].map((d) => {
            const its = setup.items.filter((i) => i.isActive && (!d.id || i.department.id === d.id));
            const alerts = its.filter((i) => i.level === "OUT" || i.level === "LOW").length;
            const on = (dept?.code ?? "ALL") === d.code;
            return (
              <Link key={d.code} href={href({ d: d.code })} aria-current={on ? "page" : undefined}
                className={cn("inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors", on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                {d.name}<span className={cn("min-w-5 rounded-full px-1.5 text-center text-[10px] tabular-nums", alerts ? "bg-amber-500 text-black" : on ? "bg-background/20" : "bg-muted")}>{alerts || its.length}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* View */}
      <nav aria-label="View" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
        <div className="flex w-max gap-4 border-b border-border/70 px-1">
          {views.filter((v) => v.show).map((v) => (
            <Link key={v.key} href={href({ v: v.key })} aria-current={v.key === view ? "page" : undefined}
              className={cn("-mb-px inline-flex items-center gap-1.5 border-b-2 pb-2 text-sm font-semibold transition-colors", v.key === view ? "border-[oklch(0.72_0.12_78)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {v.label}{v.key === "waste" && pendingAll.length > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] text-black">{pendingAll.length}</span>}
            </Link>
          ))}
        </div>
      </nav>

      {view === "overview" && <Overview today={today} deptId={dept?.id ?? null} items={items} pending={pendingAll.length} perms={perms} setup={setupProps} wasteHref={href({ v: "waste" })} movementsHref={href({ v: "movements" })} assets={can(user, "assets.view")} seesPrices={seesPrices} />}
      {view === "stock" && <StockView items={items} perms={perms} setup={setupProps} showDepartment={!dept} />}
      {view === "movements" && <Movements deptId={dept?.id ?? null} kind={typeof sp.k === "string" ? sp.k.toUpperCase() : null} base={href({ v: "movements" })} seesPrices={seesPrices} />}
      {view === "waste" && <WasteView pending={pendingAll} recent={await recentMovements({ money: seesPrices, kind: "WASTE", status: "POSTED", take: 30, departmentId: dept?.id })} approver={perms.approve} />}
      {view === "count" && <CountView key={dept?.id ?? "all"} items={items} />}
      {view === "recipes" && <RecipesView {...await recipesData()} />}
      {view === "setup" && (
        <SetupView setup={setupProps} canManage={perms.manage} counts={{
          dept: Object.fromEntries(setup.departments.map((d) => [d.id, setup.items.filter((i) => i.department.id === d.id).length])),
          cat: Object.fromEntries(setup.categories.map((c) => [c.id, setup.items.filter((i) => i.category.id === c.id).length])),
        }} />
      )}
    </div>
  );
}

async function Overview({ today, deptId, items, pending, perms, setup, wasteHref, movementsHref, assets, seesPrices }: {
  today: string; deptId: string | null; items: Awaited<ReturnType<typeof inventorySetup>>["items"]; pending: number;
  perms: { receive: boolean; use: boolean; approve: boolean; manage: boolean }; setup: Parameters<typeof AlertsPanel>[0]["setup"]; wasteHref: string; movementsHref: string; assets: boolean; seesPrices: boolean;
}) {
  const [day, moves, expiring, asset] = await Promise.all([
    inventoryDay(today, today, deptId), recentMovements({ money: seesPrices, take: 12, departmentId: deptId }), expiringStock(today),
    assets ? assetSummary() : Promise.resolve(null),
  ]);
  const active = items.filter((i) => i.isActive);
  const exp = deptId ? expiring.filter((e) => active.some((i) => i.id === e.item.id)) : expiring;
  const n = (l: string) => active.filter((i) => i.level === l).length;
  const figures: { label: string; value: string; sub: string; icon: LucideIcon; tint: string; tone?: string }[] = [
    { label: "Stock items", value: String(active.length), sub: `${new Set(active.map((i) => i.category.id)).size} categories`, icon: Layers, tint: "bg-sky-500/15 text-sky-500" },
    { label: "Low stock", value: String(n("LOW") + n("REORDER")), sub: `${n("LOW")} below minimum`, icon: TrendingDown, tint: "bg-amber-500/15 text-amber-500", tone: n("LOW") ? "text-amber-600 dark:text-amber-400" : undefined },
    { label: "Out of stock", value: String(n("OUT")), sub: n("OUT") ? "nothing left" : "none", icon: PackageX, tint: "bg-rose-500/15 text-rose-500", tone: n("OUT") ? "text-rose-600 dark:text-rose-400" : undefined },
    { label: "Stock value", value: short(active.reduce((t, i) => t + i.value, 0)), sub: "at the last price paid", icon: Coins, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.72_0.12_80)]" },
    { label: "Received today", value: short(day.receivedValue), sub: `${day.receivedLines} deliver${day.receivedLines === 1 ? "y" : "ies"}`, icon: ArrowDownToLine, tint: "bg-emerald-500/15 text-emerald-500", tone: day.receivedValue ? "text-emerald-600 dark:text-emerald-400" : undefined },
    { label: "Used today", value: short(day.usedValue), sub: `${day.usedItems} item${day.usedItems === 1 ? "" : "s"}${day.soldValue ? ` · ${tzs(day.soldValue)} by recipes` : ""}`, icon: Flame, tint: "bg-orange-500/15 text-orange-500" },
    { label: "Waste today", value: short(day.wasteValue), sub: `${day.wasteLines} record${day.wasteLines === 1 ? "" : "s"}`, icon: Trash2, tint: "bg-rose-500/15 text-rose-500", tone: day.wasteValue ? "text-rose-600 dark:text-rose-400" : undefined },
    { label: "Waiting approval", value: String(pending), sub: pending ? "waste to review" : "nothing waiting", icon: Hourglass, tint: "bg-violet-500/15 text-violet-500", tone: pending ? "text-amber-600 dark:text-amber-400" : undefined },
    ...(asset ? [
      { label: "Assets", value: asset.units.toLocaleString("en-US"), sub: `${asset.records} records · ${short(asset.value)}`, icon: Sofa, tint: "bg-indigo-500/15 text-indigo-500" },
      { label: "Assets in repair", value: String(asset.underRepair + asset.outOfOrder), sub: `${asset.outOfOrder} out of order`, icon: Wrench, tint: "bg-amber-500/15 text-amber-500", tone: asset.underRepair + asset.outOfOrder ? "text-amber-600 dark:text-amber-400" : undefined },
    ] : []),
  ];
  const maxUsed = Math.max(1, ...day.topUsed.map((u) => u.value));

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-3 lg:grid-cols-5">
        {figures.map((c) => (
          <div key={c.label} className="min-w-0 bg-card px-4 py-3.5">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("grid size-5 shrink-0 place-items-center rounded-md [&_svg]:size-3", c.tint)}><c.icon /></span><span className="truncate">{c.label}</span></p>
            <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums", c.tone)} title={c.value}>{c.value}</p>
            <p className="truncate text-[11px] text-muted-foreground">{c.sub}</p>
          </div>
        ))}
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <AlertsPanel items={items} expiring={exp} pendingWaste={pending} wasteHref={wasteHref} perms={perms} setup={setup} />
        <div className="space-y-4">
          <section className="rounded-3xl border border-border/70 bg-card px-4 py-3">
            <p className="mb-1 flex items-center justify-between text-sm font-semibold">Recent movements<Link href={movementsHref} className="text-xs font-semibold text-[oklch(0.6_0.12_78)] dark:text-[oklch(0.8_0.1_82)]">All →</Link></p>
            {moves.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing has moved yet.</p> : <MovementList rows={moves} />}
          </section>
          {day.topUsed.length > 0 && (
            <section className="rounded-3xl border border-border/70 bg-card p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Flame className="size-4 text-orange-500" />Used most today</p>
              <ul className="space-y-2">
                {day.topUsed.map((u) => (
                  <li key={u.name} className="text-xs">
                    <p className="flex justify-between gap-2"><span className="truncate">{u.name} · {formatQty(u.qty, u.unit)}</span><span className="font-semibold tabular-nums">{tzs(u.value)}</span></p>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-orange-500" style={{ width: `${(u.value / maxUsed) * 100}%` }} /></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

async function Movements({ deptId, kind, base, seesPrices }: { deptId: string | null; kind: string | null; base: string; seesPrices: boolean }) {
  const kinds: (MovementKind | null)[] = [null, "RECEIVE", "USE", "SALE", "WASTE", "COUNT", "ADJUST"];
  const rows = await recentMovements({ money: seesPrices, take: 150, departmentId: deptId, kind: kind && kinds.includes(kind as MovementKind) ? kind : null });
  const link = (k: string | null) => (k ? `${base}${base.includes("?") ? "&" : "?"}k=${k.toLowerCase()}` : base);
  return (
    <section className="rounded-3xl border border-border/70 bg-card">
      <div className="-mx-px overflow-x-auto border-b border-border/70 px-3 py-2 [scrollbar-width:none]">
        <div className="flex w-max gap-1">
          {kinds.map((k) => (
            <Link key={k ?? "all"} href={link(k)} aria-current={(kind ?? null) === k ? "page" : undefined}
              className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", (kind ?? null) === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
              {k ? KIND_LABEL[k] : "Everything"}
            </Link>
          ))}
        </div>
      </div>
      <div className="px-4 py-1">{rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Nothing recorded.</p> : <MovementList rows={rows} />}</div>
    </section>
  );
}
