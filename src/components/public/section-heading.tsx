import { cn } from "@/lib/utils";
import { Ornament } from "./ornament";
import { eyebrow, goldText, type } from "./ui";

export function SectionHeading({
  kicker,
  title,
  intro,
  align = "center",
  tone = "light",
  as: Tag = "h2",
  className,
}: {
  kicker?: string;
  title: string;
  intro?: React.ReactNode;
  align?: "center" | "left";
  tone?: "light" | "dark";
  as?: "h1" | "h2";
  className?: string;
}) {
  const dark = tone === "dark";
  return (
    <div className={cn(align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl", className)}>
      {kicker && <p className={cn(eyebrow, dark ? "text-gold" : goldText)}>{kicker}</p>}
      <Tag className={cn("mt-4 text-balance", type.h2, dark ? "text-white" : "text-tone")}>
        {title}
      </Tag>
      <Ornament className={cn("mt-5", align === "center" && "mx-auto")} />
      {intro && <div className={cn("mt-5 text-pretty", type.lead, dark ? "text-white/70" : "text-tone/70")}>{intro}</div>}
    </div>
  );
}
