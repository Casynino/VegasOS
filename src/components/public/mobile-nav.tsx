"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, Phone, X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { telHref, whatsappHref } from "./contact";
import { Ornament } from "./ornament";
import { PillLink } from "./pill-link";
import { NAV_LINKS } from "./site-config";
import { StaffLink } from "./staff-link";
import { ThemeToggle } from "./theme-toggle";

/** Full-screen mobile menu: Book CTA first, numbered editorial links, contact at the bottom. */
export function MobileNav({ hotelName, phone, whatsapp }: { hotelName: string; phone: string | null; whatsapp: string | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const links = [{ href: "/", label: "Home" }, ...NAV_LINKS];
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            className="group inline-flex size-11 flex-col items-center justify-center gap-1.5 rounded-full border border-white/15 text-white transition-colors hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold xl:hidden"
          />
        }
      >
        <span className="h-px w-5 bg-current transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        <span className="h-px w-5 bg-current transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
        <span className="sr-only">Open menu</span>
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full max-w-none gap-0 border-l border-white/10 bg-[#15120e] p-0 text-white data-[side=right]:w-full sm:data-[side=right]:max-w-md"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          aria-hidden="true"
          style={{ backgroundImage: "radial-gradient(ellipse 70% 40% at 100% 0%, oklch(0.72 0.12 80 / 0.18), transparent 70%)" }}
        />
        <div className="relative flex h-18 items-center justify-between px-5">
          <SheetTitle className="font-display text-xl font-semibold text-gold">{hotelName}</SheetTitle>
          <SheetClose
            render={
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-full border border-white/15 text-white/90 hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              />
            }
          >
            <X className="size-5" aria-hidden="true" />
            <span className="sr-only">Close menu</span>
          </SheetClose>
        </div>

        <div className="relative px-5 pt-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:duration-500">
          <PillLink href="/book" onClick={close} className="w-full justify-between py-2 text-base">
            Book your stay
          </PillLink>
        </div>

        <nav aria-label="Mobile" className="relative flex-1 overflow-y-auto px-5 pb-4 pt-6">
          <ul className="divide-y divide-white/[0.07]">
            {links.map((l, i) => {
              const active = l.href === "/" ? pathname === "/" : pathname === l.href || pathname.startsWith(`${l.href}/`);
              return (
                <li
                  key={l.href}
                  className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-6 motion-safe:fill-mode-both motion-safe:duration-500"
                  style={{ animationDelay: `${80 + i * 45}ms` }}
                >
                  <Link
                    href={l.href}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className="group flex items-baseline gap-4 py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    <span className="w-6 text-xs tabular-nums text-gold/70">{String(i + 1).padStart(2, "0")}</span>
                    <span
                      className={cn(
                        "font-display text-[1.9rem] leading-none text-white/90 transition-colors group-hover:text-gold",
                        active && "italic text-gold",
                      )}
                    >
                      {l.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="relative border-t border-white/10 px-5 py-5">
          <Ornament className="mb-4" />
          <div className="grid grid-cols-2 gap-3">
            {phone && (
              <a href={telHref(phone)} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 py-3 text-sm text-white/90 hover:border-gold hover:text-gold">
                <Phone className="size-4" aria-hidden="true" /> Call
              </a>
            )}
            {whatsapp && (
              <a href={whatsappHref(whatsapp)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 py-3 text-sm text-white/90 hover:border-gold hover:text-gold">
                <MessageCircle className="size-4" aria-hidden="true" /> WhatsApp<span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
          <div className="mt-4 flex justify-center"><ThemeToggle withLabel /></div>
          <StaffLink withIcon onClick={close} className="mt-4 w-full justify-center py-2 text-sm text-white/55 hover:text-gold" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
