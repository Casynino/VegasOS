import type { Metadata } from "next";
import { Coffee, Leaf } from "lucide-react";
import { cn } from "@/lib/utils";
import { DiningIllustration } from "@/components/public/illustrations";
import { Ornament } from "@/components/public/ornament";
import { VenueHero } from "@/components/public/page-hero";
import { PillLink } from "@/components/public/pill-link";
import { Reveal, Stagger, StaggerItem } from "@/components/public/reveal";
import { getSiteContent } from "@/server/services/site-content";
import { container, cream, espresso, eyebrow, goldText, type } from "@/components/public/ui";

export const metadata: Metadata = {
  title: "Restaurant",
  description:
    "The restaurant at Vegas Luxury Hotel, Dar es Salaam: African, American, Chinese, pizza, Spanish, sushi and grill — breakfast, brunch, lunch, high tea, cocktail hour and dinner.",
  alternates: { canonical: "/restaurant" },
};

export default async function RestaurantPage() {
  const p = (await getSiteContent()).pages.restaurant;
  const meals = p.meals;
  return (
    <>
      <VenueHero
        kicker={p.kicker}
        title={p.title}
        illustration={<DiningIllustration className="h-80 w-80" />}
        intro={<p>{p.intro}</p>}
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <PillLink href="/menu">See the menu & prices</PillLink>
          <PillLink href="/contact?subject=dining" variant="glass" arrow={false}>Ask about dining</PillLink>
          <PillLink href="/book" variant="glass" arrow={false}>Book a room</PillLink>
        </div>
      </VenueHero>

      <section className={cn(cream, "py-16 sm:py-24")} aria-labelledby="cuisines-title">
        <div className={cn(container, "grid gap-12 lg:grid-cols-[1fr_1.5fr]")}>
          <Reveal>
            <p className={cn(eyebrow, goldText)}>Cuisines</p>
            <h2 id="cuisines-title" className={cn("mt-4 text-balance", type.h2)}>{p.cuisinesTitle}</h2>
            <Ornament className="mt-6" />
            <p className={cn("mt-6 max-w-md text-tone/70", type.body)}>
              {p.cuisinesBody}
            </p>
          </Reveal>
          <Stagger as="ol" className="divide-y divide-tone/10 border-y border-tone/10">
            {p.cuisines.map((c, i) => (
              <StaggerItem as="li" key={c} index={i} className="group flex items-baseline gap-6 py-5">
                <span className={cn("w-8 text-xs tabular-nums", goldText)}>{String(i + 1).padStart(2, "0")}</span>
                <span className="font-display text-[clamp(1.9rem,3vw+1rem,3.2rem)] leading-none transition-transform duration-500 group-hover:translate-x-2 motion-reduce:transition-none">{c}</span>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className={cn(espresso, "py-16 text-white sm:py-24")} aria-labelledby="meals-title">
        <div className={container}>
          <Reveal className="text-center">
            <p className={cn(eyebrow, "text-gold")}>Served</p>
            <h2 id="meals-title" className={cn("mt-4", type.h2)}>{p.mealsTitle}</h2>
          </Reveal>
          <Stagger as="ol" className="relative mt-14 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {meals.map((m, i) => (
              <StaggerItem as="li" key={m} index={i} className="relative rounded-3xl border border-white/10 p-6 text-center">
                <span className="mx-auto grid size-10 place-items-center rounded-full bg-gold text-sm font-medium text-[#15120e]">{i + 1}</span>
                <span className="mt-4 block font-display text-2xl">{m}</span>
              </StaggerItem>
            ))}
          </Stagger>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            <Reveal className="flex gap-4 rounded-3xl bg-white/[0.04] p-6">
              <Coffee className="size-6 shrink-0 text-gold" aria-hidden="true" />
              <p className="text-white/80">{p.breakfastNote}</p>
            </Reveal>
            <Reveal className="flex gap-4 rounded-3xl bg-white/[0.04] p-6">
              <Leaf className="size-6 shrink-0 text-gold" aria-hidden="true" />
              <div>
                <p className="font-medium">Dietary options</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {p.dietary.map((d) => <li key={d} className="rounded-full border border-white/15 px-3 py-1 text-sm text-white/80">{d}</li>)}
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className={cn(cream, "py-16 sm:py-20")}>
        <Reveal className={cn(container, "flex flex-col items-center text-center")}>
          <h2 className={cn("max-w-xl text-balance", type.h3)}>{p.closingTitle}</h2>
          <p className="mt-3 max-w-lg text-tone/70">{p.closingBody}</p>
          <div className="mt-8"><PillLink href="/contact?subject=dining" variant="dark">Contact the restaurant</PillLink></div>
        </Reveal>
      </section>
    </>
  );
}
