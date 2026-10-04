"use client";

import { Download } from "lucide-react";

export function GuestPrintButton() {
  return (
    <button type="button" onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-full bg-[#15110c] px-5 py-2.5 text-sm font-semibold text-[#f0cf86] shadow-lg transition-transform hover:-translate-y-0.5">
      <Download className="size-4" />Save as PDF or print
    </button>
  );
}
