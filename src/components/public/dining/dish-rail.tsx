import Link from "next/link";
import { cn } from "@/lib/utils";
import { MediaFrame } from "../kit/media-frame";
import { PriceTag } from "../kit/price-tag";
import { Rail } from "../kit/rail";
import { focusRing, typeScale } from "../kit/tokens";
import type { Dish } from "./menu-data";

/**
 * Dishes from the live menu as a swipe rail (arrows on desktop): the photograph, the name and the
 * real price. Each opens that dish's card on the menu (/menu?item=…), where it can be ordered.
 * Stock photos carry the Illustrative tag. Place it directly inside a Section / Container.
 */
export function DishRail({ dishes, label = "Dishes from the kitchen", className }: { dishes: Dish[]; label?: string; className?: string }) {
  if (dishes.length === 0) return null;
  return (
    <Rail label={label} size="md" desktop={dishes.length <= 3 ? "grid" : "rail"} cols={3} className={className}>
      {dishes.map((d) => (
        <Link key={d.key} href={`/menu?item=${d.key}`} className={cn("group block rounded-[0.125rem]", focusRing)}>
          <MediaFrame
            src={d.image.src}
            alt={d.image.alt}
            ratio="4/5"
            zoom
            illustrative={d.stock}
            sizes="(min-width: 1024px) 31vw, (min-width: 640px) 44vw, 76vw"
          />
          <h3 className={cn(typeScale.item, "mt-4 text-pub-fg transition-colors duration-200 group-hover:text-pub-eyebrow motion-reduce:transition-none")}>
            {d.name}
          </h3>
          {d.description && <p className="mt-1.5 line-clamp-1 text-[14px] text-pub-muted">{d.description}</p>}
          <PriceTag amount={d.price} unit={null} from={d.from} size="sm" className="mt-3" />
        </Link>
      ))}
    </Rail>
  );
}
