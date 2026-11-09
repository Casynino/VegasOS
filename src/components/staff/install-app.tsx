"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, Download, EllipsisVertical, Menu, Share, SquarePlus, TriangleAlert, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { detectDevice, type Device } from "@/lib/phone-browser";

/**
 * Use it as an app (owner, 2026-11-09: the screen must be full, like an app, on every phone — iPhone, Samsung, Pixel, Huawei — and the phone
 * itself must push people to install, as in Super Drive). A website in a browser tab always keeps the browser's own bars and no page can hide
 * them; the only full-screen version is the one put on the home screen. So a phone that has not done that gets a card: ONE TAP on Android
 * (Chrome's own Install button, shown when the browser offers it) and the shortest steps for the browser at hand anywhere else.
 * The card opens by itself after sign-in on every new visit until the app is installed, any time from "Get the full-screen app" on the sign-in
 * page, and from "Get the app" in the account menu. Nothing shows once the app is installed, or on a computer.
 * Copied from Super Drive (src/components/InstallApp.tsx), in the staff app's own dark look. Every word it shows is listed in install-words.ts.
 */

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Chrome on Android fires this once, early; kept here so any part of the page can use it later.
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((f) => f());
  });
}

/** Asked once per browser visit (a new tab or a new day asks again) — until the app is on the home screen. */
const ASKED = "vg.installAsked";
/** The account menu asks the card to open (it lives in the shell, outside the menu's own pop-up). */
const OPEN_EVENT = "vg:open-install";
export const openInstallSheet = () => window.dispatchEvent(new Event(OPEN_EVENT));

export function useInstall() {
  const [state, setState] = useState<{ ready: boolean; phone: boolean; installed: boolean; device: Device; canPrompt: boolean }>({
    ready: false, phone: false, installed: false, device: { os: "other", browser: "other", inApp: false }, canPrompt: false,
  });
  useEffect(() => {
    const check = () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      // a touch screen as its main input: a phone, and an iPad or Android tablet too (a laptop with a mouse is not)
      const phone = window.matchMedia("(pointer: coarse)").matches;
      setState({ ready: true, phone, installed: standalone, device: detectDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints), canPrompt: !!deferred });
    };
    check();
    listeners.add(check);
    return () => void listeners.delete(check);
  }, []);
  const install = useCallback(async () => {
    const ev = deferred;
    if (!ev) return false;
    deferred = null; // the browser allows ONE prompt per event: a quick second tap must not ask again
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      return outcome === "accepted";
    } catch {
      return false;
    } finally {
      listeners.forEach((f) => f());
    }
  }, []);
  return { ...state, install };
}

const bold = (c: ReactNode) => <b className="font-semibold text-white">{c}</b>;
type StepItem = { text: ReactNode; icon?: typeof Share };

function Step({ n, icon: Icon, children }: { n: number; icon?: typeof Share; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5 text-[14px] leading-snug text-white/65">
      <span className="w-3 shrink-0 text-center text-[13px] font-semibold tabular-nums text-gold">{n}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {Icon ? <Icon className="size-4 shrink-0 text-white/40" aria-hidden="true" /> : null}
    </li>
  );
}

