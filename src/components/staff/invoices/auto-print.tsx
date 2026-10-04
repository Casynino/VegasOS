"use client";

import { useEffect } from "react";

/** Opens the print dialog once the invoice is on screen ("Print" / "Download PDF" → Save as PDF). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, []);
  return null;
}
