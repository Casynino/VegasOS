import { cn } from "@/lib/utils";
import { HudFrame, MediaFrame } from "../kit";
import css from "./home.module.css";

interface Photo {
  src: string;
  alt: string;
}

/**
 * Dining, in depth: a large room photograph and a smaller close-up layered over its corner, each
 * drifting with the scroll at a different speed (the close-up faster, so it reads nearer), a warm
 * light breathing behind them while on screen, and HUD brackets on the close-up. Both photos are
 * stock and carry their Illustrative tag. Static with reduced motion, still layered.
 */
export function DiningDepth({ main, inset, className }: { main: Photo; inset: Photo; className?: string }) {
  return (
    <div className={cn("relative pb-[24%] sm:pb-[16%] lg:pb-[20%]", className)}>
      <div aria-hidden="true" data-live-watch="" suppressHydrationWarning className={cn(css.diningGlow, "-right-[3%] bottom-[-10%] aspect-square w-[95%] lg:-right-[16%]")} />
      <div className="relative w-[82%] shadow-[0_40px_80px_-40px_rgb(0_0_0/0.9)]">
        <MediaFrame
          src={main.src}
          alt={main.alt}
          ratio="1/1"
          ratioSm="4/3"
          ratioLg="4/5"
          parallax={5}
          sizes="(min-width: 1024px) 40vw, 82vw"
        />
      </div>
      <div className="absolute bottom-0 right-0 w-[46%] sm:w-[40%] lg:w-[46%]">
        <HudFrame offset="sm" size="sm">
          <div className="border-[5px] border-night shadow-[0_30px_60px_-24px_rgb(0_0_0/0.95)] sm:border-[7px]">
            <MediaFrame src={inset.src} alt={inset.alt} ratio="4/5" parallax={10} sizes="(min-width: 1024px) 22vw, 46vw" tagClassName="left-2 top-2" />
          </div>
        </HudFrame>
      </div>
    </div>
  );
}
