import { cn } from "@/lib/utils";
import { measure, typeScale } from "./kit/tokens";
import { Ornament } from "./ornament";

/**
 * Eyebrow + H2 + lede with explicit colours (tone "light" = on cream, "dark" = on night).
 * Kept for older pages; new sections use the kit's <SectionIntro>, which follows the section tone.
 * The gold ornament is now optional (off by default — calmer headings).
 */
export function SectionHeading({
  kicker,
  title,
  intro,
  align = "center",
  tone = "light",
  as: Tag = "h2",
  ornament = false,
  className,
}: {
  kicker?: string;
  title: string;
  intro?: React.ReactNode;
  align?: "center" | "left";
  tone?: "light" | "dark";
  as?: "h1" | "h2";
  ornament?: boolean;
  className?: string;
}) {
  const dark = tone === "dark";
  const center = align === "center";
  return (
    <div className={cn(center ? "mx-auto max-w-2xl text-center" : "max-w-2xl", className)}>
      {kicker && <p className={cn(typeScale.eyebrow, dark ? "text-gold" : "text-accent-ink")}>{kicker}</p>}
      <Tag className={cn(kicker && "mt-4", typeScale.heading, dark ? "text-white" : "text-tone")}>{title}</Tag>
      {ornament && <Ornament className={cn("mt-5", center && "mx-auto")} />}
      {intro && (
        <div className={cn("mt-4 sm:mt-5", typeScale.lede, measure.lede, center && "mx-auto", dark ? "text-white/70" : "text-tone/70")}>
          {intro}
        </div>
      )}
    </div>
  );
}
