import Link from "next/link";
import { ArrowRight, BedDouble, Bike, Flame, UtensilsCrossed, Wine } from "lucide-react";
import { Initials } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";

export type TodayNumbersData = {
  food: number; foodOrders: number; drinks: number; drinkOrders: number;
  roomService: number; roomServiceOrders: number; fees: number;
  avgPrep: number | null; avgDelivery: number | null;
  sources: { label: string; count: number }[];
  team: { name: string; accepted: number; ready: number; taken: number; delivered: number }[];
};

const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;

/**
 * The manager's day in one card, next to the live feed: what sold (food vs drinks, room service),
 * how fast the kitchen and waiters are, where orders came from and who handled them.
 * How it was paid lives in the money band at the top, so it isn't repeated here.
 */
export async function TodayNumbers({ d }: { d: TodayNumbersData }) {
  const t = await getT();
  const sold = d.food + d.drinks;
  const foodShare = sold ? Math.round((d.food / sold) * 100) : 0;
  const orders = d.sources.reduce((n, s) => n + s.count, 0);
  return (
    <section className="@container flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div>
          <h2 className="text-base font-semibold">{t("Today in numbers")}</h2>
          <p className="text-xs text-muted-foreground">{t.plural(orders, "{n} order so far today", "{n} orders so far today")}</p>
        </div>
        <Link href="/staff/reports" className="inline-flex items-center gap-1 text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.8_0.11_82)]">{t("Reports")}<ArrowRight className="size-3.5" /></Link>
      </div>

      <div className="mt-3 grid flex-1 grid-cols-1 border-t border-border/70 @2xl:grid-cols-2 [&>div]:border-border/60 [&>div]:px-4 [&>div]:py-3.5 sm:[&>div]:px-5 [&>div:not(:last-child)]:border-b @2xl:[&>div:first-child]:border-r">
        {/* What sold */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Sold")}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{tzs(sold)}</p>
          <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
            {d.food > 0 && <span className="h-full rounded-full bg-amber-500" style={{ width: `${foodShare}%` }} />}
            {d.drinks > 0 && <span className="h-full flex-1 rounded-full bg-sky-500" />}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <Split icon={<UtensilsCrossed />} tone="bg-amber-500/15 text-amber-600 dark:text-amber-300" label={t("Food")} value={tzs(d.food)} sub={t.plural(d.foodOrders, "{n} order", "{n} orders")} />
            <Split icon={<Wine />} tone="bg-sky-500/15 text-sky-600 dark:text-sky-300" label={t("Drinks")} value={tzs(d.drinks)} sub={t.plural(d.drinkOrders, "{n} order", "{n} orders")} />
          </div>
          <p className="mt-2.5 flex items-center gap-2 rounded-xl bg-violet-500/10 px-2.5 py-1.5 text-xs">
            <BedDouble className="size-3.5 shrink-0 text-violet-500" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{t("Room service")} · {t.plural(d.roomServiceOrders, "{n} order", "{n} orders")}{d.fees ? ` · ${t("fees {amount}", { amount: tzs(d.fees) })}` : ""}</span>
            <strong className="shrink-0 font-semibold tabular-nums">{tzs(d.roomService)}</strong>
          </p>
        </div>

        {/* Speed */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Speed today")}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Speed t={t} icon={<Flame />} tone="text-amber-500" label={t("Preparation")} minutes={d.avgPrep} hint={t("accepted → ready")} />
            <Speed t={t} icon={<Bike />} tone="text-violet-500" label={t("Serving")} minutes={d.avgDelivery} hint={t("ready → served")} />
          </div>
          {d.sources.length > 0 && (
            <>
              <p className="mt-3.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Came from")}</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {d.sources.map((s) => (
                  <li key={s.label} className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-xs">
                    {t(s.label)}<strong className="tabular-nums">{s.count}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Who handled orders */}
        <div className="@2xl:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Team today")}</p>
          {d.team.length === 0 ? <p className="mt-1.5 text-sm text-muted-foreground">{t("Nobody has handled an order yet today.")}</p> : (
            <ul className="mt-2 grid max-h-[8.5rem] gap-1.5 overflow-y-auto overscroll-contain [scrollbar-width:thin] @lg:grid-cols-2">
              {d.team.map((p) => (
                <li key={p.name} className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-2.5 py-1.5">
                  <Initials name={p.name} className="size-7 text-[10px]" />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm font-medium">{p.name.replace(/\s*\(.*\)/, "")}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{[p.accepted && t("{n} accepted", { n: p.accepted }), p.ready && t("{n} ready", { n: p.ready }), p.taken && t("{n} brought out", { n: p.taken }), p.delivered && t("{n} served", { n: p.delivered })].filter(Boolean).join(" · ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Split({ icon, tone, label, value, sub }: { icon: React.ReactNode; tone: string; label: string; value: string; sub: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5", tone)}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-muted-foreground">{label} · {sub}</span>
        <span className="block truncate font-semibold tabular-nums text-foreground">{value}</span>
      </span>
    </div>
  );
}

function Speed({ t, icon, tone, label, minutes, hint }: { t: T; icon: React.ReactNode; tone: string; label: string; minutes: number | null; hint: string }) {
  return (
    <div className="rounded-2xl bg-muted/50 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("[&_svg]:size-3.5", tone)}>{icon}</span>{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{minutes != null ? <>{minutes}<span className="ml-1 text-xs font-normal text-muted-foreground">{t("min")}</span></> : <span className="text-muted-foreground">—</span>}</p>
      <p className="truncate text-[10px] text-muted-foreground">{minutes != null ? hint : t("none finished yet")}</p>
    </div>
  );
}
