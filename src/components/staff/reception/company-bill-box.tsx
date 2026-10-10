"use client";

import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import type { CheckOutPreview } from "@/server/services/reservations";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

/** Company-billed stay at checkout: how much goes on the company's invoice, and which invoice. */
export function CompanyBillBox({ company, mode, onMode }: {
  company: NonNullable<CheckOutPreview["company"]>; mode: "ISSUE" | "OPEN"; onMode: (m: "ISSUE" | "OPEN") => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2 rounded-xl border border-[oklch(0.75_0.13_80)]/40 bg-[oklch(0.75_0.13_80)]/[0.07] p-3 text-xs">
      <p className="flex items-center gap-1.5 font-semibold"><Building2 className="size-3.5" />{t("Bill to {name}", { name: company.name })}</p>
      <p className="text-muted-foreground">
        {company.billTo === "SPLIT"
          ? t("{amount} goes on the company's account (what the company covers — the guest pays the rest). The guest pays nothing for it.", { amount: formatTZS(company.billedNow) })
          : t("{amount} goes on the company's account. The guest pays nothing for it.", { amount: formatTZS(company.billedNow) })}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {([["ISSUE", msg("Issue invoice now"), t("due in {n} days", { n: company.terms })], ["OPEN", msg("Add to open invoice"), t("send later, e.g. monthly")]] as const).map(([m, label, hint]) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}
            className={cn("rounded-lg border px-2 py-1.5 text-left leading-tight", mode === m ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}>
            <span className="block text-[12px] font-semibold">{t(label)}</span>
            <span className={cn("block text-[10px]", mode === m ? "opacity-70" : "text-muted-foreground")}>{m === "ISSUE" && company.terms === 0 ? t("due now") : hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
