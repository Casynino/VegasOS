import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { PageHero } from "@/components/public/page-hero";
import { PillLink } from "@/components/public/pill-link";
import { getSiteContent } from "@/server/services/site-content";
import { container } from "@/components/public/ui";

const GalleryExperience = dynamic(() => import("@/components/public/cinema/gallery-experience").then((m) => m.GalleryExperience));

export const metadata: Metadata = {
  title: "Gallery",
  description: "Photos of the rooms, suites, bathrooms, reception and building at Vegas Luxury Hotel, Mlimani City, Dar es Salaam.",
  alternates: { canonical: "/gallery" },
};

export default async function GalleryPage() {
  const c = await getSiteContent();
  const p = c.pages.gallery;
  return (
    <>
      <PageHero
        kicker={p.kicker}
        title={p.title}
        image={p.image.src}
        imageAlt={p.image.alt}
        intro={<p>{p.intro}</p>}
      />
      <section className="relative z-10 -mt-10 overflow-hidden rounded-t-[2.5rem] bg-[#0d0b08] pb-28 pt-16 text-white sm:-mt-14 sm:rounded-t-[3.5rem] sm:pt-20" aria-label="Photos">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="vlh-glow absolute -left-40 top-40 size-[40rem] rounded-full bg-[radial-gradient(circle,oklch(0.72_0.12_80/0.12),transparent_65%)]" />
          <div className="absolute -right-40 top-[60%] size-[44rem] rounded-full bg-[radial-gradient(circle,oklch(0.6_0.08_240/0.12),transparent_65%)]" />
        </div>
        <div className={cn(container, "relative")}>
          <GalleryExperience images={c.gallery} chapters={[
            { key: "rooms", label: "Rooms & suites", categories: ["rooms"] },
            { key: "bath", label: "Bathrooms", categories: ["bath"] },
            { key: "arrival", label: "Reception, exterior & details", categories: ["lobby", "exterior", "amenity"] },
          ]} />
          <div className="mt-24 flex flex-col items-center gap-6 text-center">
            <p className="font-display text-[clamp(2rem,4vw,3.6rem)] leading-[1.05]">Seen enough? <span className="italic text-gold">Your room is waiting.</span></p>
            <PillLink href="/book">Book your stay</PillLink>
          </div>
        </div>
      </section>
    </>
  );
}
