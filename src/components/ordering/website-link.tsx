"use client";

import { ArrowUpRight, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/**
 * THE WAY TO THE HOTEL'S WEBSITE from a guest's QR page — the room card, the restaurant and table cards, the booking
 * card, Spin to Win (owner, 2026-10-11: "it should be very easy to go to the public site, so the customer can see
 * more on our site"). Said in words at the top of the page and again at its bottom; always in a new tab, so an order,
 * a booking or a wheel in progress is not lost.
 */
const SITE = "/";

/** At the top, next to the hotel's name: the globe and the word. The word is dropped only on the very narrowest phones. */
export function WebsiteLink({ hotel, className, word = true }: { hotel: string; className?: string; word?: boolean }) {
  const t = useT();
  return (
    <a href={SITE} target="_blank" rel="noopener" aria-label={t("{hotel} website (opens in a new tab)", { hotel })}
      className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 text-[12.5px] font-semibold", className)}>
      <Globe className="size-4 shrink-0" />
      <span className={word ? "max-[339px]:hidden" : "hidden sm:inline"}>{t("Website")}</span>
    </a>
  );
}

/** At the bottom: what is there, and the link — one quiet line. */
export function WebsiteLine({ hotel, className, link }: { hotel: string; className?: string; link?: string }) {
  const t = useT();
  return (
    <p className={cn("text-center text-[13px] leading-relaxed", className)}>
      <span className="opacity-70">{t("Rooms, photos, the restaurant and more.")}</span>{" "}
      <a href={SITE} target="_blank" rel="noopener" className={cn("inline-flex items-center gap-1 whitespace-nowrap font-semibold underline-offset-4 hover:underline", link)}>
        {t("Visit the {hotel} website", { hotel })}<ArrowUpRight className="size-3.5" /><span className="sr-only"> {t("(opens in a new tab)")}</span>
      </a>
    </p>
  );
}
