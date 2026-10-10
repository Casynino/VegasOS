import type { Metadata } from "next";
import { BadgePercent, BedDouble, CalendarClock, History, Percent, Tag, Tags } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { loadPricing } from "@/server/services/pricing";
import { fromDbDate } from "@/lib/time/business-date";
import { priceNight, promoLabel, WEEKDAYS, type PromoRule } from "@/lib/pricing";
import { formatTZS } from "@/lib/format";
import { Panel } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { DiscountRulesForm, PriceEditor, PriceRuleButton, PriceRuleSwitch, PromotionButton, PromotionSwitch, type PriceRuleData, type PricingContext, type PricingType, type PromotionData } from "./pricing-client";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Room pricing") };
}

const CHANNEL = { ALL: msg("Everyone"), WEBSITE: msg("Website only"), STAFF: msg("Desk bookings") } as const;

/**
 * Room pricing (Admin): official room prices, promotions (all rooms, room
 * types or single rooms; % or TZS; scheduled), the manual-discount rules and
 * the history of every change. The pricing engine applies all of it.
 */
export default async function PricingPage() {
  await requirePagePermission("pricing.manage");
  const t = await getT();
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
  const types: PricingType[] = typesRaw.map((rt) => ({ id: rt.id, name: rt.name, baseRate: rt.baseRate, rooms: rt.rooms }));
  const meetingTypes = new Set(typesRaw.filter((rt) => rt.category === "MEETING_ROOM").map((rt) => rt.id));
  const tonight = await loadPricing(db, today, today);
  const everything = await loadPricing(db, "2000-01-01", "2199-12-31");
  const context: PricingContext = { today, promos: everything.promos, rules: everything.rules };
  const priceRules = await db.priceRule.findMany({ orderBy: [{ isActive: "desc" }, { startDate: "asc" }] });
  const days = (d: number[]) => (d.length ? d.map((x) => t(WEEKDAYS[x])).join(", ") : t("every night"));
  const ruleData = (r: (typeof priceRules)[number]): PriceRuleData => ({
    id: r.id, name: r.name, scope: r.scope, roomTypeIds: r.roomTypeIds, roomIds: r.roomIds, price: r.price,
    startDate: fromDbDate(r.startDate), endDate: fromDbDate(r.endDate), daysOfWeek: r.daysOfWeek, priority: r.priority, isActive: r.isActive,
  });
  const roomNumber = new Map(typesRaw.flatMap((rt) => rt.rooms.map((r) => [r.id, r.number] as const)));
  const typeName = new Map(typesRaw.map((rt) => [rt.id, t(rt.name)]));

  const status = (p: (typeof promotions)[number]) => {
    const start = p.startDate ? fromDbDate(p.startDate) : null;
    const end = p.endDate ? fromDbDate(p.endDate) : null;
    if (!p.isActive) return "OFF" as const;
    if (end && end < today) return "ENDED" as const;
    if (start && start > today) return "UPCOMING" as const;
    return "ACTIVE" as const;
  };
  const groups = [
    { key: "ACTIVE", title: t("Active now"), icon: BadgePercent },
    { key: "UPCOMING", title: t("Upcoming"), icon: CalendarClock },
    { key: "OFF", title: t("Switched off / ended"), icon: History },
  ] as const;
  const toData = (p: (typeof promotions)[number]): PromotionData => ({
    id: p.id, name: p.name, type: p.type, value: p.value, scope: p.scope, roomTypeIds: p.roomTypeIds, roomIds: p.roomIds, channel: p.channel,
    startDate: p.startDate ? fromDbDate(p.startDate) : "", endDate: p.endDate ? fromDbDate(p.endDate) : "", isActive: p.isActive,
    daysOfWeek: p.daysOfWeek, priority: p.priority,
  });
  const appliesTo = (p: { scope: string; roomTypeIds: string[]; roomIds: string[] }) =>
    p.scope === "ALL" ? t("All rooms")
      : p.scope === "ROOM_TYPES" ? p.roomTypeIds.map((id) => typeName.get(id) ?? "?").join(", ")
        : t("Room {rooms}", { rooms: p.roomIds.map((id) => roomNumber.get(id) ?? "?").join(", ") });
  const priceTonight = (rt: PricingType, channel: "STAFF" | "WEBSITE") =>
    priceNight({ date: today, base: rt.baseRate, roomTypeId: rt.id, roomId: null, channel, promos: tonight.promos as PromoRule[], rules: tonight.rules });

  // The page at a glance.
  const guestTypes = types.filter((rt) => !meetingTypes.has(rt.id));
  const rates = guestTypes.map((rt) => rt.baseRate);
  const running = promotions.filter((p) => status(p) === "ACTIVE");
  const liveRules = priceRules.filter((r) => r.isActive && fromDbDate(r.startDate) <= today && fromDbDate(r.endDate) >= today);
  const comingRules = priceRules.filter((r) => r.isActive && fromDbDate(r.startDate) > today);
  const n = (v: number) => v.toLocaleString("en-US");
  const figures: { label: string; value: string; sub: string; icon: typeof Tag; tint: string }[] = [
    { label: t("Room types"), value: String(guestTypes.length), sub: `${t("{n} rooms", { n: guestTypes.reduce((sum, x) => sum + x.rooms.length, 0) })}${meetingTypes.size ? ` · ${t("+ meeting room")}` : ""}`, icon: BedDouble, tint: "bg-sky-500/15 text-sky-400" },
    { label: t("Prices from"), value: rates.length ? `${n(Math.min(...rates))} – ${n(Math.max(...rates))}` : "—", sub: t("TZS a night"), icon: Tag, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.8_0.11_82)]" },
    { label: t("Promotions running"), value: String(running.length), sub: running.length ? running.map((p) => p.name).slice(0, 2).join(" · ") : t("rooms sell at their price"), icon: BadgePercent, tint: "bg-rose-500/15 text-rose-400" },
    { label: t("Date prices"), value: String(liveRules.length), sub: comingRules.length ? t("{n} coming", { n: comingRules.length }) : liveRules.length ? t("running tonight") : t("none set"), icon: CalendarClock, tint: "bg-violet-500/15 text-violet-400" },
    { label: t("Staff discount limit"), value: `TZS ${n(settings.manualDiscountMax)}`, sub: t("per night · {who}", { who: [settings.receptionCanDiscount && t("reception"), settings.managerCanDiscount && t("managers")].filter(Boolean).join(" & ") || t("nobody") }), icon: Percent, tint: "bg-emerald-500/15 text-emerald-400" },
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
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t("Pricing · tonight {date}", { date: t.shortDate(today) })}</p>
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{t("Room pricing")}</h1>
              <p className="text-xs text-muted-foreground">{t("Reception and the website use these prices automatically. A booking keeps the price it was made at.")}</p>
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
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("Room prices")}</h2>
          <p className="text-[11px] text-muted-foreground">{t("A new price counts for new bookings and added nights — booked nights never change.")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {types.map((rt) => {
            const meeting = meetingTypes.has(rt.id);
            const desk = priceTonight(rt, "STAFF");
            const web = priceTonight(rt, "WEBSITE");
            const off = (net: number) => (rt.baseRate > 0 && net < rt.baseRate ? Math.round(((rt.baseRate - net) / rt.baseRate) * 100) : 0);
            const shown = rt.rooms.slice(0, 10);
            return (
              <article key={rt.id} className="flex flex-col rounded-3xl border border-border/70 bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{t(rt.name)}</p>
                    <p className="text-[11px] text-muted-foreground">{t.plural(rt.rooms.length, "{n} room", "{n} rooms")}{meeting ? ` · ${t("booked by time")}` : ""}</p>
                  </div>
                  <PriceEditor type={rt} />
                </div>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">TZS</span>
                  <span className="text-3xl font-semibold tracking-tight tabular-nums">{n(rt.baseRate)}</span>
                  <span className="text-xs text-muted-foreground">{meeting ? t("per booking") : t("a night")}</span>
                </p>
                {meeting ? (
                  <p className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{t("One price per meeting booking. Promotions and date prices do not apply.")}</p>
                ) : (
                  <dl className="mt-3 divide-y divide-border/60 rounded-2xl border border-border/60 text-xs">
                    {([[msg("At the desk tonight"), desk, [desk.priceRule?.name, desk.promotion?.name].filter(Boolean).join(" + ")], [msg("On the website tonight"), web, web.promotion?.name ?? ""]] as const).map(([label, p, why]) => (
                      <div key={label} className="flex items-center justify-between gap-2 px-3 py-2">
                        <dt className="min-w-0 text-muted-foreground">{t(label)}{why && <span className="mt-0.5 block truncate text-[10.5px] font-medium text-rose-600 dark:text-rose-400">{why}</span>}</dt>
                        <dd className="shrink-0 text-right">
                          <span className="font-semibold tabular-nums">{n(p.net)}</span>
                          {off(p.net) > 0 && <span className="ml-1.5 rounded-full bg-rose-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">−{off(p.net)}%</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  {shown.map((r) => r.number).join(" · ")}{rt.rooms.length > shown.length && ` · ${t("+{n} more", { n: rt.rooms.length - shown.length })}`}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* Promotions */}
          <Panel title={t("Promotions")} subtitle={t("One promotion a night at most: the highest priority wins (a room's own beats its room type's, which beats all rooms). They never add up.")}>
            <div className="space-y-4">
              {groups.map((g) => {
                const list = promotions.filter((p) => (g.key === "OFF" ? ["OFF", "ENDED"].includes(status(p)) : status(p) === g.key));
                if (!list.length && g.key !== "ACTIVE") return null;
                const I = g.icon;
                return (
                  <div key={g.key}>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><I className="size-3.5" />{g.title} · {list.length}</p>
                    {list.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">{t("No promotion is running — rooms sell at their price.")}</p>
                    ) : (
                      <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
                        {list.map((p) => {
                          const st = status(p);
                          return (
                            <li key={p.id} className={cn("flex flex-wrap items-center gap-3 px-3.5 py-3", st === "ACTIVE" && "bg-rose-500/[0.04]", (st === "OFF" || st === "ENDED") && "opacity-65")}>
                              <span className={cn("grid h-10 min-w-12 shrink-0 place-items-center rounded-xl px-2 text-sm font-bold tabular-nums", st === "ACTIVE" ? "bg-rose-500/15 text-rose-600 dark:text-rose-300" : "bg-muted text-muted-foreground")}>{promoLabel(p, t).replace(/ off$/i, "")}</span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{p.name}</p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                  {appliesTo(p)} · {t(CHANNEL[p.channel])} · {p.startDate ? t.shortDate(fromDbDate(p.startDate)) : t("From now")} → {p.endDate ? t.shortDate(fromDbDate(p.endDate)) : t("until off")}{p.daysOfWeek.length ? ` · ${days(p.daysOfWeek)}` : ""}{st === "ENDED" ? ` · ${t("ended")}` : ""}
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
          <Panel title={t("Date prices")} subtitle={t("Weekend, holiday or season prices: on the nights they cover, rooms cost this instead of their normal price. Promotions apply on top.")}>
            {priceRules.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">{t("No date prices — every night costs the room's normal price.")}</p> : (
              <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
                {priceRules.map((r) => {
                  const ended = fromDbDate(r.endDate) < today;
                  const live = r.isActive && !ended && fromDbDate(r.startDate) <= today;
                  return (
                    <li key={r.id} className={cn("flex flex-wrap items-center gap-3 px-3.5 py-3", live && "bg-violet-500/[0.04]", (!r.isActive || ended) && "opacity-65")}>
                      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", live ? "bg-violet-500/15 text-violet-600 dark:text-violet-300" : "bg-muted text-muted-foreground")}><CalendarClock className="size-4" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{r.name} <span className="font-normal text-muted-foreground">· {t("TZS {amount} a night", { amount: n(r.price) })}</span></p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {appliesTo(r)}
                          {" · "}{t.shortDate(fromDbDate(r.startDate))} → {t.shortDate(fromDbDate(r.endDate))}{r.daysOfWeek.length ? ` · ${days(r.daysOfWeek)}` : ""}{ended ? ` · ${t("ended")}` : !r.isActive ? ` · ${t("off")}` : live ? ` · ${t("running")}` : ""}
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
          <Panel title={t("Staff discounts")} subtitle={t("The discount reception or a manager may give on one guest's room, on top of the price.")}>
            <DiscountRulesForm rules={{ manualDiscountMax: settings.manualDiscountMax, receptionCanDiscount: settings.receptionCanDiscount, managerCanDiscount: settings.managerCanDiscount }} />
          </Panel>

          <Panel title={t("Price history")} subtitle={t("Who changed prices and promotions, and when.")}>
            {history.length === 0 ? <p className="text-sm text-muted-foreground">{t("No changes yet.")}</p> : (
              <ol className="relative space-y-3 border-l border-border/70 pl-4 text-sm">
                {history.map((h) => {
                  const b = (h.before ?? {}) as Record<string, unknown>;
                  const a = (h.after ?? {}) as Record<string, unknown>;
                  const name = String(a.name);
                  const what =
                    h.action === "pricing.rate_changed" || h.action === "room_type.rate_changed" ? `${t(name)}: ${formatTZS(Number(b.baseRate))} → ${formatTZS(Number(a.baseRate))}`
                      : h.action === "pricing.promotion_created" ? t("Created “{name}” ({discount} off)", { name, discount: a.type === "PERCENT" ? `${a.value}%` : formatTZS(Number(a.value)) })
                        : h.action === "pricing.promotion_updated" ? t("Changed “{name}”", { name })
                          : h.action === "pricing.promotion_activated" ? t("Switched on “{name}”", { name })
                            : h.action === "pricing.promotion_deactivated" ? t("Switched off “{name}”", { name })
                              : h.action === "pricing.discount_rules" ? t("Staff discount rules: most {amount}", { amount: formatTZS(Number(a.manualDiscountMax)) })
                                : h.action === "pricing.date_price_created" ? t("Created date price “{name}” ({price}, {from} → {to})", { name, price: formatTZS(Number(a.price)), from: String(a.start), to: String(a.end) })
                                  : h.action === "pricing.date_price_updated" ? t("Changed date price “{name}”", { name })
                                    : h.action === "pricing.date_price_on" ? t("Switched on date price “{name}”", { name })
                                      : h.action === "pricing.date_price_off" ? t("Switched off date price “{name}”", { name }) : h.action;
                  return (
                    <li key={h.id} className="relative">
                      <span aria-hidden className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-[oklch(0.72_0.12_80)] ring-4 ring-card" />
                      <p className="font-medium leading-snug">{what}</p>
                      <p className="text-[11px] text-muted-foreground">{h.actorLabel ?? t("System")} · {t.dateTime(h.createdAt)}</p>
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
