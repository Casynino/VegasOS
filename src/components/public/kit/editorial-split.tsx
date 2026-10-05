import { cn } from "@/lib/utils";

// 12-column desktop grid; one empty column of air between image and text.
const LAYOUT = {
  /** Image 7 columns, text 4 — the default editorial look. */
  "media-wide": { media: "lg:col-span-7", text: "lg:col-span-4", textStart: "lg:col-start-9", mediaStartReversed: "lg:col-start-6" },
  /** Near-equal halves (6 + 5). */
  balanced: { media: "lg:col-span-6", text: "lg:col-span-5", textStart: "lg:col-start-8", mediaStartReversed: "lg:col-start-7" },
  /** Text leads (6), a smaller image beside it (5). */
  "text-wide": { media: "lg:col-span-5", text: "lg:col-span-6", textStart: "lg:col-start-7", mediaStartReversed: "lg:col-start-8" },
} as const;

/**
 * Image and text side by side on desktop (asymmetric by default), stacked on phones —
 * image first unless `textFirst`. `reverse` puts the image on the right.
 */
export function EditorialSplit({
  media,
  layout = "media-wide",
  reverse = false,
  textFirst = false,
  align = "center",
  className,
  mediaClassName,
  textClassName,
  children,
}: {
  media: React.ReactNode;
  layout?: keyof typeof LAYOUT;
  reverse?: boolean;
  /** On phones, show the text before the image. */
  textFirst?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
  mediaClassName?: string;
  textClassName?: string;
  children: React.ReactNode;
}) {
  const l = LAYOUT[layout];
  return (
    <div
      className={cn(
        "grid gap-8 sm:gap-10 lg:grid-cols-12 lg:gap-x-10",
        align === "center" && "lg:items-center",
        align === "end" && "lg:items-end",
        align === "start" && "lg:items-start",
        className,
      )}
    >
      <div
        className={cn(
          "min-w-0 lg:row-start-1",
          l.media,
          reverse ? l.mediaStartReversed : "lg:col-start-1",
          textFirst && "order-last lg:order-none",
          mediaClassName,
        )}
      >
        {media}
      </div>
      <div className={cn("min-w-0 lg:row-start-1", l.text, reverse ? "lg:col-start-1" : l.textStart, textClassName)}>{children}</div>
    </div>
  );
}
