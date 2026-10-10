import { PlaneLanding } from "lucide-react";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { HudLabel } from "../kit/hud";
import fx from "./fx.module.css";

/* The road as a calm S-curve: wide on desktop (airport bottom-left, hotel top-right — the hotel lies
   north of the airport), tall on phones. Endpoints double as the label anchors (in % of the box). */
const WIDE = {
  box: "0 0 1200 300",
  d: "M90 236C250 236 300 160 430 165S640 238 765 192S960 82 1110 82",
  a: { x: 90, y: 236 },
  b: { x: 1110, y: 82 },
  streets: "M0 128L1200 52M188 0L330 300M612 0L548 300M902 0L1012 300M0 284L1200 258M0 18L520 0",
};
const TALL = {
  box: "0 0 360 440",
  d: "M70 380C70 312 150 300 162 250S104 166 190 134S290 118 290 64",
  a: { x: 70, y: 380 },
  b: { x: 290, y: 64 },
  streets: "M0 300L360 250M0 96L360 40M120 0L170 440M262 0L300 440",
};

function Diagram({ g, className }: { g: typeof WIDE; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox={g.box} className={cn(fx.routeSvg, className)} preserveAspectRatio="xMidYMid meet">
      <path d={g.streets} fill="none" stroke="rgb(227 189 106 / 0.1)" strokeWidth="1" />
      <path d={g.d} pathLength={1} className={fx.routeTrack} />
      <path d={g.d} className={fx.routeLine} />
      <path d={g.d} pathLength={1} className={fx.routeGlow} />
      <path d={g.d} pathLength={1} className={fx.routeComet} />
      {/* The airport: a ring with a dot. */}
      <circle cx={g.a.x} cy={g.a.y} r="16" className={fx.routeRing} />
      <circle cx={g.a.x} cy={g.a.y} r="4" className={fx.routeDot} />
      {/* The hotel: a dot with two soft pulses (on screen only). */}
      <circle cx={g.b.x} cy={g.b.y} r="14" className={fx.routePulse} />
      <circle cx={g.b.x} cy={g.b.y} r="14" className={fx.routePulse} />
      <circle cx={g.b.x} cy={g.b.y} r="22" className={fx.routeRing} />
      <circle cx={g.b.x} cy={g.b.y} r="6" className={fx.routeDot} />
      <path d={`M${g.b.x - 34} ${g.b.y}h-14M${g.b.x + 34} ${g.b.y}h14M${g.b.x} ${g.b.y - 34}v-14M${g.b.x} ${g.b.y + 34}v14`} className={fx.routeTick} />
    </svg>
  );
}

/**
 * Airport → hotel as a HUD route map (Transport): the dashed road from Julius Nyerere International
 * Airport to the hotel, a lit comet that travels it every few seconds while it is on screen, the
 * hotel pulsing at its real coordinates, and the real distance on the road. The street lines are
 * decorative, not a map. With reduced motion it is a still drawing.
 */
