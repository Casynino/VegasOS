"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, EllipsisVertical, Menu, Share, Smartphone, SquarePlus, X } from "lucide-react";
import { useT } from "@/i18n/client";

/**
 * Use it as an app (owner, 2026-11-09: the screen should be full, like an app, on every phone — iPhone, Samsung, Pixel, Huawei). A website in
 * a browser tab always keeps the browser's own bars and no page can hide them; the only full-screen version is the one put on the home screen.
 * So a phone that has not done that gets a small sheet saying how — one tap on Android Chrome, a few steps anywhere else. It opens by itself
 * once after sign-in and any time from the sign-in page ("Get the full-screen app"). Nothing shows once the app is installed, or on a computer.
 * Copied from Target Express, in the staff app's own dark look (it works on the sign-in page too, which is not inside the staff shell).
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

const SEEN = "vg.installSeen";

/**
 * Which phone browser this is, because the way to the home screen differs: Safari's Share sheet, Chrome's ⋮ menu, Samsung Internet's and
 * Huawei's ☰ menu at the bottom, and WeChat / WhatsApp, whose own browser cannot add anything to the home screen at all.
 */
type Browser = "safari" | "ios-other" | "chrome" | "samsung" | "huawei" | "android-other" | "in-app";

function browserOf(ua: string, ios: boolean): Browser {
  if (/MicroMessenger|WhatsApp|FBAN|FBAV|Instagram|Line\//i.test(ua)) return "in-app";
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua) ? "ios-other" : "safari";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/HuaweiBrowser|HBPC|HarmonyOS|OpenHarmony|ArkWeb/i.test(ua)) return "huawei";
  if (/Chrome\//i.test(ua) && !/EdgA|OPR|Firefox|YaBrowser|UCBrowser|MiuiBrowser|HeyTapBrowser/i.test(ua)) return "chrome";
  return "android-other";
}

function useInstall() {
  const [state, setState] = useState({ ready: false, phone: false, installed: false, ios: false, browser: "chrome" as Browser, canPrompt: false });
  useEffect(() => {
    const check = () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      // a touch screen as its main input: a phone, and an iPad or Android tablet too (a laptop with a mouse is not)
      const phone = window.matchMedia("(pointer: coarse)").matches;
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      setState({ ready: true, phone, installed: standalone, ios, browser: browserOf(navigator.userAgent, ios), canPrompt: !!deferred });
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

function Step({ n, icon: Icon, children }: { n: number; icon?: typeof Share; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-2.5 text-[13px] leading-snug text-white/85">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-gold text-[11px] font-semibold text-gold-foreground">{n}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {Icon ? <Icon className="size-4 shrink-0 text-white/45" aria-hidden="true" /> : null}
    </li>
  );
}

const quiet = "inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-white/15 text-[14px] font-medium text-white/85 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";
const solid = "inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-gold text-[14px] font-semibold text-gold-foreground transition-[filter] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { ios, browser, canPrompt, install } = useInstall();
  const panel = useRef<HTMLDivElement>(null);

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
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto overscroll-contain bg-[#050403]/75 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] text-white"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vg-install-title"
        className="relative my-auto w-full max-w-sm rounded-2xl border border-white/10 bg-[#15120e] p-5 text-left shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] outline-none"
      >
        <button type="button" onClick={onClose} aria-label={t("Close")} className="absolute right-2 top-2 grid size-11 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-gold">
          <X className="size-4" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-3 pr-8">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold"><Smartphone className="size-5" aria-hidden="true" /></span>
          <div>
            <h2 id="vg-install-title" className="text-base font-semibold">{t("Use it like an app")}</h2>
            <p className="text-[13px] text-white/60">{t("Full screen, no browser bar, its own icon.")}</p>
          </div>
        </div>

        {canPrompt ? (
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" className={solid} onClick={async () => { await install(); onClose(); }}>
              <Download className="size-4" aria-hidden="true" />{t("Install the app")}
            </button>
            <button type="button" className={quiet} onClick={onClose}>{t("Maybe later")}</button>
          </div>
        ) : (
          <>
            <ol className="mt-4 space-y-2">
              {browser === "in-app" ? (
                <>
                  <Step n={1} icon={EllipsisVertical}>{t("Tap ··· at the top right, then Open in browser.")}</Step>
                  <Step n={2}>{ios ? t("In Safari, sign in and tap Get the full-screen app again.") : t("In the browser, sign in and tap Get the full-screen app again.")}</Step>
                </>
              ) : ios ? (
                <>
                  <Step n={1} icon={Share}>{browser === "safari" ? t("Tap Share in Safari's toolbar, or in the ⋯ menu.") : t("Tap Share in the address bar or the menu.")}</Step>
                  <Step n={2} icon={SquarePlus}>{t("Scroll down and tap Add to Home Screen.")}</Step>
                  <Step n={3}>{t("Tap Add, then open Vegas Hotel from your home screen.")}</Step>
                </>
              ) : browser === "samsung" ? (
                <>
                  <Step n={1} icon={Menu}>{t("Tap the menu at the bottom right.")}</Step>
                  <Step n={2}>{t("Tap Add page to, then Home screen.")}</Step>
                  <Step n={3}>{t("Open Vegas Hotel from your home screen.")}</Step>
                </>
              ) : browser === "huawei" ? (
                <>
                  <Step n={1} icon={Menu}>{t("Tap the menu at the bottom of the browser.")}</Step>
                  <Step n={2}>{t("Tap Add to home screen (it may be under Add to).")}</Step>
                  <Step n={3}>{t("Open Vegas Hotel from your home screen.")}</Step>
                </>
              ) : (
                <>
                  <Step n={1} icon={browser === "chrome" ? EllipsisVertical : Menu}>{browser === "chrome" ? t("Open the browser menu at the top right.") : t("Open the browser menu.")}</Step>
                  <Step n={2}>{t("Tap Install app or Add to Home screen.")}</Step>
                  <Step n={3}>{t("Open Vegas Hotel from your home screen.")}</Step>
                </>
              )}
            </ol>
            {browser !== "in-app" ? (
              <p className="mt-3 text-[12px] text-white/50">
                {ios ? t("If this page opened inside WeChat or WhatsApp, open it in Safari first.") : t("If this page opened inside WeChat or WhatsApp, open it in Chrome first.")}
              </p>
            ) : null}
            <button type="button" className={`${quiet} mt-4`} onClick={onClose}>{t("Got it")}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** Opens by itself once, a moment after a phone's browser opens the app (never when it is installed, never on a computer); closing it is remembered. */
export function InstallPrompt() {
  const { ready, phone, installed } = useInstall();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready || !phone || installed) return;
    try {
      if (window.localStorage.getItem(SEEN)) return;
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      const a = document.activeElement as HTMLElement | null;
      const typing = !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
      // not over a field someone is typing in, nor over another pop-up: it is asked again on the next visit (nothing is remembered yet)
      if (typing || document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')) return;
      setOpen(true);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [ready, phone, installed]);
  const close = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN, "1");
    } catch {
      /* a private window: it simply asks again next time */
    }
  }, []);
  return <InstallSheet open={open} onClose={close} />;
}

/** A button that opens the sheet. Draws nothing on a computer or once the app is installed. */
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
