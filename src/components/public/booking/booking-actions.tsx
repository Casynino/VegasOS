"use client";

import { useState } from "react";
import { Check, Link2, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "../kit/button";

/** Save helpers on the confirmation page (copy private link, print). Follow the surrounding tone. */
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
  const cls = cn(buttonClass({ variant: "secondary", size: "sm" }), "px-4 print:hidden");
  return (
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={copy} className={cls}>
        {copied ? <Check className="size-4 text-pub-eyebrow" strokeWidth={1.8} aria-hidden="true" /> : <Link2 className="size-4" strokeWidth={1.6} aria-hidden="true" />}
        <span aria-live="polite">{copied ? "Link copied" : "Copy link"}</span>
      </button>
      <button type="button" onClick={() => window.print()} className={cls}>
        <Printer className="size-4" strokeWidth={1.6} aria-hidden="true" /> Print
      </button>
    </div>
  );
}
