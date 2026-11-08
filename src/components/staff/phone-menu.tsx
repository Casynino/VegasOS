"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";

/**
 * The phone's menu drawer has two doors: the round menu button at the left of the top bar (as in the owner's Target console, 2026-11-08) and
 * the "Menu" tab of the bottom bar. They share one open/closed state; the drawer itself is drawn once, in the bottom bar.
 */
const Ctx = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

export function PhoneMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

export function usePhoneMenu() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePhoneMenu needs PhoneMenuProvider (the staff shell draws it)");
  return ctx;
}

/** The menu button of the top bar (phone and tablet only; 44px — the control a thumb presses first). */
export function PhoneMenuButton({ label }: { label: string }) {
  const { setOpen } = usePhoneMenu();
  return (
    <button type="button" aria-label={label} onClick={() => setOpen(true)}
      className="-ml-1 grid size-11 shrink-0 place-items-center rounded-full text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.12_80)]/60 lg:hidden">
      <Menu className="size-5" aria-hidden />
    </button>
  );
}
