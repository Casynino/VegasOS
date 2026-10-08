"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { useT } from "@/i18n/client";
import { LOCALES, LOCALE_META, toLocale, type Locale } from "@/i18n/config";
import { setGuestLanguageAction } from "../actions";

/**
 * "Messages in: English / 中文 / Not set" — the language the hotel writes to this customer in (WhatsApp messages and
 * their own pages). Saved when they choose a language on the website or a QR; staff can set it here.
 */
export function GuestLanguage({ id, value, canEdit }: { id: string; value: string | null; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [lang, setLang] = useState<Locale | "">(toLocale(value) ?? "");
  const [pending, start] = useTransition();
  const save = (next: Locale | "") => {
    const before = lang;
    setLang(next);
    start(async () => {
      const res = await setGuestLanguageAction({ id, language: next });
      if (!res.ok) { setLang(before); toast.error(res.error); return; }
      toast.success(res.message ?? t("Message language saved."));
      router.refresh();
    });
  };
  const shown = lang ? LOCALE_META[lang].label : t("Not set");
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <dt className="flex shrink-0 items-center gap-1.5 text-muted-foreground"><Languages className="size-3.5" />{t("Messages in")}</dt>
      <dd className="min-w-0">
        {canEdit ? (
          <span className="flex items-center gap-1.5">
            {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            <NativeSelect value={lang} onChange={(e) => save(toLocale(e.target.value) ?? "")} disabled={pending} aria-label={t("Message language")} className="h-8 w-36 text-right font-medium">
              <option value="">{t("Not set")}</option>
              {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_META[l].label}</option>)}
            </NativeSelect>
          </span>
        ) : (
          <span className={lang ? "font-medium" : "text-muted-foreground/60"}>{shown}</span>
        )}
      </dd>
    </div>
  );
}
