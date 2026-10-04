"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // Phones: a sheet from the bottom that always fits the screen (its buttons never hide below it); larger screens: centred.
          "group/dialog fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100svh-1.5rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          "max-sm:top-auto max-sm:bottom-[max(0.5rem,env(safe-area-inset-bottom))] max-sm:max-w-[calc(100%-1rem)] max-sm:translate-y-0 max-sm:rounded-3xl max-sm:data-open:zoom-in-100 max-sm:data-open:slide-in-from-bottom-6",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                // Over a dark header band (DialogHeader with an icon): always light, in either theme.
                className="absolute top-2 right-2 group-has-[[data-hero]]/dialog:text-white/80 group-has-[[data-hero]]/dialog:hover:bg-white/10 group-has-[[data-hero]]/dialog:hover:text-white"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

/** The colour of a dialog's top band: its soft glow and its icon tile. */
const HERO_TONE = {
  gold: { glow: "bg-[oklch(0.75_0.13_80)]/20", tile: "bg-linear-to-br from-[oklch(0.85_0.1_84)] to-[oklch(0.68_0.12_76)] text-[oklch(0.2_0.03_60)]" },
  violet: { glow: "bg-violet-500/20", tile: "bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/30" },
  emerald: { glow: "bg-emerald-500/18", tile: "bg-emerald-500/18 text-emerald-200 ring-1 ring-emerald-400/30" },
  sky: { glow: "bg-sky-500/20", tile: "bg-sky-500/18 text-sky-200 ring-1 ring-sky-400/30" },
  amber: { glow: "bg-amber-500/18", tile: "bg-amber-500/18 text-amber-200 ring-1 ring-amber-400/30" },
  rose: { glow: "bg-rose-500/18", tile: "bg-rose-500/18 text-rose-200 ring-1 ring-rose-400/30" },
} as const
export type DialogTone = keyof typeof HERO_TONE

/**
 * The top of a dialog. Plain by default; with an `icon` (and usually an `eyebrow` — the part of the
 * hotel, e.g. "Restaurant") it is the dark band every pop-up shares: icon tile, small gold label,
 * big title, short line under it, a soft glow in the dialog's `tone`. It runs edge to edge over the
 * dialog's own padding (p-4); a dialog with other padding passes matching margins in `className`.
 */
function DialogHeader({
  className,
  icon,
  eyebrow,
  tone = "gold",
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** An icon element, e.g. <CalendarClock /> — sized by the tile. */
  icon?: React.ReactNode
  /** Small gold label above the title — the area ("Restaurant", "Reception", "Finance"…) or what it is about. */
  eyebrow?: React.ReactNode
  tone?: DialogTone
}) {
  if (!icon && !eyebrow) {
    return (
      <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props}>
        {children}
      </div>
    )
  }
  const t = HERO_TONE[tone]
  return (
    <div
      data-slot="dialog-header"
      data-hero=""
      className={cn(
        "relative -mx-4 -mt-4 overflow-hidden rounded-t-xl bg-[#15110c] px-5 py-4 text-white max-sm:rounded-t-3xl",
        "[&_[data-slot=dialog-title]]:text-xl [&_[data-slot=dialog-title]]:leading-tight [&_[data-slot=dialog-title]]:text-white sm:[&_[data-slot=dialog-title]]:text-2xl",
        "[&_[data-slot=dialog-description]]:text-xs [&_[data-slot=dialog-description]]:text-white/60",
        className
      )}
      {...props}
    >
      <div aria-hidden className={cn("pointer-events-none absolute -top-20 -right-16 size-56 rounded-full blur-3xl", t.glow)} />
      <div className="relative flex items-center gap-3.5 pr-8">
        {icon && <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl sm:size-12 [&_svg]:size-5 sm:[&_svg]:size-6", t.tile)}>{icon}</span>}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {eyebrow && <p className="text-[10px] font-semibold tracking-[0.22em] text-[#f0cf86] uppercase">{eyebrow}</p>}
          {children}
        </div>
      </div>
    </div>
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
