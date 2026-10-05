import { cn } from "@/lib/utils";
import { HudFrame, HudLabel } from "../kit/hud";
import fx from "./fx.module.css";

/**
 * The map as a HUD console (Contact): the live Google map, toned to night and gold, inside thin
 * brackets, with a survey reticle on the hotel's pin (slowly turning while on screen) and the hotel's
 * coordinates on glass. The overlay never takes the pointer, so the map stays usable; the map's own
 * place card, logo, controls and terms keep their corners.
 * While the map loads (or if it is blocked) a topographic sheet with the hotel at its centre shows.
 */
export function MapConsole({
  src,
  title,
  name,
  coords,
  place,
  className,
}: {
  /** The embed URL (MAP_EMBED_URL). */
  src: string;
  /** The iframe's accessible title. */
  title: string;
  name: string;
  /** HOTEL_COORDS.label */
  coords: string;
  /** "Mlimani City · Mwenge" */
  place?: string;
  className?: string;
}) {
  return (
    <HudFrame offset="sm" size="lg" className={className}>
      <div data-live-watch="" suppressHydrationWarning className={cn(fx.map, "aspect-[4/3] sm:aspect-[16/10] lg:aspect-[5/4]")}>
        <div aria-hidden="true" className={fx.mapSheet} />
        <iframe src={src} title={title} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className={fx.mapFrame} allowFullScreen />
        <div aria-hidden="true" className={fx.mapShade} />
        <div aria-hidden="true" className={fx.reticle}>
          <svg viewBox="0 0 200 200" fill="none" stroke="currentColor">
            <circle cx="100" cy="100" r="98" strokeOpacity="0.35" strokeDasharray="1 5" />
            <g className={fx.reticleSpin}>
              <circle cx="100" cy="100" r="78" strokeOpacity="0.55" strokeDasharray="22 10 3 10" />
            </g>
            <circle cx="100" cy="100" r="30" strokeOpacity="0.85" />
            <path d="M100 0v40M100 160v40M0 100h40M160 100h40" strokeOpacity="0.6" />
            <path d="M100 62v10M100 128v10M62 100h10M128 100h10" strokeOpacity="0.9" />
          </svg>
        </div>
        {/* The hotel's tag, on glass, top right (the map's own place card, logo and terms keep their corners). */}
        <div className="pointer-events-none absolute right-3 top-3 hidden sm:right-4 sm:top-4 sm:block">
          <div className="pub-glass rounded-[0.625rem] px-3 py-2.5 text-right" data-tone="night">
            <HudLabel className="text-white/85">{name}</HudLabel>
            <p className="mt-1.5 font-mono text-[11px] tracking-[0.14em] text-gold">{coords}</p>
            {place && <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">{place}</p>}
          </div>
        </div>
      </div>
    </HudFrame>
  );
}
