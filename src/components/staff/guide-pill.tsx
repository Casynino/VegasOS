import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { guideBooksFor } from "@/lib/guide-books";
import type { T } from "@/i18n/translate";

/**
 * The small "Guide book" button (owner, 2026-10-19: not a strip across the top — a small button that is easy to see, in the same place and
 * style as the page's other small buttons). `guideLabel` is null for a person who has no guide book (no button); "Guide book" for one book,
 * "Guide books" for several. The button opens the Guide books page, where the person's own book(s) are downloaded, opened and printed.
 */
export function guideLabel(t: T, permissions: ReadonlySet<string>): string | null {
  const n = guideBooksFor(permissions).files.length;
  return n === 0 ? null : n === 1 ? t("Guide book") : t("Guide books");
}

/** The pill itself, for pages whose small buttons are not a shared list (the restaurant's gold-ringed pills, the headers of the desks). */
export function GuidePill({ label }: { label: string }) {
  return (
    <Link href="/staff/guides" className="group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[oklch(0.72_0.12_80/0.45)] bg-card pl-1 pr-3 text-xs font-medium text-foreground/90 transition-colors hover:bg-[oklch(0.72_0.12_80/0.08)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:h-9 sm:gap-2 sm:pl-1.5 sm:pr-3.5 sm:text-sm">
      <span className="grid size-6 place-items-center rounded-full bg-linear-to-br from-[oklch(0.85_0.1_84)] to-[oklch(0.68_0.12_76)] text-[oklch(0.2_0.03_60)] transition-transform group-hover:scale-105 sm:size-7"><BookOpenText className="size-3.5" aria-hidden /></span>
      {label}
    </Link>
  );
}
