import Image from "next/image";
import { cn } from "@/lib/utils";
import { Ornament } from "./ornament";
import { blurFor } from "./blur-data";
import { container, eyebrow, type } from "./ui";

/** Photo hero for inner pages (only used where a real photo exists). */
export function PageHero({
  kicker,
  title,
  intro,
  image,
  imageAlt,
  children,
  className,
}: {
  kicker: string;
  title: string;
  intro?: React.ReactNode;
  image: string;
  imageAlt: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("relative isolate overflow-hidden bg-[#15120e] text-white", className)}>
      <Image src={image} alt={imageAlt} fill priority sizes="100vw" {...blurFor(image)} className="-z-10 object-cover opacity-55 motion-safe:animate-in motion-safe:zoom-in-110 motion-safe:duration-[2.5s] motion-safe:ease-out" />
      <div className="absolute inset-0 -z-10 bg-linear-to-t from-[#15120e] via-[#15120e]/60 to-[#15120e]/30" aria-hidden="true" />
      <div className={cn(container, "flex min-h-[380px] flex-col justify-end pb-12 pt-24 sm:min-h-[52svh] sm:pb-20 sm:pt-32")}>
        <p className={cn(eyebrow, "text-gold motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700")}>{kicker}</p>
        <h1 className={cn("mt-4 max-w-4xl text-balance", type.h1, "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700")}>
          {title}
        </h1>
        <Ornament className="mt-6" />
        {intro && <div className={cn("mt-6 max-w-2xl text-pretty text-white/80", type.lead)}>{intro}</div>}
        {children}
      </div>
    </section>
  );
}

/**
 * Typographic hero for venues without photography (restaurant, bar, meeting
 * room): textured ink gradient with a fine gold line illustration.
 */
export function VenueHero({
  kicker,
  title,
  intro,
  illustration,
  children,
}: {
  kicker: string;
  title: string;
  intro?: React.ReactNode;
  illustration: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden bg-[#15120e] text-white">
      <div
        className="absolute inset-0 -z-10 opacity-90"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 85% 20%, oklch(0.72 0.12 80 / 0.16), transparent 60%), radial-gradient(ellipse 60% 50% at 10% 90%, oklch(0.45 0.08 265 / 0.45), transparent 60%)",
        }}
      />
      <div
        className="absolute inset-0 -z-10 opacity-[0.06]"
        aria-hidden="true"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 14px), repeating-linear-gradient(-45deg, #fff 0 1px, transparent 1px 14px)",
        }}
      />
      <div className={cn(container, "grid min-h-[380px] items-end gap-10 pb-12 pt-24 sm:min-h-[52svh] sm:pb-20 sm:pt-32 lg:grid-cols-[1.4fr_1fr] lg:items-center")}>
        <div>
          <p className={cn(eyebrow, "text-gold")}>{kicker}</p>
          <h1 className={cn("mt-4 max-w-4xl text-balance", type.h1, "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700")}>
            {title}
          </h1>
          <Ornament className="mt-6" />
          {intro && <div className={cn("mt-6 max-w-2xl text-pretty text-white/80", type.lead)}>{intro}</div>}
          {children}
        </div>
        <div className="hidden justify-center text-gold lg:flex motion-safe:animate-in motion-safe:fade-in motion-safe:duration-1000">
          {illustration}
        </div>
      </div>
    </section>
  );
}
