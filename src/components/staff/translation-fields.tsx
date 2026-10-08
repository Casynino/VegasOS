"use client";

import { Languages } from "lucide-react";
import { useT } from "@/i18n/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TranslationForm } from "@/server/services/translations";

export type { TranslationForm };
export type TranslationField = { name: string; label: string; multiline?: boolean };

/**
 * The Chinese of a record, inside its own edit form (inputs named zh_<field>; the action saves them with
 * saveTranslation). Empty = the default Chinese (shown greyed as the hint), else the English. Folded away unless
 * something is saved, so the English form stays as short as before.
 */
export function TranslationFields({ fields, form, idPrefix, className }: { fields: TranslationField[]; form?: TranslationForm; idPrefix: string; className?: string }) {
  const t = useT();
  const saved = fields.filter((f) => form?.values[f.name]).length;
  return (
    <details className={`group rounded-2xl border border-border/70 ${className ?? ""}`} open={saved > 0 || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <Languages className="size-4 text-muted-foreground" />
        <span>中文 · {t("Chinese")}</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {saved ? t("{n} of {total} saved", { n: saved, total: fields.length }) : t("Optional")}
        </span>
      </summary>
      <div className="space-y-2.5 border-t border-border/60 px-3 pt-2.5 pb-3">
        <p className="text-xs text-muted-foreground">{t("Leave a field empty to show the default Chinese (in grey) — or the English when there is none.")}</p>
        {fields.map((f) => {
          const id = `${idPrefix}-zh-${f.name}`;
          const common = { id, name: `zh_${f.name}`, lang: "zh-CN", defaultValue: form?.values[f.name] ?? "", placeholder: form?.hints[f.name] ?? "" };
          return (
            <div key={f.name} className="space-y-1">
              <Label htmlFor={id}>{t(f.label)} <span className="font-normal text-muted-foreground">· 中文</span></Label>
              {f.multiline ? <Textarea rows={2} {...common} /> : <Input {...common} />}
            </div>
          );
        })}
      </div>
    </details>
  );
}
