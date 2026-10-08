"use client";

import { Printer } from "lucide-react";
import { useT } from "@/i18n/client";

export function PrintSlipButton() {
  const t = useT();
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#1b1611] px-3 text-sm font-semibold text-white hover:bg-black">
      <Printer className="size-4" />{t("Print slip")}
    </button>
  );
}
