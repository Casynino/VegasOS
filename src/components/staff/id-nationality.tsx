"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ID_TYPES } from "@/lib/company-staff";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

/** The nationalities most guests have — one tap; anything else is typed after "Other…". */
export const NATIONALITIES: string[] = [msg("Tanzanian"), msg("Kenyan"), msg("Ugandan"), msg("Rwandan"), msg("Burundian"), msg("Congolese")];

/** Tap-to-pick chips (like "How did they book?"). Tapping the chosen one again clears it. */
export function Chips({ options, value, onChange, size = "md", label }: {
  options: readonly (readonly [string, string])[]; value: string; onChange: (v: string) => void; size?: "md" | "sm"; label: string;
}) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t(label)} className="flex flex-wrap gap-1.5">
      {options.map(([v, text]) => {
        const on = value === v;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? "" : v)}
            className={cn("inline-flex items-center gap-1 rounded-full border font-medium transition-colors",
              size === "md" ? "h-9 px-3.5 text-[13px]" : "h-7 px-2.5 text-xs",
              on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}>
            {on && <Check className={size === "md" ? "size-3.5" : "size-3"} />}{t(text)}
          </button>
        );
      })}
    </div>
  );
}

/** ID: which document the guest showed (NIDA, Passport…) — picked, never typed. No number is written down. */
export function IdPicker({ type, onType, size = "md" }: { type: string; onType: (v: string) => void; size?: "md" | "sm" }) {
  return <Chips label={msg("ID type")} options={ID_TYPES} value={type} onChange={onType} size={size} />;
}

/** Nationality: the usual ones as chips; "Other…" opens a box to type it. */
export function NationalityPicker({ value, onChange, size = "md", invalid }: {
  value: string; onChange: (v: string) => void; size?: "md" | "sm"; invalid?: boolean;
}) {
  // Typing one that is not in the list (or a saved guest's) keeps the box open.
  const t = useT();
  const [typing, setTyping] = useState(false);
  const other = typing || (!!value && !NATIONALITIES.includes(value));
  const options = [...NATIONALITIES.map((n) => [n, n] as const), ["__other", msg("Other…")] as const];
  return (
    <div className={cn("space-y-2 rounded-xl", invalid && "ring-2 ring-amber-400/60 ring-offset-2 ring-offset-background")}>
      <Chips label={msg("Nationality")} options={options} value={other ? "__other" : value} size={size}
        onChange={(v) => {
          if (v === "__other") { setTyping(true); onChange(""); }
          else { setTyping(false); onChange(v); }
        }} />
      {other && (
        <Input autoFocus aria-label={t("Nationality")} value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("Type the nationality, e.g. British")}
          className={cn("bg-card", size === "md" ? "h-11 rounded-xl text-base" : "h-9")} />
      )}
    </div>
  );
}
