"use client";

import { Check } from "lucide-react";
import { useT } from "@/i18n/client";
import { ORDER_REQUESTS } from "@/lib/order-requests";
import { cn } from "@/lib/utils";

/**
 * Common requests a customer can tick before their note (No onions, Not spicy…). Stored as codes, so the kitchen reads
 * them in its own language whatever language the customer ordered in. `tone`: the restaurant app ("vr") or the website
 * menu ("pub").
 */
export function RequestPicker({ value, onChange, tone = "vr", className }: {
  value: string[]; onChange: (codes: string[]) => void; tone?: "vr" | "pub"; className?: string;
}) {
  const t = useT();
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <ul aria-label={t("Common requests")} className={cn("flex flex-wrap gap-1.5", className)}>
      {ORDER_REQUESTS.map((r) => {
        const on = value.includes(r.code);
        return (
          <li key={r.code}>
            <button type="button" aria-pressed={on} onClick={() => toggle(r.code)}
              className={cn("inline-flex min-h-8 items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-medium leading-tight ring-1 transition motion-reduce:transition-none",
                tone === "vr"
                  ? on ? "bg-(--vr-dark) text-white ring-(--vr-dark)" : "bg-white text-(--vr-ink)/80 ring-(--vr-line) hover:ring-(--vr-gold)"
                  : on ? "bg-pub-fg text-pub-raised ring-pub-fg" : "bg-pub-field text-pub-fg ring-pub-line hover:ring-gold",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold")}>
              {on && <Check className={cn("size-3", tone === "vr" ? "text-(--vr-gold)" : "text-gold")} strokeWidth={3} aria-hidden="true" />}
              {t(r.label)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
