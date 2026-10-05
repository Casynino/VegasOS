"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isNavActive } from "./site-config";

/**
 * Header link with a hairline gold underline that draws in on hover and stays on the
 * current page. `match` lists the path prefixes that count as "current" ([] = never).
 */
export function NavLink({
  href,
  children,
  className,
  match,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  match?: readonly string[];
}) {
  const pathname = usePathname();
  const active = isNavActive({ href, label: "", match }, pathname);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative rounded-sm py-1 text-sm tracking-wide text-white/80 transition-colors duration-200 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold motion-reduce:transition-none",
        "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-gold after:transition-transform after:duration-300 after:ease-pub motion-reduce:after:transition-none",
        "hover:after:scale-x-100 aria-[current=page]:text-gold aria-[current=page]:after:scale-x-100",
        className,
      )}
    >
      {children}
    </Link>
  );
}
