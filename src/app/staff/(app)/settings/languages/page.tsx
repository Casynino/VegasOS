import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { TRANSLATABLE, contentCoverage } from "@/server/services/translations";
import { COVERAGE } from "@/i18n/coverage";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddChinese, ChineseOfferedSwitch } from "./languages-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Languages") };
}

/** Where each kind of content is edited beside its English. */
const EDIT_HREF: Record<string, string> = {
  menuItem: "/staff/restaurant/menu", menuCategory: "/staff/restaurant/menu", roomType: "/staff/rooms/manage", amenity: "/staff/rooms/manage",
  hotelService: "/staff/website", transportService: "/staff/transport", transportServiceOption: "/staff/transport",
};
const SHOWN_MISSING = 12;

function Meter({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      <div className={cn("h-full rounded-full", pct === 100 ? "bg-emerald-500" : "bg-[oklch(0.72_0.12_80)]")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Settings → Languages: which languages guests are offered, and how much of the interface and of the hotel's own
 * content (menu, rooms, services, transport) is in Chinese — with the missing items to translate right here.
 */
export default async function LanguagesPage() {
  await requirePagePermission("settings.manage");
  const t = await getT();
  const [settings, content, staffZh, guestsZh] = await Promise.all([
    getSettings(),
    contentCoverage(),
    db.user.count({ where: { isActive: true, preferredLanguage: "zh-CN" } }),
    db.guest.count({ where: { preferredLanguage: "zh-CN" } }),
  ]);
  const zhOn = settings.enabledLanguages.includes("zh-CN");
  const ui = COVERAGE["zh-CN"] ?? { total: 0, translated: 0, missing: [] };
  const uiPct = ui.total ? Math.round((ui.translated / ui.total) * 100) : 100;
  const contentTotal = content.reduce((s, c) => s + c.total, 0);
  const contentDone = content.reduce((s, c) => s + (c.per["zh-CN"]?.translated ?? 0), 0);

  return (
    <div className="w-full space-y-5">
      <PageHeader eyebrow={t("Settings")} title={t("Languages")}
        description={t("One hotel, one set of records — each person sees it in their own language. Language never changes prices, permissions or what anyone can do.")} />

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("Languages offered")}</CardTitle>
            <CardDescription>{t("What guests can choose on the website and the QR and guest pages.")}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border/60 p-0">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="leading-tight">
                <p className="font-medium">English</p>
                <p className="text-xs text-muted-foreground">{t("Default — always on. Anything not translated shows in English.")}</p>
              </div>
              <Badge variant="outline" className="gap-1"><Check className="size-3" />{t("Always on")}</Badge>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="leading-tight">
                <p className="font-medium" lang="zh-CN">简体中文</p>
                <p className="text-xs text-muted-foreground">
                  {zhOn ? t("Offered — guests see the language switch.") : t("Not offered — the switch is hidden for guests.")}
                </p>
              </div>
              <ChineseOfferedSwitch on={zhOn} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("How it works")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>{t("English is the fallback: anything without a Chinese translation shows in English — never blank.")}</li>
              <li>{t("Staff each choose their own language in the top bar; it is saved on their account. {n} staff use Chinese now.", { n: staffZh })}</li>
              <li>{t("Guests choose on the website and the QR pages; a phone set to Chinese starts in Chinese. {n} customers chose Chinese.", { n: guestsZh })}</li>
              <li>{t("Names, phone numbers, amounts, references and what people type are never translated.")}</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("Interface")}</CardTitle>
          <CardDescription>{t("Buttons, labels and messages of the app, the website and the guest pages.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span lang="zh-CN" className="font-medium">简体中文</span>
            <span className="tabular-nums text-muted-foreground">{t("{done} of {total} translated · {pct}%", { done: ui.translated, total: ui.total, pct: uiPct })}</span>
          </div>
          <Meter value={ui.translated} total={ui.total} />
          {ui.missing.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <p className="mb-1">{t("Still in English, for example:")}</p>
              <ul className="space-y-0.5">
                {ui.missing.slice(0, 5).map((m) => <li key={m} className="truncate">“{m}”</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("The hotel's content in Chinese")}</CardTitle>
          <CardDescription>
            {t("Dishes, rooms, amenities, services and transport. Most have a built-in Chinese; anything new or renamed shows in English until it is translated. {done} of {total} done.", { done: contentDone, total: contentTotal })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {content.map((c) => {
            const per = c.per["zh-CN"] ?? { translated: c.total, missing: [] };
            const withDescription = (TRANSLATABLE[c.kind].fields as readonly string[]).includes("description");
            return (
              <section key={c.kind} className="overflow-hidden rounded-2xl border border-border/70">
                <header className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t(c.label)}</h3>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="tabular-nums">{t("{done} of {total}", { done: per.translated, total: c.total })}</span>
                      <Link href={EDIT_HREF[c.kind]} className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline">{t("Edit all")}<ArrowRight className="size-3" /></Link>
                    </span>
                  </div>
                  <Meter value={per.translated} total={c.total} />
                </header>
                {per.missing.length > 0 && (
                  <ul className="divide-y divide-border/50 border-t border-border/60 bg-muted/20">
                    {per.missing.slice(0, SHOWN_MISSING).map((m) => (
                      <AddChinese key={m.id} kind={c.kind} id={m.id} name={m.name} description={m.description} withDescription={withDescription} />
                    ))}
                    {per.missing.length > SHOWN_MISSING && (
                      <li className="px-4 py-2 text-xs text-muted-foreground">{t("+ {n} more — add them here as you go, or on their own page.", { n: per.missing.length - SHOWN_MISSING })}</li>
                    )}
                  </ul>
                )}
              </section>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
