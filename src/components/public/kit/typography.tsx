import { cn } from "@/lib/utils";
import { measure, rhythm, typeScale } from "./tokens";

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "p";
type HeadingSize = "display" | "title" | "heading" | "feature" | "subheading" | "item";

/** Small caps label above a heading. `rule` adds a short gold line before it. */
export function Eyebrow({
  as: Tag = "p",
  rule = false,
  className,
  children,
}: {
  as?: "p" | "span" | "div" | "h2" | "h3";
  rule?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag
      className={cn(
        typeScale.eyebrow,
        "text-pub-eyebrow",
        rule && "flex items-center gap-3 before:h-px before:w-8 before:shrink-0 before:bg-current before:opacity-70",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Any heading level in any size of the scale (defaults: <h2>, section heading). */
export function Heading({
  as: Tag = "h2",
  size = "heading",
  id,
  className,
  children,
}: {
  as?: HeadingTag;
  size?: HeadingSize;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag id={id} className={cn(typeScale[size], className)}>
      {children}
    </Tag>
  );
}

/** The big moment (hero / closing CTA). Defaults to <h1>. */
export function Display({ as = "h1", ...props }: Omit<React.ComponentProps<typeof Heading>, "size">) {
  return <Heading as={as} size="display" {...props} />;
}

/** A word or two inside a heading in the accent colour (gold on night, deep gold on paper). */
export function Accent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("text-pub-eyebrow", className)}>{children}</span>;
}

/** One or two sentences under a heading. */
export function Lede({ as: Tag = "p", className, children }: { as?: "p" | "div"; className?: string; children: React.ReactNode }) {
  return <Tag className={cn(typeScale.lede, measure.lede, "text-pub-muted", className)}>{children}</Tag>;
}

/**
 * Eyebrow + heading + lede + actions — the opening of most sections.
 * align: "left" (default), "center", or "split" (heading left, lede and actions right on desktop).
 */
export function SectionIntro({
  eyebrow,
  title,
  lede,
  actions,
  align = "left",
  as = "h2",
  size = "heading",
  id,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  align?: "left" | "center" | "split";
  as?: HeadingTag;
  size?: HeadingSize;
  /** Heading id — pass the same value to Section labelledBy. */
  id?: string;
  className?: string;
}) {
  const head = (
    <>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Heading as={as} size={size} id={id} className={cn(eyebrow && rhythm.afterEyebrow, measure.heading)}>
        {title}
      </Heading>
    </>
  );
  const center = align === "center";
  const ledeEl = lede && <Lede as={typeof lede === "string" ? "p" : "div"}>{lede}</Lede>;
  const actionsEl = actions && <div className={cn("flex flex-wrap items-center gap-x-7 gap-y-3", center && "justify-center")}>{actions}</div>;

  if (align === "split") {
    return (
      <div className={cn("grid gap-5 lg:grid-cols-12 lg:items-end lg:gap-10", className)}>
        <div className="lg:col-span-7">{head}</div>
        {(ledeEl || actionsEl) && (
          <div className="space-y-6 lg:col-span-4 lg:col-start-9 lg:pb-1.5">
            {ledeEl}
            {actionsEl}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn(center && "mx-auto flex flex-col items-center text-center", className)}>
      {head}
      {ledeEl && <div className={cn(rhythm.afterHeading, center && "flex justify-center")}>{ledeEl}</div>}
      {actionsEl && <div className={cn(rhythm.beforeActions, center && "w-full")}>{actionsEl}</div>}
    </div>
  );
}
