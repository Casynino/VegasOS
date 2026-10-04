"use client";

import { useState } from "react";
import { Check, Link2, Printer } from "lucide-react";

/** Save helpers on the confirmation page (copy private link, print). */
export function BookingActions() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable — the address bar still has the link */
    }
  }
  const cls = "inline-flex items-center gap-2 rounded-full border border-tone/20 px-5 py-2.5 text-sm font-medium hover:border-tone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold print:hidden";
  return (
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={copy} className={cls}>
        {copied ? <Check className="size-4" aria-hidden="true" /> : <Link2 className="size-4" aria-hidden="true" />}
        <span aria-live="polite">{copied ? "Link copied" : "Copy booking link"}</span>
      </button>
      <button type="button" onClick={() => window.print()} className={cls}>
        <Printer className="size-4" aria-hidden="true" /> Print
      </button>
    </div>
  );
}
