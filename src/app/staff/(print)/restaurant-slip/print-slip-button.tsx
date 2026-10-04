"use client";

import { Printer } from "lucide-react";

export function PrintSlipButton() {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#1b1611] px-3 text-sm font-semibold text-white hover:bg-black">
      <Printer className="size-4" />Print slip
    </button>
  );
}
