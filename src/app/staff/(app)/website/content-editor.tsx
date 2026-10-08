"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ImageIcon, Languages, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resetContentAction, saveContentAction } from "./actions";

/** The Chinese of a text field: what staff saved, and what Chinese visitors see without it. */
type Zh = { value: unknown; fallback: unknown; fallbackIsEnglish: boolean; stale: boolean };
type Field = {
  path: string; label: string; type: "text" | "textarea" | "list" | "image"; help?: string;
  value: unknown; isCustom: boolean; shared: boolean; zh: Zh | null;
};
type Section = { key: string; title: string; fields: Field[] };
type Media = { id: string; src: string; title: string; altText: string; category: string; isIllustrative: boolean };
type Lang = "en" | "zh-CN";

const asText = (v: unknown, list: boolean) => (list ? (Array.isArray(v) ? v.join("\n") : "") : v === null || v === undefined ? "" : String(v));
/** Chinese visitors see the English for this field (it was changed in English and not translated yet). */
const showsEnglish = (f: Field) => !!f.zh && f.zh.value === null && f.zh.fallbackIsEnglish;

export function ContentEditor({ sections, media }: { sections: Section[]; media: Media[] }) {
  const t = useT();
  const [active, setActive] = useState(sections[0]?.key);
  const [langs, setLangs] = useState<Record<string, Lang>>({});
  const section = sections.find((s) => s.key === active) ?? sections[0];
  const lang: Lang = langs[section.key] ?? "en";
  const translatable = section.fields.some((f) => !f.shared);
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label={t("Website sections")}>
        {sections.map((s) => (
          <button key={s.key} onClick={() => setActive(s.key)}
            className={cn("shrink-0 rounded-lg px-3 py-2 text-left text-sm", s.key === section.key ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {t(s.title)}{s.fields.some((f) => f.isCustom) && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-[oklch(0.72_0.12_80)] align-middle" />}
            {s.fields.some(showsEnglish) && <span className="ml-1 text-[10px] font-medium opacity-70" title={t("Some text shows in English to Chinese visitors")}>中</span>}
          </button>
        ))}
      </nav>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{t(section.title)}</CardTitle>
            {lang === "zh-CN" && (
              <CardDescription>
                {t("What Chinese visitors see. Leave a field empty to show the default Chinese — or the English, when the English was changed and not translated yet.")}
              </CardDescription>
            )}
          </div>
          {translatable && (
            <div role="group" aria-label={t("Language")} className="inline-flex shrink-0 rounded-lg border p-0.5 text-sm">
              {(["en", "zh-CN"] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLangs((m) => ({ ...m, [section.key]: l }))}
                  className={cn("rounded-md px-3 py-1", lang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                  {l === "en" ? "EN" : "中文"}
                </button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {section.fields.map((f) =>
            lang === "zh-CN" && f.zh
              ? <ChineseFieldEditor key={`zh:${f.path}`} field={f} zh={f.zh} />
              : <FieldEditor key={`en:${f.path}`} field={f} media={media} sharedNote={lang === "zh-CN"} />)}
        </CardContent>
      </Card>
    </div>
  );
}

function useRun() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(r.message ?? t("Saved")); router.refresh(); } else toast.error(r.error); });
  return { pending, run };
}

function FieldEditor({ field, media, sharedNote }: { field: Field; media: Media[]; sharedNote: boolean }) {
  const t = useT();
  const { pending, run } = useRun();
  const initial = field.type === "image" ? "" : asText(field.value, field.type === "list");
  const [value, setValue] = useState(initial);
  const [picking, setPicking] = useState(false);
  const img = field.type === "image" ? (field.value as { src: string; alt: string } | undefined) : undefined;

  return (
    <div className="space-y-1.5 border-b pb-5 last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={field.path}>{t(field.label)} {field.isCustom && <Badge variant="outline" className="ml-1">{t("edited")}</Badge>}</Label>
        {field.isCustom && <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => resetContentAction({ path: field.path }))}><RotateCcw /> {t("Default")}</Button>}
      </div>
      {field.type === "image" ? (
        <div className="flex items-center gap-3">
          {img?.src && (
            // eslint-disable-next-line @next/next/no-img-element -- CMS preview of arbitrary library images
            <img src={img.src} alt={img.alt} className="h-20 w-32 rounded-lg object-cover" />
          )}
          <Button variant="outline" onClick={() => setPicking(true)}><ImageIcon /> {t("Choose photo")}</Button>
          <Dialog open={picking} onOpenChange={setPicking}>
            <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-4xl">
              <DialogHeader icon={<ImageIcon />} eyebrow={t("Website")} tone="violet"><DialogTitle>{t("Choose a photo")}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {media.map((m) => (
                  <button key={m.id} className="group relative overflow-hidden rounded-lg border text-left focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
                    onClick={() => { setPicking(false); run(() => saveContentAction({ path: field.path, value: m.id })); }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.src} alt={m.altText} className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                    <span className="block truncate px-2 py-1 text-xs">{m.title}{m.isIllustrative && ` · ${t("illustrative")}`}</span>
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          {field.type === "text" ? <Input id={field.path} value={value} onChange={(e) => setValue(e.target.value)} /> :
            <Textarea id={field.path} rows={field.type === "list" ? 5 : 3} value={value} onChange={(e) => setValue(e.target.value)} />}
          <Button variant="outline" size="icon" aria-label={t("Save")} disabled={pending || value === initial} onClick={() => run(() => saveContentAction({ path: field.path, value }))}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
          </Button>
        </div>
      )}
      {field.help && <p className="text-xs text-muted-foreground">{t(field.help)}</p>}
      {sharedNote && field.shared && <p className="text-xs text-muted-foreground">{t("The same in every language.")}</p>}
    </div>
  );
}

function ChineseFieldEditor({ field, zh }: { field: Field; zh: Zh }) {
  const t = useT();
  const { pending, run } = useRun();
  const list = field.type === "list";
  const id = `zh:${field.path}`;
  const initial = asText(zh.value, list);
  const [value, setValue] = useState(initial);
  const saved = zh.value !== null;
  const fallback = asText(zh.fallback, list);

  return (
    <div className="space-y-1.5 border-b pb-5 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} className="flex flex-wrap items-center gap-1.5">
          {t(field.label)}
          {saved ? <Badge variant="outline">{t("Chinese saved")}</Badge>
            : zh.fallbackIsEnglish ? <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">{t("Shows in English")}</Badge>
            : <Badge variant="outline" className="text-muted-foreground">{t("Default Chinese")}</Badge>}
          {zh.stale && <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">{t("English changed since")}</Badge>}
        </Label>
        {saved && <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => resetContentAction({ path: field.path, locale: "zh-CN" }))}><RotateCcw /> {t("Default")}</Button>}
      </div>
      <div className="flex items-start gap-2">
        {field.type === "text"
          ? <Input id={id} lang="zh-CN" value={value} placeholder={fallback} onChange={(e) => setValue(e.target.value)} />
          : <Textarea id={id} lang="zh-CN" rows={list ? 5 : 3} value={value} placeholder={fallback} onChange={(e) => setValue(e.target.value)} />}
        <Button variant="outline" size="icon" aria-label={t("Save")} disabled={pending || value === initial || !value.trim()}
          onClick={() => run(() => saveContentAction({ path: field.path, value, locale: "zh-CN" }))}>
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Languages className="mt-px size-3.5 shrink-0" />
        <span className="min-w-0 break-words">{t("English:")} {asText(field.value, list).replace(/\n/g, " · ")}</span>
      </p>
      {field.help && <p className="text-xs text-muted-foreground">{t(field.help)}</p>}
    </div>
  );
}
