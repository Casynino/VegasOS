import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { MediaFrame } from "../kit/media-frame";
import { PriceTag } from "../kit/price-tag";
import { Rail } from "../kit/rail";
import { focusRing, typeScale } from "../kit/tokens";
import type { Dish } from "./menu-data";
import s from "./dining.module.css";

/**
 * Dishes from the live menu as a swipe rail (arrows on desktop): the photograph, the name and the
 * real price. Each opens that dish's card on the menu (/menu?item=…), where it can be ordered.
 * Hover (desktop): the viewfinder closes in on the photo, a fine scan crosses it once, and a
 * cursor light follows. Stock photos carry the Illustrative tag. Place it directly inside a
 * Section / Container.
 */
export async function DishRail({ dishes, label, className }: { dishes: Dish[]; label?: string; className?: string }) {
  if (dishes.length === 0) return null;
  // The dishes are the hotel's own content: shown in the visitor's language (saved translation, else English).
  const t = await getT();
  return (
    <Rail label={label ?? t("Dishes from the kitchen")} size="md" desktop={dishes.length <= 3 ? "grid" : "rail"} cols={3} className={className}>
      {dishes.map((d) => (
        <Link key={d.key} href={`/menu?item=${d.key}`} data-spotlight="" className={cn("group block rounded-[0.125rem] [--spot-r:16rem]", focusRing)}>
          <MediaFrame
            src={d.image.src}
            alt={t(d.image.alt)}
            ratio="4/5"
            zoom
            illustrative={d.stock}
            overlay="bottom"
            sizes="(min-width: 1024px) 31vw, (min-width: 640px) 44vw, 76vw"
          >
            <span aria-hidden="true" className={s.scan} />
            <span aria-hidden="true" className={s.corners} />
            <span data-tone="night" className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:p-5">
              <PriceTag amount={d.price} unit={null} from={d.from} size="sm" />
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-full border border-white/25 bg-black/30 text-white backdrop-blur-sm transition-colors duration-300 group-hover:border-gold group-hover:bg-gold group-hover:text-[#16110a] motion-reduce:transition-none"
              >
                <ArrowUpRight className="size-4" strokeWidth={1.6} />
              </span>
            </span>
          </MediaFrame>
          <h3 className={cn(typeScale.item, "mt-4 text-pub-fg transition-colors duration-200 group-hover:text-pub-eyebrow motion-reduce:transition-none")}>
            {t(d.name)}
          </h3>
          {d.description && <p className="mt-1.5 line-clamp-1 text-[14px] text-pub-muted">{t(d.description)}</p>}
        </Link>
      ))}
    </Rail>
  );
}
