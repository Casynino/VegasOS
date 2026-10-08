"use client";

import { Download } from "lucide-react";
import { useT } from "@/i18n/client";

export function GuestPrintButton() {
  const t = useT();
  return (
    <button type="button" onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-full bg-[#15110c] px-5 py-2.5 text-sm font-semibold text-[#f0cf86] shadow-lg transition-transform hover:-translate-y-0.5">
      <Download className="size-4" />{t("Save as PDF or print")}
    </button>
  );
}
