"use client";

import { useState } from "react";
import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { DEFAULT_LOCALE, LOCALE_META, LOCALES, type Locale } from "@/i18n/config";

/**
 * The language of a message about to be sent — English or 中文 (owner, 2026-10-12: whoever sends a message chooses its
 * language). It starts on the guest's own language; the message stays the same message, only its words change. One
 * control for every window and button that sends a message.
 */
export function MessageLanguage({ value, onChange, pending, compact, className }: {
  value: Locale; onChange: (to: Locale) => void; pending?: boolean;
  /** Beside a one-tap button: only the two choices, no words. */
  compact?: boolean; className?: string;
}) {
  const t = useT();
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      {!compact && <><Languages className="size-3.5 shrink-0" /><span>{t("Message language")}</span></>}
      <div role="radiogroup" aria-label={t("Message language")} className={cn("inline-flex rounded-lg bg-muted p-0.5", !compact && "ml-auto", pending && "opacity-60")}>
        {LOCALES.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={value === l} disabled={pending} onClick={() => { if (l !== value) onChange(l); }}
            className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", value === l ? "bg-background text-foreground shadow-sm" : "hover:text-foreground")}>
            {compact ? LOCALE_META[l].short : l === "en" ? "English" : LOCALE_META[l].short}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The same message written in each language. */
export type MessageTexts = Partial<Record<Locale, string>>;

/**
 * For a button that sends a ready message in one tap (no window showing the text): the tap first asks "English or
 * 中文?" — the guest's language first — then sends. With one language written it sends straight away.
 * `const lang = useSendLanguage(texts, locale, send)` → `onClick={lang.ask}` and `{lang.window}` somewhere in the JSX.
 */
export function useSendLanguage(texts: MessageTexts | null | undefined, locale: Locale | null | undefined, send: (text: string, lang: Locale) => void) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const own = locale ?? DEFAULT_LOCALE;
  const langs = LOCALES.filter((l) => texts?.[l]).sort((a, b) => Number(b === own) - Number(a === own));
  const go = (l: Locale) => { setOpen(false); send(texts![l]!, l); };
  const ask = () => { if (langs.length > 1) setOpen(true); else if (langs[0]) go(langs[0]); };
  const window = langs.length > 1 ? (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader icon={<Languages />} eyebrow="WhatsApp" tone="emerald">
          <DialogTitle>{t("Message language")}</DialogTitle>
          <DialogDescription>{t("The same message — choose the language to send it in.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {langs.map((l) => (
            <button key={l} type="button" onClick={() => go(l)} lang={LOCALE_META[l].html}
              className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-left text-sm font-semibold transition-colors hover:bg-muted">
              {LOCALE_META[l].label}
              {l === own && <span className="text-xs font-normal text-muted-foreground">{t("Guest's language")}</span>}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  ) : null;
  return { ask, window };
}

/** A WhatsApp button for a page drawn on the server: one tap, the language asked first, then WhatsApp opens with the message ready. */
export function WhatsAppIn({ phone, texts, locale, className, title, label, children }: {
  /** The number as WhatsApp wants it (digits with the country code). */
  phone: string; texts: MessageTexts; locale?: Locale | null;
  className?: string; title?: string; label?: string; children: React.ReactNode;
}) {
  const lang = useSendLanguage(texts, locale, (text) => { window.open(`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`, "_blank", "noopener"); });
  return <><button type="button" onClick={lang.ask} className={className} title={title} aria-label={label}>{children}</button>{lang.window}</>;
}
