import type { Metadata } from "next";
import { BadgePercent, BedDouble, CalendarClock, History, Percent, Tag, Tags } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { loadPricing } from "@/server/services/pricing";
import { fromDbDate } from "@/lib/time/business-date";
import { priceNight, promoLabel, WEEKDAYS, type PromoRule } from "@/lib/pricing";
import { formatDateTime, formatShortDate, formatTZS } from "@/lib/format";
import { Panel } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { DiscountRulesForm, PriceEditor, PriceRuleButton, PriceRuleSwitch, PromotionButton, PromotionSwitch, type PriceRuleData, type PricingContext, type PricingType, type PromotionData } from "./pricing-client";

export const metadata: Metadata = { title: "Room pricing" };

const CHANNEL = { ALL: "Everyone", WEBSITE: "Website only", STAFF: "Desk bookings" } as const;

/**
 * Room pricing (Admin): official room prices, promotions (all rooms, room
 * types or single rooms; % or TZS; scheduled), the manual-discount rules and
 * the history of every change. The pricing engine applies all of it.
 */
export default async function PricingPage() {
  await requirePagePermission("pricing.manage");
  const [today, settings, typesRaw, promotions, history] = await Promise.all([
    businessToday(),
    getSettings(),
    db.roomType.findMany({
      where: { isActive: true }, orderBy: { sortOrder: "asc" },
      include: { rooms: { where: { isActive: true }, select: { id: true, number: true }, orderBy: { number: "asc" } } },
    }),
    db.promotion.findMany({ orderBy: [{ isActive: "desc" }, { priority: "desc" }, { startDate: "asc" }, { createdAt: "desc" }] }),
    db.auditLog.findMany({
      where: { OR: [{ action: { startsWith: "pricing." } }, { action: "room_type.rate_changed" }] },
      orderBy: { createdAt: "desc" }, take: 25,
    }),
  ]);
  const types: PricingType[] = typesRaw.map((t) => ({ id: t.id, name: t.name, baseRate: t.baseRate, rooms: t.rooms }));
  const meetingTypes = new Set(typesRaw.filter((t) => t.category === "MEETING_ROOM").map((t) => t.id));
  const tonight = await loadPricing(db, today, today);
  const everything = await loadPricing(db, "2000-01-01", "2199-12-31");
  const context: PricingContext = { today, promos: everything.promos, rules: everything.rules };
  const priceRules = await db.priceRule.findMany({ orderBy: [{ isActive: "desc" }, { startDate: "asc" }] });
  const days = (d: number[]) => (d.length ? d.map((x) => WEEKDAYS[x]).join(", ") : "every night");
  const ruleData = (r: (typeof priceRules)[number]): PriceRuleData => ({
    id: r.id, name: r.name, scope: r.scope, roomTypeIds: r.roomTypeIds, roomIds: r.roomIds, price: r.price,
    startDate: fromDbDate(r.startDate), endDate: fromDbDate(r.endDate), daysOfWeek: r.daysOfWeek, priority: r.priority, isActive: r.isActive,
  });
  const roomNumber = new Map(typesRaw.flatMap((t) => t.rooms.map((r) => [r.id, r.number] as const)));
  const typeName = new Map(typesRaw.map((t) => [t.id, t.name]));

  const status = (p: (typeof promotions)[number]) => {
    const start = p.startDate ? fromDbDate(p.startDate) : null;
    const end = p.endDate ? fromDbDate(p.endDate) : null;
    if (!p.isActive) return "OFF" as const;
    if (end && end < today) return "ENDED" as const;
    if (start && start > today) return "UPCOMING" as const;
    return "ACTIVE" as const;
  };
  const groups = [
    { key: "ACTIVE", title: "Active now", icon: BadgePercent },
    { key: "UPCOMING", title: "Upcoming", icon: CalendarClock },
    { key: "OFF", title: "Switched off / ended", icon: History },
  ] as const;
  const toData = (p: (typeof promotions)[number]): PromotionData => ({
    id: p.id, name: p.name, type: p.type, value: p.value, scope: p.scope, roomTypeIds: p.roomTypeIds, roomIds: p.roomIds, channel: p.channel,
    startDate: p.startDate ? fromDbDate(p.startDate) : "", endDate: p.endDate ? fromDbDate(p.endDate) : "", isActive: p.isActive,
    daysOfWeek: p.daysOfWeek, priority: p.priority,
  });
  const appliesTo = (p: (typeof promotions)[number]) =>
    p.scope === "ALL" ? "All rooms"
      : p.scope === "ROOM_TYPES" ? p.roomTypeIds.map((id) => typeName.get(id) ?? "?").join(", ")
        : `Room ${p.roomIds.map((id) => roomNumber.get(id) ?? "?").join(", ")}`;
  const priceTonight = (t: PricingType, channel: "STAFF" | "WEBSITE") =>
    priceNight({ date: today, base: t.baseRate, roomTypeId: t.id, roomId: null, channel, promos: tonight.promos as PromoRule[], rules: tonight.rules });

  // The page at a glance.
  const guestTypes = types.filter((t) => !meetingTypes.has(t.id));
  const rates = guestTypes.map((t) => t.baseRate);
  const running = promotions.filter((p) => status(p) === "ACTIVE");
  const liveRules = priceRules.filter((r) => r.isActive && fromDbDate(r.startDate) <= today && fromDbDate(r.endDate) >= today);
  const comingRules = priceRules.filter((r) => r.isActive && fromDbDate(r.startDate) > today);
  const n = (v: number) => v.toLocaleString("en-US");
  const figures: { label: string; value: string; sub: string; icon: typeof Tag; tint: string }[] = [
    { label: "Room types", value: String(guestTypes.length), sub: `${guestTypes.reduce((t, x) => t + x.rooms.length, 0)} rooms${meetingTypes.size ? " · + meeting room" : ""}`, icon: BedDouble, tint: "bg-sky-500/15 text-sky-400" },
    { label: "Prices from", value: rates.length ? `${n(Math.min(...rates))} – ${n(Math.max(...rates))}` : "—", sub: "TZS a night", icon: Tag, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.8_0.11_82)]" },
    { label: "Promotions running", value: String(running.length), sub: running.length ? running.map((p) => p.name).slice(0, 2).join(" · ") : "rooms sell at their price", icon: BadgePercent, tint: "bg-rose-500/15 text-rose-400" },
    { label: "Date prices", value: String(liveRules.length), sub: comingRules.length ? `${comingRules.length} coming` : liveRules.length ? "running tonight" : "none set", icon: CalendarClock, tint: "bg-violet-500/15 text-violet-400" },
    { label: "Staff discount limit", value: `TZS ${n(settings.manualDiscountMax)}`, sub: `per night · ${[settings.receptionCanDiscount && "reception", settings.managerCanDiscount && "managers"].filter(Boolean).join(" & ") || "nobody"}`, icon: Percent, tint: "bg-emerald-500/15 text-emerald-400" },
  ];

  return (
    <div className="w-full space-y-4">
      {/* Slim header */}
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-[oklch(0.85_0.1_84)] to-[oklch(0.68_0.12_76)] text-[oklch(0.2_0.03_60)] shadow-[0_10px_24px_-14px_oklch(0.7_0.12_80)]"><Tags className="size-6" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">Pricing · tonight {formatShortDate(today)}</p>
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">Room pricing</h1>
              <p className="text-xs text-muted-foreground">Reception and the website use these prices automatically. A booking keeps the price it was made at.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2"><PriceRuleButton types={types} context={context} /><PromotionButton types={types} context={context} /></div>
        </div>
      </section>

      {/* At a glance */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-3 xl:grid-cols-5">
        {figures.map((c, i) => (
          <div key={c.label} className={cn("min-w-0 bg-card px-4 py-3.5", i === figures.length - 1 && "col-span-2 xl:col-span-1")}>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("grid size-5 shrink-0 place-items-center rounded-md [&_svg]:size-3", c.tint)}><c.icon /></span><span className="truncate">{c.label}</span></p>
            <p className="mt-1 truncate text-lg font-semibold tabular-nums">{c.value}</p>
            <p className="truncate text-[11px] text-muted-foreground">{c.sub}</p>
          </div>
        ))}
      </section>

      {/* Room prices — one card per room type */}
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Room prices</h2>
          <p className="text-[11px] text-muted-foreground">A new price counts for new bookings and added nights — booked nights never change.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {types.map((t) => {
            const meeting = meetingTypes.has(t.id);
            const desk = priceTonight(t, "STAFF");
            const web = priceTonight(t, "WEBSITE");
            const off = (net: number) => (t.baseRate > 0 && net < t.baseRate ? Math.round(((t.baseRate - net) / t.baseRate) * 100) : 0);
            const shown = t.rooms.slice(0, 10);
            return (
              <article key={t.id} className="flex flex-col rounded-3xl border border-border/70 bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground">{t.rooms.length} room{t.rooms.length === 1 ? "" : "s"}{meeting ? " · booked by time" : ""}</p>
                  </div>
                  <PriceEditor type={t} />
                </div>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">TZS</span>
                  <span className="text-3xl font-semibold tracking-tight tabular-nums">{n(t.baseRate)}</span>
                  <span className="text-xs text-muted-foreground">{meeting ? "per booking" : "a night"}</span>
                </p>
                {meeting ? (
                  <p className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">One price per meeting booking. Promotions and date prices do not apply.</p>
                ) : (
                  <dl className="mt-3 divide-y divide-border/60 rounded-2xl border border-border/60 text-xs">
                    {([["At the desk tonight", desk, [desk.priceRule?.name, desk.promotion?.name].filter(Boolean).join(" + ")], ["On the website tonight", web, web.promotion?.name ?? ""]] as const).map(([label, p, why]) => (
                      <div key={label} className="flex items-center justify-between gap-2 px-3 py-2">
                        <dt className="min-w-0 text-muted-foreground">{label}{why && <span className="mt-0.5 block truncate text-[10.5px] font-medium text-rose-600 dark:text-rose-400">{why}</span>}</dt>
                        <dd className="shrink-0 text-right">
                          <span className="font-semibold tabular-nums">{n(p.net)}</span>
                          {off(p.net) > 0 && <span className="ml-1.5 rounded-full bg-rose-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">−{off(p.net)}%</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  {shown.map((r) => r.number).join(" · ")}{t.rooms.length > shown.length && ` · +${t.rooms.length - shown.length} more`}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* Promotions */}
          <Panel title="Promotions" subtitle="One promotion a night at most: the highest priority wins (a room's own beats its room type's, which beats all rooms). They never add up.">
            <div className="space-y-4">
              {groups.map((g) => {
                const list = promotions.filter((p) => (g.key === "OFF" ? ["OFF", "ENDED"].includes(status(p)) : status(p) === g.key));
                if (!list.length && g.key !== "ACTIVE") return null;
                const I = g.icon;
                return (
                  <div key={g.key}>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><I className="size-3.5" />{g.title} · {list.length}</p>
                    {list.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">No promotion is running — rooms sell at their price.</p>
                    ) : (
                      <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
                        {list.map((p) => {
                          const st = status(p);
                          return (
                            <li key={p.id} className={cn("flex flex-wrap items-center gap-3 px-3.5 py-3", st === "ACTIVE" && "bg-rose-500/[0.04]", (st === "OFF" || st === "ENDED") && "opacity-65")}>
                              <span className={cn("grid h-10 min-w-12 shrink-0 place-items-center rounded-xl px-2 text-sm font-bold tabular-nums", st === "ACTIVE" ? "bg-rose-500/15 text-rose-600 dark:text-rose-300" : "bg-muted text-muted-foreground")}>{promoLabel(p).replace(/ off$/i, "")}</span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{p.name}</p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {appliesTo(p)} · {CHANNEL[p.channel]} · {p.startDate ? formatShortDate(fromDbDate(p.startDate)) : "From now"} → {p.endDate ? formatShortDate(fromDbDate(p.endDate)) : "until off"}{p.daysOfWeek.length ? ` · ${days(p.daysOfWeek)}` : ""}{st === "ENDED" ? " · ended" : ""}
                                </p>
                              </div>
                              <div className="flex gap-1"><PromotionButton types={types} initial={toData(p)} context={context} /><PromotionSwitch id={p.id} isActive={p.isActive} /></div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Date prices */}
          <Panel title="Date prices" subtitle="Weekend, holiday or season prices: on the nights they cover, rooms cost this instead of their normal price. Promotions apply on top.">
            {priceRules.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">No date prices — every night costs the room&apos;s normal price.</p> : (
              <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
                {priceRules.map((r) => {
                  const ended = fromDbDate(r.endDate) < today;
                  const live = r.isActive && !ended && fromDbDate(r.startDate) <= today;
                  return (
                    <li key={r.id} className={cn("flex flex-wrap items-center gap-3 px-3.5 py-3", live && "bg-violet-500/[0.04]", (!r.isActive || ended) && "opacity-65")}>
                      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", live ? "bg-violet-500/15 text-violet-600 dark:text-violet-300" : "bg-muted text-muted-foreground")}><CalendarClock className="size-4" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{r.name} <span className="font-normal text-muted-foreground">· TZS {n(r.price)} a night</span></p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {r.scope === "ALL" ? "All rooms" : r.scope === "ROOM_TYPES" ? r.roomTypeIds.map((id) => typeName.get(id) ?? "?").join(", ") : `Room ${r.roomIds.map((id) => roomNumber.get(id) ?? "?").join(", ")}`}
                          {" · "}{formatShortDate(fromDbDate(r.startDate))} → {formatShortDate(fromDbDate(r.endDate))}{r.daysOfWeek.length ? ` · ${days(r.daysOfWeek)}` : ""}{ended ? " · ended" : !r.isActive ? " · off" : live ? " · running" : ""}
                        </p>
                      </div>
                      <div className="flex gap-1"><PriceRuleButton types={types} initial={ruleData(r)} context={context} /><PriceRuleSwitch id={r.id} isActive={r.isActive} /></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Staff discounts" subtitle="The discount reception or a manager may give on one guest's room, on top of the price.">
            <DiscountRulesForm rules={{ manualDiscountMax: settings.manualDiscountMax, receptionCanDiscount: settings.receptionCanDiscount, managerCanDiscount: settings.managerCanDiscount }} />
          </Panel>

          <Panel title="Price history" subtitle="Who changed prices and promotions, and when.">
            {history.length === 0 ? <p className="text-sm text-muted-foreground">No changes yet.</p> : (
              <ol className="relative space-y-3 border-l border-border/70 pl-4 text-sm">
                {history.map((h) => {
                  const b = (h.before ?? {}) as Record<string, unknown>;
                  const a = (h.after ?? {}) as Record<string, unknown>;
                  const what =
                    h.action === "pricing.rate_changed" || h.action === "room_type.rate_changed" ? `${a.name}: ${formatTZS(Number(b.baseRate))} → ${formatTZS(Number(a.baseRate))}`
                      : h.action === "pricing.promotion_created" ? `Created “${a.name}” (${a.type === "PERCENT" ? `${a.value}%` : formatTZS(Number(a.value))} off)`
                        : h.action === "pricing.promotion_updated" ? `Changed “${a.name}”`
                          : h.action === "pricing.promotion_activated" ? `Switched on “${a.name}”`
                            : h.action === "pricing.promotion_deactivated" ? `Switched off “${a.name}”`
                              : h.action === "pricing.discount_rules" ? `Staff discount rules: most ${formatTZS(Number(a.manualDiscountMax))}`
                                : h.action === "pricing.date_price_created" ? `Created date price “${a.name}” (${formatTZS(Number(a.price))}, ${a.start} → ${a.end})`
                                  : h.action === "pricing.date_price_updated" ? `Changed date price “${a.name}”`
                                    : h.action === "pricing.date_price_on" ? `Switched on date price “${a.name}”`
                                      : h.action === "pricing.date_price_off" ? `Switched off date price “${a.name}”` : h.action;
                  return (
                    <li key={h.id} className="relative">
                      <span aria-hidden className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-[oklch(0.72_0.12_80)] ring-4 ring-card" />
                      <p className="font-medium leading-snug">{what}</p>
                      <p className="text-[11px] text-muted-foreground">{h.actorLabel ?? "System"} · {formatDateTime(h.createdAt)}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
