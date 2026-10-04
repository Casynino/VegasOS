import Link from "next/link";
import { Ornament } from "@/components/public/ornament";
import { PillLink } from "@/components/public/pill-link";
import { container, eyebrow, type } from "@/components/public/ui";
import { cn } from "@/lib/utils";

export default function PublicNotFound() {
  return (
    <section className={cn(container, "flex flex-1 flex-col items-center justify-center bg-paper pb-28 pt-40 text-center max-w-none")}>
      <p className={cn(eyebrow, "text-accent-ink")}>Not found</p>
      <h1 className={cn("mt-4 max-w-2xl text-balance", type.h2)}>We couldn’t find that page</h1>
      <Ornament className="mx-auto mt-6" />
      <p className={cn("mt-6 max-w-lg text-tone/70", type.lead)}>
        If you followed a booking link, please use the full link from your confirmation, or contact us and we’ll look it up.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <PillLink href="/">Back to home</PillLink>
        <Link href="/contact?subject=existing" className="inline-flex items-center rounded-full border border-tone/25 px-6 py-3 text-sm font-medium hover:border-tone">
          Help with a booking
        </Link>
      </div>
    </section>
  );
}
