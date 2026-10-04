import type { Metadata } from "next";
import Image from "next/image";
import { MessageCircle, PhoneCall, PlaneLanding, ShieldCheck } from "lucide-react";
import { businessToday, getSettings } from "@/server/settings";
import { transportServices } from "@/server/services/transport";
import { onlinePayAvailable } from "@/server/services/online-pay";
import { cn } from "@/lib/utils";
import { Ornament } from "@/components/public/ornament";
import { PillLink } from "@/components/public/pill-link";
import { Reveal } from "@/components/public/reveal";
import { telHref, whatsappHref } from "@/components/public/contact";
import { ILLUSTRATIVE } from "@/components/public/content";
import { container, cream, espresso, eyebrow, goldText, type } from "@/components/public/ui";
import { TransportRequest } from "@/components/public/transport-request";

export const metadata: Metadata = {
  title: "Airport Pickup & Guest Transport",
  description: "Airport pickup from Julius Nyerere International Airport to Vegas Luxury Hotel, airport drop-offs and trips in Dar es Salaam. Request online — no account needed.",
  alternates: { canonical: "/transport" },
};

const n = (v: number) => v.toLocaleString("en-US");

/** Guest transport on the website: the services with their prices and one simple request form. */
export default async function TransportPage({ searchParams }: PageProps<"/transport">) {
  const [services, s, today, sp] = await Promise.all([transportServices({ publicOnly: true }), getSettings(), businessToday(), searchParams]);
  const pickup = services.find((x) => x.type === "AIRPORT_PICKUP");
  const contact = s.whatsapp ? whatsappHref(s.whatsapp, "Hello Vegas Luxury Hotel, I would like to arrange transport.") : s.phone ? telHref(s.phone) : "/contact";

  return (
    <>
      <section className={cn(espresso, "relative overflow-hidden pb-16 pt-32 text-white sm:pb-24 sm:pt-40")}>
        <Image src={ILLUSTRATIVE.darCityAerial.src} alt="" fill priority sizes="100vw" className="object-cover object-center opacity-45" />
        <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-[#15120e]/70 via-[#15120e]/55 to-[#15120e]" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.72_0.12_80/0.16),transparent_60%)]" aria-hidden="true" />
        <span className="absolute right-4 top-24 rounded-full bg-black/45 px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.22em] text-white/70 backdrop-blur-md sm:top-28">Illustrative</span>
        <div className={cn(container, "relative text-center")}>
          <Reveal>
            <p className={cn(eyebrow, "text-gold")}>Arrive comfortably</p>
            <h1 className={cn("mx-auto mt-5 max-w-4xl text-balance", type.h1)}>Airport pickup &amp; guest transport</h1>
            <Ornament className="mx-auto mt-7" />
            <p className={cn("mx-auto mt-7 max-w-2xl text-white/70", type.lead)}>
              From the airport to Vegas Luxury Hotel, or from the hotel to your next meeting — a driver who knows the city, waiting for you.
            </p>
            {pickup && (
              <div className="mx-auto mt-9 inline-flex items-center gap-4 rounded-full border border-white/15 bg-white/[0.07] py-2 pl-2 pr-6 backdrop-blur-md">
                <span className="grid size-11 place-items-center rounded-full bg-gold text-[#1a140c]"><PlaneLanding className="size-5" /></span>
                <span className="text-left leading-tight">
                  <span className="block text-xs uppercase tracking-[0.2em] text-white/60">{pickup.name}</span>
                  <span className="font-display text-2xl text-white tabular-nums">TZS {n(pickup.price)}</span>
                </span>
              </div>
            )}
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <PillLink href="#request">Request transport</PillLink>
              <PillLink href={contact} external={contact.startsWith("http")} variant="glass" arrow={false}>Call or WhatsApp us</PillLink>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="request" className={cn(cream, "scroll-mt-24 py-16 sm:py-24")}>
        <div className={container}>
          <Reveal className="mx-auto mb-10 max-w-2xl text-center">
            <p className={cn(eyebrow, goldText)}>Request transport</p>
            <h2 className={cn("mt-3 text-balance text-tone", type.h2)}>Tell us where and when</h2>
            <p className="mt-4 text-tone/65">No account needed. We call or WhatsApp you to confirm — your request is confirmed only then.</p>
          </Reveal>
          {services.length > 0
            ? <TransportRequest services={services.map((x) => ({ id: x.id, name: x.name, description: x.description, type: x.type, price: x.price, options: x.options.map((o) => ({ id: o.id, name: o.name, description: o.description, price: o.price })) }))} today={today} initial={typeof sp.service === "string" ? sp.service : null} online={await onlinePayAvailable("transport", s)} />
            : <p className="text-center text-tone/65">Transport requests are paused right now — please call us.</p>}
        </div>
      </section>

      <section className={cn(espresso, "py-16 text-white sm:py-20")}>
        <div className={cn(container, "grid gap-8 sm:grid-cols-3")}>
          {[
            { icon: <PhoneCall className="size-5" />, title: "We confirm with you", text: "Our reception calls or messages you to confirm the time, the place and the price." },
            { icon: <PlaneLanding className="size-5" />, title: "Your driver is there", text: "For airport pickups we follow your flight and wait at arrivals — tell us if you would like a name sign." },
            { icon: <ShieldCheck className="size-5" />, title: "Simple payment", text: "Pay after the trip, or add it to your room bill and settle everything at checkout." },
          ].map((x) => (
            <Reveal key={x.title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <span className="grid size-11 place-items-center rounded-2xl bg-gold/15 text-gold">{x.icon}</span>
              <h3 className="mt-4 font-display text-2xl">{x.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{x.text}</p>
            </Reveal>
          ))}
        </div>
        <div className={cn(container, "mt-10 flex flex-wrap items-center justify-center gap-3 text-sm text-white/70")}>
          <MessageCircle className="size-4 text-gold" /> Travelling today or need it now? Call or WhatsApp us — we arrange it directly.
        </div>
      </section>
    </>
  );
}
