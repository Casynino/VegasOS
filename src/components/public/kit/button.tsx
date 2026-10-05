import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Buttons — slim and quiet (owner, 2026-10-05: "nice buttons, small and well designed", no big yellow blocks).
 * 40px tall (a 3px invisible hit-slop above and below keeps the tap area ≥ 44px), 13–14px medium,
 * sentence case, normal letter spacing.
 *
 * - primary: at most ONE per section. Tone-aware (globals.css .pub-btn-primary): on light paper bands a
 *   small espresso button with white text and a gold hairline edge; on night bands, the header and in the
 *   dark theme a dark, almost clear button with a gold hairline, champagne text and a soft glow on hover.
 * - secondary: a ghost button with a faint border (follows the band's ink).
 * - glass: the ghost over photography (white hairline on a light smoke).
 * - text: everything else — a quiet text link with a small arrow, underline on hover.
 */
export type ButtonVariant = "primary" | "secondary" | "glass" | "text";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "group/btn relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium leading-none tracking-[0.01em] " +
  "transition-[background-color,border-color,color,box-shadow,scale] duration-300 ease-pub active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100 " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-gold disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

/** Invisible hit-slop: the 40px button still answers to a 46px finger target. */
const SLOP = "after:absolute after:inset-x-0 after:-inset-y-[3px] after:content-['']";

const VARIANT: Record<ButtonVariant, string> = {
  primary: cn("pub-btn-primary rounded-full", SLOP),
  secondary: cn("rounded-full border border-pub-fg/20 text-pub-fg hover:border-pub-fg/45 hover:bg-pub-fg/[0.04]", SLOP),
  glass: cn(
    "rounded-full border border-white/30 bg-black/20 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] backdrop-blur-sm hover:border-white/60 hover:bg-black/30",
    SLOP,
  ),
  text: "min-h-11 rounded-sm px-0 text-[13px] text-pub-fg hover:text-pub-eyebrow sm:text-sm",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-[13px]",
  md: "h-10 px-[1.125rem] text-[13px] sm:px-5 sm:text-sm",
  lg: "h-11 px-6 text-sm",
};

/** Class string for a button look (use the components below when you can). */
export function buttonClass({
  variant = "primary",
  size = "md",
  full = false,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; full?: boolean; className?: string } = {}) {
  return cn(BASE, VARIANT[variant], variant !== "text" && SIZE[size], full && "w-full", className);
}

type Icon = "arrow" | "none" | React.ReactNode;

function Inner({ variant, icon, children }: { variant: ButtonVariant; icon: Icon; children: React.ReactNode }) {
  const showArrow = icon === "arrow";
  const custom = icon !== "arrow" && icon !== "none" ? icon : null;
  return (
    <>
      {variant === "text" ? (
        <span
          className={cn(
            "underline decoration-1 underline-offset-[5px] transition-[text-decoration-color] duration-300 ease-pub group-hover/btn:decoration-current group-focus-visible/btn:decoration-current motion-reduce:transition-none",
            // With an arrow the arrow is the cue; without one a faint underline shows it is a link.
            showArrow ? "decoration-transparent" : "decoration-current/30",
          )}
        >
          {children}
        </span>
      ) : (
        <span>{children}</span>
      )}
      {custom}
      {showArrow && (
        <ArrowRight
          aria-hidden="true"
          strokeWidth={1.6}
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-300 ease-pub group-hover/btn:translate-x-0.5 motion-reduce:transition-none",
            variant === "text" && "text-pub-eyebrow",
          )}
        />
      )}
    </>
  );
}

const isExternal = (href: string) => /^(https?:|tel:|mailto:|sms:)/.test(href);

/**
 * A link that looks like a button. Internal paths use next/link; http/tel/mailto use <a>.
 * icon: "arrow" (default for the text variant), "none" (default otherwise) or any node.
 */
export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  icon,
  full = false,
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: Icon;
  full?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">) {
  const cls = buttonClass({ variant, size, full, className });
  const inner = <Inner variant={variant} icon={icon ?? (variant === "text" ? "arrow" : "none")}>{children}</Inner>;
  if (isExternal(href)) {
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

/** The quiet text link: small, sentence case, a small gold arrow, underline on hover. */
export function TextLink(props: Omit<React.ComponentProps<typeof LinkButton>, "variant" | "size" | "full">) {
  return <LinkButton {...props} variant="text" />;
}

/** A real <button> with the same looks (forms, dialogs, toggles). */
export function Button({
  variant = "primary",
  size = "md",
  icon = "none",
  full = false,
  type = "button",
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: Icon;
  full?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  return (
    <button type={type} className={buttonClass({ variant, size, full, className })} {...rest}>
      <Inner variant={variant} icon={icon}>{children}</Inner>
    </button>
  );
}

/** A row of calls to action: wraps on small phones, a primary button sits next to a text link. */
export function Actions({ align = "start", className, children }: { align?: "start" | "center"; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-3", align === "center" && "justify-center", className)}>
      {children}
    </div>
  );
}
