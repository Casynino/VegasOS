import { Check } from "lucide-react";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { NamedIcon } from "./icon";
import { HudLabel } from "./kit/hud";
import { typeScale } from "./kit/tokens";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The last fact completes its row (2 columns on phones, 3 from 640px), so no row ends half-ruled. */
function lastSpan(total: number) {
  return cn(total % 2 === 1 && "col-span-2", total % 3 === 1 ? "sm:col-span-3" : total % 3 === 2 ? "sm:col-span-2" : "sm:col-span-1");
}

/**
 * A room type's technical spec sheet: a header line, the facts as a measured grid (guests,
 * children, bed, size, check-in, check-out, reception — only what the database has), then the
 * amenities as numbered rows with dotted leaders. Follows the band's tone. A server component; `facts` come in the
 * visitor's language (terms may also be English keys).
 */
export async function RoomSpecSheet({
  name,
  index,
  total,
  facts,
  amenities,
  included,
  className,
}: {
  name: string;
  index: number;
  total: number;
  facts: { term: string; value: string }[];
  amenities: { code: string; name: string; icon: string | null }[];
  /** Amenity codes to mark "Included" (breakfast, Wi-Fi). */
  included: Set<string>;
  className?: string;
}) {
  const t = await getT();
  return (
    <section aria-labelledby="spec-title" className={cn("min-w-0", className)}>
      <div className="flex items-center justify-between gap-4 border-b border-pub-line pb-3">
        <h2 id="spec-title" className="min-w-0 leading-none">
          <HudLabel as="span">
            {t("Specification")}<span className="hidden sm:inline"> · {t(name)}</span>
          </HudLabel>
        </h2>
        {index > 0 && (
          <span aria-hidden="true" className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-pub-muted sm:text-[11px]">
            {t("Type {n}/{total}", { n: pad2(index), total: pad2(total) })}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3">
        {facts.map((f, i) => (
          <div key={f.term} className={cn("relative min-w-0 border-b border-pub-line py-5 pr-4", i === facts.length - 1 && lastSpan(facts.length))}>
            {/* A tick at the cell's corner, like a drawing's measure mark. */}
            <span aria-hidden="true" className="absolute left-0 top-0 h-2 w-px bg-pub-eyebrow/60" />
            <dt className="pl-3 font-mono text-[10px] uppercase tracking-[0.2em] text-pub-muted sm:text-[11px]">{t(f.term)}</dt>
            <dd className="mt-2 pl-3 font-display text-[1.375rem] font-medium leading-tight text-pub-fg lining-nums sm:text-[1.5rem]">{f.value}</dd>
          </div>
        ))}
      </dl>

      {amenities.length > 0 && (
        <div className="mt-10 sm:mt-12">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className={typeScale.subheading} id="amenities-title">{t("In the room")}</h3>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-pub-muted sm:text-[11px]">{t("{n} items", { n: pad2(amenities.length) })}</span>
          </div>
          <ul aria-labelledby="amenities-title" className="mt-4 border-t border-pub-line">
            {amenities.map((a, i) => (
              <li key={a.code} className="flex min-h-14 min-w-0 items-center gap-3 border-b border-pub-line py-3 sm:gap-4">
                <span aria-hidden="true" className="w-6 shrink-0 font-mono text-[10px] tracking-[0.18em] text-pub-eyebrow sm:text-[11px]">{pad2(i + 1)}</span>
                <NamedIcon name={a.icon} className="size-[18px] shrink-0 text-pub-eyebrow" />
                <span className="min-w-0 text-[15px] leading-snug text-pub-fg">{t(a.name)}</span>
                <span aria-hidden="true" className="min-w-4 flex-1 translate-y-1 border-b border-dotted border-pub-line" />
                {included.has(a.code) ? (
                  <span className={cn(typeScale.meta, "shrink-0 text-pub-eyebrow")}>{t("Included")}</span>
                ) : (
                  <Check aria-hidden="true" className="size-4 shrink-0 text-pub-eyebrow/80" strokeWidth={1.8} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
