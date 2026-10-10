"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages } from "lucide-react";
import { LOCALES, LOCALE_META, type Locale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { setMyLanguage, setVisitorLanguage } from "@/i18n/actions";
import { cn } from "@/lib/utils";

type Own = { stay?: string | null; order?: string | null; booking?: string | null };

/**
 * EN | 中文 — one person's language. Switching re-renders the page in place: the cart, a half-filled form, the
 * booking in progress and the filters all stay; nothing is saved twice and no business data changes.
 *
 *   variant "pill"   — EN · 中文 side by side (headers, QR pages, footers)
 *   variant "toggle" — one small button naming the OTHER language (tight phone headers)
 *   variant "menu"   — a labelled row with both languages (menus, account page)
 *   variant "text"   — EN · 中文 as plain words, no box (footers)
 * staff: saves it on the signed-in person's account (every device); otherwise this device, and — on their own
 * guest pages (`own`) — the guest's customer record, so their WhatsApp messages follow.
 */
export function LanguageSwitch({ variant = "pill", tone = "dark", staff, own, languages = [...LOCALES], className }: {
  variant?: "pill" | "toggle" | "menu" | "text";
  /** The surface it sits on. */
  tone?: "dark" | "light";
  staff?: boolean;
  own?: Own;
  /** The languages the hotel offers (Settings → Languages). */
  languages?: readonly string[];
  className?: string;
}) {
  const t = useT();
  const current = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const offered = LOCALES.filter((l) => l === "en" || languages.includes(l));
  if (offered.length < 2) return null;

  const pick = (l: Locale) => {
    if (l === current || pending) return;
    start(async () => {
      const r = staff ? await setMyLanguage(l) : await setVisitorLanguage(l, own);
      if (r.ok) router.refresh();
    });
  };

  if (variant === "toggle") {
    const next = offered.find((l) => l !== current) ?? "en";
    return (
      <button type="button" onClick={() => pick(next)} disabled={pending} lang={LOCALE_META[next].html}
        aria-label={t("Language: {language}", { language: LOCALE_META[next].label })}
        className={cn("inline-flex h-10 min-w-9 items-center justify-center rounded-sm px-1 text-[13px] font-semibold tracking-wide transition-colors duration-200 disabled:opacity-60",
          tone === "dark" ? "text-white/85 hover:text-white" : "text-foreground/80 hover:text-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold", className)}>
        {LOCALE_META[next].short}
      </button>
    );
  }

  if (variant === "text") {
    return (
      <div role="radiogroup" aria-label={t("Language")} aria-busy={pending || undefined} className={cn("inline-flex items-center text-xs", className)}>
        {offered.map((l, i) => (
          <span key={l} className="inline-flex items-center">
            {i > 0 && <span aria-hidden="true" className={tone === "dark" ? "text-white/25" : "text-muted-foreground/50"}>·</span>}
            <button type="button" role="radio" aria-checked={l === current} onClick={() => pick(l)} disabled={pending} lang={LOCALE_META[l].html}
              className={cn("inline-flex min-h-11 items-center px-1.5 font-semibold tracking-wide transition-colors disabled:cursor-default",
                l === current ? (tone === "dark" ? "text-white" : "text-foreground") : (tone === "dark" ? "text-white/45 hover:text-white" : "text-muted-foreground hover:text-foreground"),
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold")}>
              {LOCALE_META[l].short}
            </button>
          </span>
        ))}
      </div>
    );
  }

  if (variant === "menu") {
    return (
      <div role="radiogroup" aria-label={t("Language")} className={cn("flex items-center gap-3", className)}>
        <Languages className={cn("size-4 shrink-0", tone === "dark" ? "text-white/60" : "text-muted-foreground")} aria-hidden="true" />
        <div className="flex flex-1 gap-1.5">
          {offered.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={l === current} onClick={() => pick(l)} disabled={pending} lang={LOCALE_META[l].html}
              className={cn("inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors disabled:opacity-60",
                l === current
                  ? tone === "dark" ? "bg-white/[0.12] text-white ring-1 ring-inset ring-white/25" : "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/30"
                  : tone === "dark" ? "text-white/70 hover:bg-white/[0.06] hover:text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {l === current && <Check className="size-3.5" aria-hidden="true" />}{LOCALE_META[l].label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div role="radiogroup" aria-label={t("Language")} aria-busy={pending || undefined}
      className={cn("inline-flex h-8 items-center rounded-full p-0.5 text-[12px] font-semibold",
        tone === "dark" ? "bg-white/[0.06] ring-1 ring-inset ring-white/15" : "bg-muted ring-1 ring-inset ring-border", className)}>
      {offered.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={l === current} onClick={() => pick(l)} disabled={pending} lang={LOCALE_META[l].html}
          title={LOCALE_META[l].label}
          className={cn("inline-flex h-7 min-w-9 items-center justify-center rounded-full px-2.5 transition-colors duration-200 disabled:cursor-default",
            l === current
              ? tone === "dark" ? "bg-white/[0.14] text-white" : "bg-background text-foreground shadow-sm"
              : tone === "dark" ? "text-white/60 hover:text-white" : "text-muted-foreground hover:text-foreground",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold")}>
          {LOCALE_META[l].short}
        </button>
      ))}
    </div>
  );
}
