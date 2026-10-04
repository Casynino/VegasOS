import type { Metadata } from "next";
import { cn } from "@/lib/utils";
import { getSiteContent } from "@/server/services/site-content";
import { BarIllustration } from "@/components/public/illustrations";
import { Ornament } from "@/components/public/ornament";
import { VenueHero } from "@/components/public/page-hero";
import { PillLink } from "@/components/public/pill-link";
import { Reveal } from "@/components/public/reveal";
import { container, cream, eyebrow, goldText, type } from "@/components/public/ui";

export const metadata: Metadata = {
  title: "Bar",
  description: "The bar at Vegas Luxury Hotel, Mlimani City, Dar es Salaam — a relaxed place to unwind after a day of meetings or exploring.",
  alternates: { canonical: "/bar" },
};

export default async function BarPage() {
  const p = (await getSiteContent()).pages.bar;
  return (
    <>
      <VenueHero
        kicker={p.kicker}
        title={p.title}
        illustration={<BarIllustration className="h-80 w-80" />}
        intro={<p>{p.intro}</p>}
      >
        <div className="mt-8 flex flex-wrap gap-3"><PillLink href="/menu#beers">See the drinks menu</PillLink><PillLink href="/contact?subject=dining" variant="glass" arrow={false}>Ask the team</PillLink></div>
      </VenueHero>

      <section className={cn(cream, "py-16 sm:py-24")}>
        <div className={cn(container, "grid gap-10 md:grid-cols-3")}>
          {p.points.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.1} className="border-t border-tone/15 pt-6">
              <p className={cn("font-display text-5xl", goldText)}>{String(i + 1).padStart(2, "0")}</p>
              <h2 className={cn("mt-4", type.h3)}>{c.title}</h2>
              <p className="mt-3 text-tone/70">{c.body}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className={cn(container, "mt-20 flex flex-col items-center text-center")}>
          <p className={cn(eyebrow, goldText)}>Visit us</p>
          <h2 className={cn("mt-4 max-w-2xl text-balance", type.h2)}>{p.closingTitle}</h2>
          <Ornament className="mx-auto mt-6" />
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <PillLink href="/book" variant="dark">Book a room</PillLink>
            <PillLink href="/restaurant" variant="outline" arrow={false}>See the restaurant</PillLink>
          </div>
        </Reveal>
      </section>
    </>
  );
}
