"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { MessageCircle, Phone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { telHref, whatsappHref } from "./contact";
import { LinkButton } from "./kit/button";
import { MENU_NAV, isNavActive } from "./site-config";
import { StaffLink } from "./staff-link";
import { ThemeToggle } from "./theme-toggle";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

/**
 * The phone/tablet menu (below 1024px): a full-screen night drawer that drops like a curtain.
 * Compact serif links in the order of the story (owner, 2026-10-05: the big links pushed everything off the screen
 * and the staff login could not be found) — related pages as small links beside their parent — then Book your stay,
 * call / WhatsApp, and a clear row with the theme switch and Staff login, all on one phone screen.
 * Base UI Dialog gives the focus trap, Escape to close, scroll lock and focus return.
 */
export function MobileNav({
  hotelName,
  phone,
  whatsapp,
  className,
}: {
  hotelName: string;
  phone: string | null;
  whatsapp: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close when the route changes (e.g. browser Back while the menu is open).
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setOpen(false);
  }
  const close = () => setOpen(false);
  const contacts = [phone, whatsapp].filter(Boolean).length;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          <button
            type="button"
            className={cn(
              "group inline-flex size-11 items-center justify-center rounded-full border border-white/20 text-white transition-colors duration-200 hover:border-white/50 motion-reduce:transition-none",
              focus,
              className,
            )}
          />
        }
      >
        <span aria-hidden="true" className="flex w-[18px] flex-col items-end gap-[5px]">
          <span className="h-px w-[18px] bg-current" />
          <span className="h-px w-3 bg-current transition-[width] duration-300 ease-pub group-hover:w-[18px] motion-reduce:transition-none" />
        </span>
        <span className="sr-only">Open menu</span>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Popup
          data-tone="night"
          className={cn(
            "pub-sky fixed inset-0 z-[60] isolate flex flex-col overflow-y-auto overscroll-contain bg-night text-white outline-none",
            "transition-[clip-path] duration-500 ease-pub [clip-path:inset(0)] data-[ending-style]:duration-300 data-[ending-style]:[clip-path:inset(0_0_100%_0)] data-[starting-style]:[clip-path:inset(0_0_100%_0)] motion-reduce:transition-none",
          )}
        >
          <Dialog.Title className="sr-only">Menu</Dialog.Title>

          <div className="mx-auto flex h-16 w-full max-w-[90rem] shrink-0 items-center justify-between gap-4 px-4 sm:px-8">
            <Link href="/" onClick={close} className={cn("flex items-center gap-2.5 rounded-sm", focus)}>
              <Image src="/brand/logo-192.png" alt="" width={40} height={40} className="size-9" />
              <span className="font-display text-lg font-semibold text-gold">{hotelName}</span>
            </Link>
            <Dialog.Close
              render={
                <button
                  type="button"
                  className={cn(
                    "inline-flex size-11 items-center justify-center rounded-full border border-white/20 text-white transition-colors duration-200 hover:border-white/50 motion-reduce:transition-none",
                    focus,
                  )}
                />
              }
            >
              <X className="size-5" strokeWidth={1.6} aria-hidden="true" />
              <span className="sr-only">Close menu</span>
            </Dialog.Close>
          </div>

          <div className="mx-auto grid w-full max-w-[90rem] flex-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <div className="flex min-w-0 flex-col px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2 sm:px-8 sm:pt-8">
              <nav aria-label="Menu">
                <ul className="border-t border-white/10">
                  {MENU_NAV.map((item, i) => {
                    const active = isNavActive(item, pathname);
                    return (
                      <li
                        key={item.href}
                        className="flex items-center justify-between gap-3 border-b border-white/10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:duration-500"
                        style={{ animationDelay: `${140 + i * 40}ms` }}
                      >
                        <Link
                          href={item.href}
                          onClick={close}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-11 min-w-0 flex-1 items-center py-1.5 font-display text-[1.375rem] leading-none text-white/90 transition-colors duration-200 hover:text-gold aria-[current=page]:text-gold sm:min-h-14 sm:text-[1.875rem] motion-reduce:transition-none",
                            focus,
                          )}
                        >
                          {item.label}
                        </Link>
                        {item.sub && (
                          <span className="flex shrink-0 items-center">
                            {item.sub.map((s) => (
                              <Link
                                key={s.href}
                                href={s.href}
                                onClick={close}
                                aria-current={pathname === s.href ? "page" : undefined}
                                className={cn(
                                  "inline-flex h-11 items-center px-2.5 text-[10.5px] font-medium uppercase tracking-[0.2em] text-white/55 transition-colors duration-200 hover:text-gold aria-[current=page]:text-gold motion-reduce:transition-none",
                                  focus,
                                )}
                              >
                                {s.label}
                              </Link>
                            ))}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <div
                className="mt-auto pt-6 motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-both motion-safe:duration-500"
                style={{ animationDelay: `${140 + MENU_NAV.length * 40}ms` }}
              >
                <LinkButton href="/book" onClick={close} full icon="arrow">
                  Book your stay
                </LinkButton>
                {contacts > 0 && (
                  <div className={cn("mt-3 grid gap-3", contacts > 1 && "grid-cols-2")}>
                    {phone && (
                      <a
                        href={telHref(phone)}
                        className={cn(
                          "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/15 text-[13px] text-white/85 transition-colors duration-200 hover:border-white/45 hover:text-white motion-reduce:transition-none",
                          focus,
                        )}
                      >
                        <Phone className="size-4" strokeWidth={1.6} aria-hidden="true" /> Call
                      </a>
                    )}
                    {whatsapp && (
                      <a
                        href={whatsappHref(whatsapp)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/15 text-[13px] text-white/85 transition-colors duration-200 hover:border-white/45 hover:text-white motion-reduce:transition-none",
                          focus,
                        )}
                      >
                        <MessageCircle className="size-4" strokeWidth={1.6} aria-hidden="true" /> WhatsApp
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    )}
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/10 pt-4">
                  <ThemeToggle withLabel />
                  <StaffLink
                    withIcon
                    onClick={close}
                    labels={{ signedIn: "Staff dashboard", signedOut: "Staff login" }}
                    className={cn("inline-flex h-11 items-center gap-2 rounded-full border border-gold/45 bg-gold/10 px-4 text-[13px] font-medium text-gold transition-colors hover:bg-gold/20", focus)}
                  />
                </div>
              </div>
            </div>

            {/* Tablets: a hotel photo beside the links (loads only when the menu opens). */}
            <div className="relative hidden min-h-[28rem] overflow-hidden sm:block">
              <Image src="/images/lobby/lobby-02.webp" alt="" fill sizes="45vw" className="object-cover object-[50%_40%]" />
              <div aria-hidden="true" className="absolute inset-0 bg-linear-to-r from-night via-night/30 to-night/10" />
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
