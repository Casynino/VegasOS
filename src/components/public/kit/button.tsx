import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Buttons. One gold primary per view; a quiet secondary; "glass" only over photography;
 * "text" for the editorial link with an arrow. All are ≥ 44px tall and show a gold focus ring.
 */
export type ButtonVariant = "primary" | "secondary" | "glass" | "text";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "group/btn relative inline-flex select-none items-center justify-center gap-2.5 whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.16em] " +
  "transition-[background-color,border-color,color,box-shadow,scale] duration-300 ease-pub active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-gold disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "rounded-full bg-gold text-[#16110a] shadow-[0_10px_30px_-14px_oklch(0.72_0.12_80/0.9)] hover:bg-[oklch(0.78_0.115_82)] hover:shadow-[0_14px_36px_-12px_oklch(0.72_0.12_80/0.95)]",
  secondary: "rounded-full border border-pub-fg/25 text-pub-fg hover:border-pub-fg/60 hover:bg-pub-fg/[0.05]",
  glass: "rounded-full border border-white/30 bg-white/[0.08] text-white backdrop-blur-md hover:border-white/60 hover:bg-white/[0.14]",
  text: "min-h-11 rounded-sm px-0 text-pub-fg hover:text-pub-eyebrow",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-11 px-5",
  md: "h-12 px-7",
  lg: "h-14 px-8 text-[13px]",
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
        <span className="relative py-1 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-left after:scale-x-[0.35] after:bg-gold after:transition-transform after:duration-300 after:ease-pub group-hover/btn:after:scale-x-100 group-focus-visible/btn:after:scale-x-100 motion-reduce:after:transition-none">
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
          className="size-4 shrink-0 transition-transform duration-300 ease-pub group-hover/btn:translate-x-0.5 motion-reduce:transition-none"
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

/** The editorial text link: small caps, gold underline that grows on hover, arrow. */
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
    <div className={cn("flex flex-wrap items-center gap-x-7 gap-y-3", align === "center" && "justify-center", className)}>
      {children}
    </div>
  );
}
