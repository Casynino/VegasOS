"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** Back to wherever the bill was opened from (the room, the booking, check-out…). */
export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button type="button" onClick={() => (history.length > 1 ? history.back() : router.push(fallback))} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-black/70 hover:bg-black/5">
      <ArrowLeft className="size-4" />Back
    </button>
  );
}
