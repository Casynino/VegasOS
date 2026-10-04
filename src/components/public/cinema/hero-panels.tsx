"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Cloud, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSun, Moon, Plane, Sun } from "lucide-react";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HotelWeather } from "@/server/services/weather";

const TZ = "Africa/Dar_es_Salaam";
const card = "vlh-glass vlh-hud relative overflow-hidden rounded-[1.6rem] text-white";
const head = "flex items-center justify-between text-[13px] text-white/80";

function WeatherIcon({ w, className }: { w: HotelWeather; className?: string }) {
  const I = w.kind === "clear" ? (w.isDay ? Sun : Moon)
    : w.kind === "partly" ? (w.isDay ? CloudSun : CloudMoon)
    : w.kind === "cloudy" ? Cloud : w.kind === "fog" ? CloudFog : w.kind === "rain" ? CloudRain : CloudLightning;
  return <I className={className} strokeWidth={1.4} aria-hidden="true" />;
}

function useClock(initial: string) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date()); // eslint-disable-line react-hooks/set-state-in-effect
    const t = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(t);
  }, []);
  const time = now ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(now) : initial;
  const day = now ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: TZ }).format(now) : null;
  return { time, day };
}

/** Live local time + current weather at the hotel. */
export function NowCard({ weather, initialTime, checkInTime }: { weather: HotelWeather | null; initialTime: string; checkInTime: string }) {
  const { time, day } = useClock(initialTime);
  return (
    <div className={cn(card, "p-5")}>
      <p className={head}><span>Dar es Salaam · now</span><span className="font-mono text-xs text-white/60 tabular-nums">{time}</span></p>
      {weather ? (
        <div className="mt-3 flex items-center gap-4">
          <WeatherIcon w={weather} className="size-12 text-gold drop-shadow-[0_0_14px_oklch(0.78_0.12_80/0.7)]" />
          <div>
            <p className="font-display text-5xl font-light leading-none">{weather.temp}°C</p>
            <p className="mt-1 text-sm text-white/75">{weather.label}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 font-display text-5xl font-light leading-none tabular-nums">{time}</p>
      )}
      <p className="mt-3 text-xs text-white/55">
        {weather ? `Feels like ${weather.feelsLike}°C` : day ?? "Local time"} · Check-in from {checkInTime}
      </p>
    </div>
  );
}

/** Stylised arrival map: airport → hotel, with the airport-pickup offer. Decorative, not to scale. */
export function ArrivalCard({ airportKm }: { airportKm: number }) {
  return (
    <Link href="/book" className={cn(card, "group block p-5 transition-transform duration-500 hover:-translate-y-1")}>
      <p className={head}><span>Airport arrival</span><ArrowRight className="size-4 text-white/60 transition-transform group-hover:translate-x-1" aria-hidden="true" /></p>
      <div className="relative mt-3 h-24 overflow-hidden rounded-xl bg-[#0d0b08]/55">
        <svg viewBox="0 0 220 96" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <linearGradient id="route" x1="0" x2="1"><stop offset="0" stopColor="#7aa7ff" /><stop offset="1" stopColor="oklch(0.8 0.13 80)" /></linearGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="2.2" /></filter>
          </defs>
          {/* streets */}
          <g stroke="white" strokeOpacity="0.08" fill="none" strokeWidth="0.8">
            <path d="M0 20 L60 26 L110 12 L220 22" /><path d="M0 58 L50 50 L120 64 L220 48" /><path d="M0 86 L80 78 L150 90 L220 80" />
            <path d="M30 0 L40 96" /><path d="M92 0 L84 96" /><path d="M140 0 L152 96" /><path d="M190 0 L182 96" />
            <path d="M0 40 L220 34" strokeOpacity="0.05" /><path d="M60 0 L64 96" strokeOpacity="0.05" /><path d="M170 0 L166 96" strokeOpacity="0.05" />
          </g>
          <path d="M26 74 C 60 70, 70 44, 104 46 S 150 36, 168 30 S 190 20, 194 18" fill="none" stroke="url(#route)" strokeWidth="3" filter="url(#glow)" opacity="0.8" />
          <path d="M26 74 C 60 70, 70 44, 104 46 S 150 36, 168 30 S 190 20, 194 18" fill="none" stroke="url(#route)" strokeWidth="1.4" strokeDasharray="3 3" className="motion-safe:animate-[vlh-dash_2.4s_linear_infinite]" />
          <circle cx="26" cy="74" r="4" fill="#7aa7ff" /><circle cx="26" cy="74" r="8" fill="#7aa7ff" opacity="0.25" />
          <circle cx="194" cy="18" r="4.5" fill="oklch(0.8 0.13 80)" /><circle cx="194" cy="18" r="10" fill="oklch(0.8 0.13 80)" opacity="0.25" className="motion-safe:animate-pulse" />
        </svg>
        <span className="absolute bottom-1.5 left-2 inline-flex items-center gap-1 text-[10px] text-[#a9c4ff]"><Plane className="size-3" aria-hidden="true" />Airport</span>
        <span className="absolute right-2 top-7 text-[10px] text-gold">Vegas</span>
      </div>
      <p className="mt-3 text-sm"><span className="font-display text-2xl">{airportKm} km</span> <span className="text-white/60">· pickup by our drivers</span></p>
    </Link>
  );
}

export interface PanelRoom { slug: string; name: string; image: string | null; net: number; free: number; href: string }

/** Tonight's live availability, like a concierge's short list. */
export function RoomsTonightPanel({ rooms, totalFree }: { rooms: PanelRoom[]; totalFree: number }) {
  if (rooms.length === 0) return null;
  return (
    <div className={cn(card, "p-5")}>
      <p className={head}>
        <span>Rooms tonight</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden="true" />{totalFree} available</span>
      </p>
      <ul className="mt-3 divide-y divide-white/10">
        {rooms.map((r) => (
          <li key={r.slug}>
            <Link href={r.href} className="group flex items-center gap-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
              <span className="relative size-14 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/15">
                {r.image && <Image src={r.image} alt="" fill sizes="56px" className="object-cover transition-transform duration-700 group-hover:scale-110" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{r.name}</span>
                <span className="block text-xs text-white/60">from <span className="text-gold">{formatTZS(r.net)}</span>{r.free <= 3 && <> · {r.free} left</>}</span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-white/50 transition-all group-hover:rotate-45 group-hover:text-gold" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
