"use client";

import { usePathname } from "next/navigation";
import { Phone } from "lucide-react";
import { telHref } from "./contact";
import { PillLink } from "./pill-link";

const HIDDEN_ON = [/^\/book(\/|$)/, /^\/booking\//, /^\/rooms\/[^/]+$/];

/** Thumb-reachable booking bar on phones (room pages render their own). */
export function MobileBookBar({ phone }: { phone: string | null }) {
  const pathname = usePathname();
  if (HIDDEN_ON.some((r) => r.test(pathname))) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#15120e]/90 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:hidden motion-safe:animate-in motion-safe:slide-in-from-bottom-full motion-safe:duration-500">
      <div className="flex items-center gap-3">
        {phone && (
          <a
            href={telHref(phone)}
            className="grid size-12 shrink-0 place-items-center rounded-full border border-white/20 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <Phone className="size-5" aria-hidden="true" />
            <span className="sr-only">Call the hotel</span>
          </a>
        )}
        <PillLink href="/book" className="h-12 flex-1 justify-between text-[15px]">
          Book your stay
        </PillLink>
      </div>
    </div>
  );
}
