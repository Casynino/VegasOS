"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Ornament } from "@/components/public/ornament";
import { container, eyebrow, pillGold, type } from "@/components/public/ui";
import { cn } from "@/lib/utils";

export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className={cn(container, "flex flex-1 flex-col items-center justify-center bg-paper pb-28 pt-40 text-center max-w-none")}>
      <p className={cn(eyebrow, "text-accent-ink")}>A small interruption</p>
      <h1 className={cn("mt-4 max-w-2xl text-balance", type.h2)}>We couldn’t load this page just now</h1>
      <Ornament className="mx-auto mt-6" />
      <p className={cn("mt-6 max-w-lg text-tone/70", type.lead)}>
        Please try again in a moment. Nothing you entered has been booked or charged.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className={cn(pillGold, "px-6 py-3")}>
          <RotateCcw className="relative size-4" aria-hidden="true" /> <span className="relative">Try again</span>
        </button>
        <Link href="/contact" className="inline-flex items-center rounded-full border border-tone/25 px-6 py-3 text-sm font-medium hover:border-tone">
          Contact the hotel
        </Link>
      </div>
    </section>
  );
}