export async function RouteMap({
  airport,
  airportCode = "JNIA",
  hotel,
  coords,
  distance,
  className,
}: {
  /** "Julius Nyerere International Airport". */
  airport: string;
  airportCode?: string;
  hotel: string;
  /** HOTEL_COORDS.label */
  coords: string;
  /** "About 14 km" (from the site's facts). */
  distance: string;
  className?: string;
}) {
  const t = await getT();
  // Label anchors in % of the drawing. The hotel's label hangs from the right (so it is never squeezed).
  const at = (g: typeof WIDE, p: { x: number; y: number }) => {
    const [, , w, h] = g.box.split(" ").map(Number);
    return { left: `${(p.x / w) * 100}%`, top: `${(p.y / h) * 100}%` };
  };
  const fromRight = (g: typeof WIDE, p: { x: number; y: number }) => {
    const [, , w, h] = g.box.split(" ").map(Number);
    return { right: `${100 - (p.x / w) * 100}%`, top: `${(p.y / h) * 100}%` };
  };
  return (
    <div data-live-watch="" suppressHydrationWarning className={cn(fx.route, "relative", className)}>
      {/* Phones: the tall drawing with its labels. */}
      <div className="relative sm:hidden">
        <Diagram g={TALL} />
        <div className="absolute w-max max-w-[11rem]" style={{ ...at(TALL, TALL.a), transform: "translate(1.75rem, -50%)" }}>
          <Endpoint icon code={airportCode} name={airport} hud={t("Arrivals")} />
        </div>
        <div className="absolute w-max max-w-[12rem] text-right" style={{ ...fromRight(TALL, TALL.b), transform: "translate(-2.25rem, -30%)" }}>
          <Endpoint name={hotel} hud={coords} align="end" />
        </div>
        <span className="absolute left-[46%] top-[52%] -translate-x-1/2 -translate-y-1/2">
          <Distance>{distance}</Distance>
        </span>
      </div>
      {/* From 640px: the wide drawing. */}
      <div className="relative hidden sm:block">
        <Diagram g={WIDE} />
        <div className="absolute w-max max-w-[16rem]" style={{ ...at(WIDE, WIDE.a), transform: "translate(-1rem, 1.75rem)" }}>
          <Endpoint icon code={airportCode} name={airport} hud={t("Arrivals")} />
        </div>
        <div className="absolute w-max max-w-[16rem] text-right" style={{ ...fromRight(WIDE, WIDE.b), transform: "translate(1.25rem, 2.75rem)" }}>
          <Endpoint name={hotel} hud={coords} align="end" />
        </div>
        <span className="absolute left-[53.5%] top-[58%] -translate-x-1/2">
          <Distance>{distance}</Distance>
        </span>
        <span aria-hidden="true" className="absolute right-0 top-0 flex flex-col items-center gap-1 font-mono text-[10px] tracking-[0.2em] text-pub-muted">
          N
          <span className="h-6 w-px bg-linear-to-b from-pub-eyebrow to-transparent" />
        </span>
      </div>
      <p className="sr-only">{t("From {airport} to {hotel}: {distance}.", { airport, hotel, distance })}</p>
    </div>
  );
}

function Endpoint({ icon, code, name, hud, align = "start" }: { icon?: boolean; code?: string; name: string; hud: string; align?: "start" | "end" }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-1.5", align === "end" && "items-end")}>
      <span className="flex items-center gap-2 text-pub-fg">
        {icon && <PlaneLanding className="size-4 text-pub-eyebrow" strokeWidth={1.5} />}
        {code ? (
          <span className="font-mono text-[13px] font-medium tracking-[0.2em] sm:text-[14px]">{code}</span>
        ) : (
          <span className="font-display text-[1.25rem] leading-tight sm:text-[1.5rem]">{name}</span>
        )}
      </span>
      {code && <span className="text-[12px] leading-snug text-pub-muted sm:text-[13px]">{name}</span>}
      <HudLabel tick={false} className="text-pub-eyebrow">{hud}</HudLabel>
    </div>
  );
}

function Distance({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pub-glass inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-pub-fg"
    >
      <span className="size-1.5 rounded-full bg-gold" />
      {children}
    </span>
  );
}

/**
 * A trip's route as a small HUD line (the trip page): the pickup with a dot, a dashed road with a
 * light that travels it while on screen, the destination with a ring. The words are the guest's
 * own pickup and destination; stacked so long addresses wrap freely.
 */
export async function MiniRoute({ from, to, className }: { from: React.ReactNode; to: React.ReactNode; className?: string }) {
  // t.ctx("trip", …): the trip's sense of the word ("From" is a starting price elsewhere).
  const t = await getT();
  return (
    <div data-live-watch="" suppressHydrationWarning className={cn(fx.route, "relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-4", className)}>
      {/* From: a lit dot, then the dashed road down to the destination's ring. */}
      <span aria-hidden="true" className="flex flex-col items-center pt-0.5">
        <span className="size-2.5 shrink-0 rounded-full bg-gold shadow-[0_0_12px_2px_rgb(227_189_106/0.55)]" />
        <span className={cn(fx.miniRoad, "mt-1.5 w-px flex-1")} />
      </span>
      <div className="min-w-0 pb-6">
        <HudLabel tick={false}>{t.ctx("trip", "From")}</HudLabel>
        <p className="mt-2 font-display text-[1.375rem] leading-tight text-pub-fg [overflow-wrap:anywhere]">{from}</p>
      </div>
      <span aria-hidden="true" className="flex justify-center">
        <span className="grid size-4 shrink-0 place-items-center rounded-full border border-gold/70">
          <span className="size-1.5 rounded-full bg-gold" />
        </span>
      </span>
      <div className="min-w-0">
        <HudLabel tick={false}>{t.ctx("trip", "To")}</HudLabel>
        <p className="mt-2 font-display text-[1.375rem] leading-tight text-pub-fg [overflow-wrap:anywhere]">{to}</p>
      </div>
    </div>
  );
}
