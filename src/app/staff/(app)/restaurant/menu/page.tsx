import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, UtensilsCrossed, Wine } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { mediaUrl } from "@/server/services/media";
import { formatTZS } from "@/lib/format";
import { PageHeader } from "@/components/staff/page-header";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { translationForms } from "@/server/services/translations";
import { AvailableToggle, CategoryButton, MenuItemButton, MoveCategory } from "./menu-dialogs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Menu & prices") };
}

/**
 * Menu & prices — the one place prices live. Changes reach the order screen and
 * the website at once; orders already taken keep the price they were charged.
 */
export default async function MenuAdminPage() {
  await requirePagePermission("restaurant.menu");
  const t = await getT();
  const [cats, settings] = await Promise.all([
    db.menuCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: { items: { orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }], include: { image: true } } },
    }),
    getSettings(),
  ]);
  const options = cats.map((c) => ({ id: c.id, name: t(c.name) }));
  const [catZh, itemZh] = await Promise.all([translationForms("menuCategory", cats), translationForms("menuItem", cats.flatMap((c) => c.items))]);
  /** The Chinese shown to Chinese guests (saved, else the default), for a quiet hint beside the English. */
  const zhName = (f: { values: Record<string, string>; hints: Record<string, string> } | undefined) => f?.values.name || f?.hints.name || null;
  const total = cats.reduce((s, c) => s + c.items.filter((i) => i.isActive).length, 0);

  return (
    <div className="w-full space-y-5">
      <PageHeader title={t("Menu & prices")} description={t("{n} items on the menu. Room-service delivery fee: {fee} (change it in Settings → Hotel).", { n: total, fee: formatTZS(settings.roomServiceFee) })}
        actions={<div className="flex gap-2"><Link href="/menu" target="_blank" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><ExternalLink className="size-4" />{t("See it on the website")}</Link><CategoryButton /></div>} />

      <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {cats.map((c) => (
          <a key={c.id} href={`#${c.slug}`} className={cn("shrink-0 rounded-full border border-border/70 bg-card px-3.5 py-1.5 text-xs font-medium hover:bg-muted", !c.isActive && "opacity-50")}>{t(c.name)} · {c.items.filter((i) => i.isActive).length}</a>
        ))}
      </nav>

      {cats.map((c) => (
        <section key={c.id} id={c.slug} className={cn("scroll-mt-24 overflow-hidden rounded-3xl border border-border/70 bg-card", !c.isActive && "opacity-60")}>
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className={cn("grid size-9 place-items-center rounded-xl", c.type === "DRINK" ? "bg-rose-500/12 text-rose-600 dark:text-rose-300" : "bg-orange-500/12 text-orange-600 dark:text-orange-300")}>
                {c.type === "DRINK" ? <Wine className="size-4" /> : <UtensilsCrossed className="size-4" />}
              </span>
              <div className="leading-tight">
                <p className="font-semibold">{c.name}{zhName(catZh[c.id]) && <span lang="zh-CN" className="ml-2 text-sm font-normal text-muted-foreground">{zhName(catZh[c.id])}</span>}{!c.isActive && <span className="ml-2 text-xs font-normal text-muted-foreground">{t("hidden")}</span>}</p>
                <p className="text-xs text-muted-foreground">{c.type === "DRINK" ? t("Drinks") : t("Food")} · {c.revenueKind === "BAR" ? t("counts as bar income") : t("counts as restaurant income")}{c.description ? ` · ${c.description}` : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-1"><MoveCategory id={c.id} /><CategoryButton category={c} zh={catZh[c.id]} /><MenuItemButton categories={options} defaultCategory={c.id} /></div>
          </header>
          <ul className="divide-y divide-border/50">
            {c.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">{t("No items yet.")}</li>}
            {c.items.map((i) => {
              const img = i.image?.isActive ? mediaUrl(i.image) : null;
              return (
                <li key={i.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5", !i.isActive && "opacity-50")}>
                  {img
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={img} alt="" className="size-11 shrink-0 rounded-xl object-cover" loading="lazy" />
                    : <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground">{i.name.slice(0, 1)}</span>}
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate font-medium">{i.name}{zhName(itemZh[i.id]) && <span lang="zh-CN" className="ml-2 text-xs font-normal text-muted-foreground">{zhName(itemZh[i.id])}</span>}{i.isFeatured && <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold text-amber-600 dark:text-amber-300">★ {t("Featured")}</span>}{!i.isActive && <span className="ml-2 text-xs font-normal">· {t("off the menu")}</span>}</p>
                    <p className="truncate text-xs text-muted-foreground">{[i.subcategory, i.description].filter(Boolean).join(" · ") || t("No description")}</p>
                  </div>
                  <span className="w-28 text-right font-semibold tabular-nums">{formatTZS(i.price)}</span>
                  <AvailableToggle id={i.id} isAvailable={i.isAvailable} />
                  <MenuItemButton categories={options} item={{ id: i.id, categoryId: i.categoryId, name: i.name, description: i.description, price: i.price, subcategory: i.subcategory, isAvailable: i.isAvailable, isActive: i.isActive, isFeatured: i.isFeatured, image: img }} zh={itemZh[i.id]} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
