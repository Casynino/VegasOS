import type { Metadata } from "next";
import Image from "next/image";
import { MessageCircle, Phone, Users } from "lucide-react";
import { businessToday, getSettings } from "@/server/settings";
import { publicMeetingRoom } from "@/server/services/booking-requests";
import { parseImages } from "@/server/services/public-booking";
import { cn } from "@/lib/utils";
import { contentVars, telHref, whatsappHref } from "@/components/public/contact";
import { fill, ILLUSTRATIVE, MEETING_GALLERY_KEYS } from "@/components/public/content";
import { getSiteContent } from "@/server/services/site-content";
import { NamedIcon } from "@/components/public/icon";
import { MeetingBooking } from "@/components/public/meeting-booking";
import { Ornament } from "@/components/public/ornament";
import { PillLink } from "@/components/public/pill-link";
import { Reveal, Stagger, StaggerItem } from "@/components/public/reveal";
import { SectionHeading } from "@/components/public/section-heading";
import { container, cream, espresso, eyebrow, goldText, type } from "@/components/public/ui";

export const metadata: Metadata = {
  title: "Meeting Room",
  description: "Book the meeting room at Vegas Luxury Hotel, Mlimani City, Dar es Salaam — check availability for your date and time and book online. Call or WhatsApp us any time.",
  alternates: { canonical: "/meeting-room" },
};

const n = (v: number) => v.toLocaleString("en-US");
/** Stock photos until the hotel adds its own — always tagged "Illustrative". */
const isIllustrative = (src: string) => src.includes("/illustrative/");
const ALT = new Map<string, string>(MEETING_GALLERY_KEYS.map((k) => [ILLUSTRATIVE[k].src, ILLUSTRATIVE[k].alt]));

export default async function MeetingRoomPage() {
  const [settings, c, room, today] = await Promise.all([getSettings(), getSiteContent(), publicMeetingRoom(), businessToday()]);
  const p = c.pages.meeting;
  const f = (s: string) => fill(s, contentVars(settings, { airportKm: c.facts.airportKm }));
  // Public name is generic — the internal room number is not shown to guests.
  const name = room?.name ?? p.fallbackName;
  const own = room ? parseImages(room.images) : [];
  const photos = (own.length ? own : MEETING_GALLERY_KEYS.map((k) => ILLUSTRATIVE[k].src)).slice(0, 6);
  const [hero, ...gallery] = photos;
  const contact = settings.whatsapp ? whatsappHref(settings.whatsapp, `Hello, I would like to book the ${name}.`) : settings.phone ? telHref(settings.phone) : "/contact?subject=meeting";

  return (
    <>
      <section className={cn(espresso, "relative overflow-hidden pb-16 pt-32 text-white sm:pb-24 sm:pt-40")}>
        <Image src={hero} alt="" fill priority sizes="100vw" className="object-cover object-center opacity-75" />
        <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-[#15120e]/70 via-[#15120e]/40 to-[#15120e]" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.72_0.12_80/0.16),transparent_60%)]" aria-hidden="true" />
        {isIllustrative(hero) && <span className="absolute right-4 top-24 rounded-full bg-black/45 px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.22em] text-white/70 backdrop-blur-md sm:top-28">Illustrative</span>}
        <div className={cn(container, "relative text-center")}>
          <Reveal>
            <p className={cn(eyebrow, "text-gold")}>{p.kicker}</p>
            <h1 className={cn("mx-auto mt-5 max-w-4xl text-balance", type.h1)}>{name}</h1>
            <Ornament className="mx-auto mt-7" />
            <p className={cn("mx-auto mt-7 max-w-2xl text-white/70", type.lead)}>{room?.description ?? p.fallbackDescription}</p>
            {room && (
              <div className="mx-auto mt-9 inline-flex items-center gap-4 rounded-full border border-white/15 bg-white/[0.07] py-2 pl-2 pr-6 backdrop-blur-md">
                <span className="grid size-11 place-items-center rounded-full bg-gold text-[#1a140c]"><Users className="size-5" /></span>
                <span className="text-left leading-tight">
                  <span className="block text-xs uppercase tracking-[0.2em] text-white/60">Up to {room.maxAdults} people · per booking</span>
                  <span className="font-display text-2xl tabular-nums text-white">TZS {n(room.baseRate)}</span>
                </span>
              </div>
            )}
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              {room && <PillLink href="#book">Check availability &amp; book</PillLink>}
              <PillLink href={contact} external={contact.startsWith("http")} variant="glass" arrow={false}>
                {settings.whatsapp ? <MessageCircle className="mr-1 inline size-4" aria-hidden="true" /> : <Phone className="mr-1 inline size-4" aria-hidden="true" />}Call or WhatsApp
              </PillLink>
            </div>
          </Reveal>
        </div>
      </section>

      {gallery.length > 0 && (
        <section className={cn(cream, "py-14 sm:py-20")} aria-label="Photos">
          <div className={container}>
            <Stagger as="ul" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:grid-rows-2">
              {gallery.map((src, i) => (
                <StaggerItem as="li" key={src} index={i}
                  className={cn("group relative overflow-hidden rounded-3xl bg-paper-deep ring-1 ring-tone/[0.06]", i === 0 ? "col-span-2 aspect-[4/3] lg:row-span-2 lg:aspect-auto" : "aspect-[4/3]")}>
                  <Image src={src} alt={ALT.get(src) ?? `${name} photo`} fill sizes={i === 0 ? "(min-width:1024px) 50vw, 100vw" : "(min-width:1024px) 25vw, 50vw"}
                    className="object-cover transition duration-700 group-hover:scale-[1.04]" />
                  {isIllustrative(src) && <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.22em] text-white/80 backdrop-blur-md">Illustrative</span>}
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>
      )}

      {room && (
        <section id="book" className={cn(cream, "scroll-mt-24 pb-16 sm:pb-24", gallery.length === 0 && "pt-16 sm:pt-24")}>
          <div className={container}>
            <Reveal className="mx-auto mb-10 max-w-2xl text-center">
              <p className={cn(eyebrow, goldText)}>Book the meeting room</p>
              <h2 className={cn("mt-3 text-balance text-tone", type.h2)}>Check your date and time</h2>
              <p className="mt-4 text-tone/65">See straight away if the room is free, then book it — no account needed.</p>
            </Reveal>
            <MeetingBooking today={today} price={room.baseRate} capacity={room.maxAdults} />
          </div>
        </section>
      )}

      <section className={cn(espresso, "py-16 text-white sm:py-24")} aria-labelledby="why-title">
        <div className={container}>
          <Reveal><SectionHeading tone="dark" kicker="Why meet here" title={p.whyTitle} /></Reveal>
          <Stagger as="ul" className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {p.why.map((w, i) => (
              <StaggerItem as="li" key={w.title} index={i} className="rounded-3xl border border-white/10 bg-white/[0.04] p-7">
                <NamedIcon name={w.icon} className="size-7 text-gold" />
                <h3 className="mt-6 font-display text-2xl">{w.title}</h3>
                <p className="mt-2 text-[15px] text-white/65">{f(w.body)}</p>
              </StaggerItem>
            ))}
          </Stagger>
          <ol className="mx-auto mt-16 grid max-w-5xl gap-6 md:grid-cols-3">
            {p.steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 0.1} className="relative rounded-3xl border border-white/10 p-7">
                <span className="grid size-12 place-items-center rounded-full bg-gold font-display text-xl text-[#15120e]">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-6 font-display text-2xl">{s.title}</h3>
                <p className="mt-2 text-white/65">{f(s.body)}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
