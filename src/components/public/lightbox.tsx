"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useBackToClose } from "./use-back-to-close";
import { useT } from "@/i18n/client";

export interface LightboxImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

const control =
  "inline-flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white/85 backdrop-blur-md transition-colors duration-200 hover:border-gold/70 hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none";

/**
 * Accessible photo viewer on the native <dialog> element: modal focus handling, Escape (or the
 * phone's Back) to close, arrow keys / buttons / a sideways swipe to move, focus returns to the
 * opener and the page does not scroll behind it.
 */
export function useLightbox(images: LightboxImage[]) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const close = useCallback(() => dialogRef.current?.close(), []);
  const { opened, closed } = useBackToClose(close);

  const open = useCallback((i: number) => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setIndex(i);
    opened();
  }, [opened]);
  const move = useCallback(
    (delta: number) => setIndex((i) => (i === null ? i : (i + delta + images.length) % images.length)),
    [images.length],
  );

  useEffect(() => {
    const d = dialogRef.current;
    if (index !== null && d && !d.open) d.showModal();
  }, [index]);

  // No page scroll behind the viewer.
  const isOpen = index !== null;
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [isOpen]);

  function onClose() {
    setIndex(null);
    closed();
    openerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
  }

  function onTouchStart(e: React.TouchEvent) {
    const pt = e.touches[0];
    touch.current = pt ? { x: pt.clientX, y: pt.clientY } : null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    const pt = e.changedTouches[0];
    touch.current = null;
    if (!start || !pt || images.length < 2) return;
    const dx = pt.clientX - start.x;
    const dy = pt.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) move(dx < 0 ? 1 : -1);
  }

  const current = index === null ? null : images[index];

  const element = (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      aria-label={t("Photo viewer")}
      className="m-0 h-dvh max-h-none w-full max-w-none overscroll-contain bg-transparent p-0 text-white backdrop:bg-[#0b0906]/95 backdrop:backdrop-blur-sm"
    >
      {current && (
        <div className="flex h-full w-full flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="flex items-center justify-between gap-4 px-4 py-3 sm:gap-8 sm:px-6">
            <p className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-white/80 tabular-nums" aria-live="polite">
              <span aria-hidden="true" className="h-px w-4 bg-gold" />
              <span>
                {String(index! + 1).padStart(2, "0")} <span className="text-white/45">/ {String(images.length).padStart(2, "0")}</span>
              </span>
            </p>
            {/* Where you are in the set: one hairline segment per photo (a single line for long sets). */}
            {images.length > 1 && (
              <span aria-hidden="true" className="hidden h-px min-w-0 max-w-xl flex-1 gap-1 sm:flex">
                {images.length <= 24 ? (
                  images.map((img, i) => (
                    <span key={img.src} className={`h-px flex-1 transition-colors duration-300 motion-reduce:transition-none ${i === index ? "bg-gold" : i < index! ? "bg-white/40" : "bg-white/15"}`} />
                  ))
                ) : (
                  <span className="relative h-px flex-1 bg-white/15">
                    <span className="absolute inset-y-0 left-0 bg-gold" style={{ width: `${((index! + 1) / images.length) * 100}%` }} />
                  </span>
                )}
              </span>
            )}
            <button type="button" onClick={close} autoFocus className={control}>
              <X className="size-5" strokeWidth={1.6} aria-hidden="true" />
              <span className="sr-only">{t("Close photo viewer")}</span>
            </button>
          </div>
          <div
            className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2 pb-2 sm:px-20"
            onClick={(e) => { if (e.target === e.currentTarget) close(); }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div className="relative h-full w-full">
              <span
                aria-hidden="true"
                className="pub-hud-corners hidden sm:block"
                style={{ "--hud-o": "0.5rem", "--hud-l": "1.25rem", "--hud-c": "rgb(240 214 160 / 0.5)" } as React.CSSProperties}
              />
              <Image
                key={current.src}
                src={current.src}
                alt={current.alt}
                fill
                sizes="100vw"
                className="object-contain motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-[0.98] motion-safe:duration-300"
              />
            </div>
            {images.length > 1 && (
              <>
                <button type="button" onClick={() => move(-1)} className={`${control} absolute left-3 top-1/2 hidden -translate-y-1/2 sm:inline-flex sm:left-6`}>
                  <ChevronLeft className="size-5" strokeWidth={1.6} aria-hidden="true" />
                  <span className="sr-only">{t("Previous photo")}</span>
                </button>
                <button type="button" onClick={() => move(1)} className={`${control} absolute right-3 top-1/2 hidden -translate-y-1/2 sm:inline-flex sm:right-6`}>
                  <ChevronRight className="size-5" strokeWidth={1.6} aria-hidden="true" />
                  <span className="sr-only">{t("Next photo")}</span>
                </button>
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 px-4 pb-4 pt-2 sm:justify-center sm:px-6 sm:pb-6">
            {images.length > 1 && (
              <button type="button" onClick={() => move(-1)} className={`${control} shrink-0 sm:hidden`}>
                <ChevronLeft className="size-5" strokeWidth={1.6} aria-hidden="true" />
                <span className="sr-only">{t("Previous photo")}</span>
              </button>
            )}
            <p className="min-w-0 text-center text-[13px] leading-snug text-white/70">{current.alt}</p>
            {images.length > 1 && (
              <button type="button" onClick={() => move(1)} className={`${control} shrink-0 sm:hidden`}>
                <ChevronRight className="size-5" strokeWidth={1.6} aria-hidden="true" />
                <span className="sr-only">{t("Next photo")}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </dialog>
  );

  return { open, element };
}