const solid = "inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-gold text-[13.5px] font-semibold text-gold-foreground transition-[filter] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { device, canPrompt, install } = useInstall();
  const panel = useRef<HTMLDivElement>(null);
  const browserName = device.os === "ios" ? "Safari" : "Chrome";

  /** The three steps for this phone and browser: every browser words them a little differently, so each gets its own. */
  const steps = (): StepItem[] => {
    const open: StepItem = { text: t.rich("Open <b>Vegas Hotel</b> from your home screen.", { b: bold }) };
    if (device.os === "ios") {
      return [
        {
          icon: Share,
          text: device.browser === "safari" || device.inApp
            ? t.rich("Tap <b>Share</b> (bottom, or <b>···</b>).", { b: bold })
            : t.rich("Tap <b>Share</b> (address bar or menu).", { b: bold }),
        },
        { icon: SquarePlus, text: t.rich("Tap <b>Add to Home Screen</b>.", { b: bold }) },
        { text: t.rich("Tap <b>Add</b>, then open <b>Vegas Hotel</b>.", { b: bold }) },
      ];
    }
    switch (device.browser) {
      case "samsung":
        return [
          { icon: Menu, text: t("Tap the menu at the bottom right.") },
          { text: t.rich("Tap <b>Add page to</b>, then <b>Home screen</b>.", { b: bold }) },
          open,
        ];
      case "huawei":
        return [
          { icon: Menu, text: t("Open the browser menu (at the bottom or top right).") },
          { text: t.rich("Tap <b>Add to home screen</b> (or <b>Add to desktop</b>), then confirm.", { b: bold }) },
          open,
        ];
      case "firefox":
        return [
          { icon: EllipsisVertical, text: t("Open the browser menu at the top right.") },
          { text: t.rich("Tap <b>Install</b>, then <b>Add</b>.", { b: bold }) },
          open,
        ];
      default:
        return [
          { icon: EllipsisVertical, text: t("Open the browser menu (the three dots, top right or bottom).") },
          { text: t.rich("Tap <b>Install app</b> or <b>Add to Home screen</b>.", { b: bold }) },
          open,
        ];
    }
  };

  useEffect(() => {
    if (!open) return;
    const el = panel.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !el) return;
      // Tab stays inside the sheet (aria-modal: the page behind is not reachable)
      const items = [...el.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    const before = document.body.style.overflow;
    const lock = before !== "hidden"; // another pop-up may already hold the page still: then leave it as it is
    if (lock) document.body.style.overflow = "hidden";
    const back = document.activeElement as HTMLElement | null;
    el?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      if (lock) document.body.style.overflow = before;
      back?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;
  // Safari on an iPhone has no one-tap install: while the card is open, a small arrow bounces over the toolbar where Share is (not on an iPad,
  // where Share is at the top).
  const pointAtShare = device.os === "ios" && device.browser === "safari" && !device.inApp && !canPrompt && typeof window !== "undefined" && window.innerWidth < 768;
  // (drawn on <body>, so it is a card wherever it was opened from — the sign-in page, the shell, or the side menu's drawer)
  return createPortal(
    <div
      className={`fixed inset-0 z-[110] flex items-end justify-center overflow-y-auto overscroll-contain bg-black/15 px-5 pt-[max(1rem,env(safe-area-inset-top))] text-white ${pointAtShare ? "pb-[calc(max(0.5rem,env(safe-area-inset-bottom))+5.75rem)]" : "pb-[max(1.75rem,calc(env(safe-area-inset-bottom)+1rem))]"}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Small and clean (owner, 2026-11-09, as on ZELab): frosted glass that belongs to the page — it sits low, the dim behind it is barely there, the card is see-through and blurs the scene under it. Only a title and the steps. */}
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vg-install-title"
        className="relative w-full max-w-[17.5rem] rounded-2xl border border-white/[0.09] bg-[#15110a]/55 px-4 pb-1.5 pt-3 text-left shadow-[0_18px_44px_-22px_rgba(0,0,0,0.75)] outline-none backdrop-blur-2xl backdrop-saturate-150"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="vg-install-title" className="text-[14px] font-medium tracking-tight">{t("Use it like an app")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="-mr-2.5 grid size-10 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-gold">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {device.inApp && (
          <div className="mb-1 mt-0.5 flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/10 px-2.5 py-2 text-[12.5px] leading-snug text-white/90">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-gold" aria-hidden="true" />
            <span>
              {t.rich("{app} cannot add this to the home screen. Tap <b>···</b> (or the three dots) at the top, then <b>Open in {browser}</b>.", { b: bold }, { app: device.appName && device.appName !== "this app" ? device.appName : t("This app"), browser: browserName })}
            </span>
          </div>
        )}

        {canPrompt && !device.inApp ? (
          <div className="flex flex-col items-stretch gap-0.5 pb-1 pt-1.5">
            <button type="button" className={solid} onClick={async () => { await install(); onClose(); }}>
              <Download className="size-4" aria-hidden="true" />{t("Install the app")}
            </button>
            <button type="button" className="inline-flex h-10 items-center justify-center text-[13px] text-white/60 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-gold" onClick={onClose}>{t("Maybe later")}</button>
          </div>
        ) : (
          <ol className="divide-y divide-white/[0.06]">
            {steps().map((st, i) => <Step key={i} n={i + 1} icon={st.icon}>{st.text}</Step>)}
          </ol>
        )}
      </div>

      {pointAtShare && (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-[calc(max(0.5rem,env(safe-area-inset-bottom))+2.4rem)] z-[111] flex justify-center">
          <span className="flex animate-bounce flex-col items-center gap-0.5 text-[10px] font-medium text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] motion-reduce:animate-none">
            {t("Share")}
            <ArrowDown className="size-4 text-gold" />
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * Opens by itself a moment after a phone's browser opens the app — on every new visit until the app is installed (never when it is
 * installed, never on a computer). "Maybe later" or closing it only rests it for this visit. It also opens when the account menu asks.
 */
export function InstallPrompt() {
  const { ready, phone, installed } = useInstall();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready || !phone || installed) return;
    try {
      if (window.sessionStorage.getItem(ASKED)) return;
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      const a = document.activeElement as HTMLElement | null;
      const typing = !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
      // not over a field someone is typing in, nor over another pop-up: it is asked again a little later in this visit
      if (typing || document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')) return;
      setOpen(true);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [ready, phone, installed]);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    try {
      window.sessionStorage.setItem(ASKED, "1");
    } catch {
      /* a private window: it simply asks again next time */
    }
  }, []);
  return <InstallSheet open={open} onClose={close} />;
}

/** A button that opens the card. Draws nothing on a computer or once the app is installed. `render` lets the caller style it. */
export function InstallButton({ render }: { render: (open: () => void) => ReactNode }) {
  const { ready, phone, installed } = useInstall();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!ready || !phone || installed) return null;
  return (
    <>
      {render(() => setOpen(true))}
      <InstallSheet open={open} onClose={close} />
    </>
  );
}
