import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { pillDark, pillGlass, pillGold, pillOutline, pillPad, pillPadIcon } from "./ui";

const VARIANTS = { gold: pillGold, glass: pillGlass, dark: pillDark, outline: pillOutline } as const;

/** Circular arrow badge used inside pill buttons and on image cards. */
export function ArrowBadge({ tone = "dark", className }: { tone?: "dark" | "gold" | "light"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-300 group-hover/pill:rotate-45 group-hover:rotate-45 motion-reduce:transition-none",
        tone === "dark" && "bg-[#15120e] text-gold",
        tone === "gold" && "bg-gold text-[#15120e]",
        tone === "light" && "bg-panel text-tone",
        className,
      )}
    >
      <ArrowUpRight className="size-4" strokeWidth={1.8} />
    </span>
  );
}

export function PillLink({
  href,
  children,
  variant = "gold",
  arrow = true,
  className,
  external = false,
  ...rest
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof VARIANTS;
  arrow?: boolean;
  className?: string;
  external?: boolean;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">) {
  const badgeTone = variant === "gold" ? "dark" : variant === "dark" ? "gold" : variant === "glass" ? "gold" : "dark";
  const cls = cn(VARIANTS[variant], arrow ? pillPadIcon : pillPad, className);
  const inner = (
    <>
      <span className="relative">{children}</span>
      {arrow && <ArrowBadge tone={badgeTone} />}
    </>
  );
  if (external) {
    return (
      <a href={href} className={cls} {...rest}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {inner}
    </Link>
  );
}
