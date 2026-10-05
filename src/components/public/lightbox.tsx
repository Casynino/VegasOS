"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useBackToClose } from "./use-back-to-close";

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
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!start || !t || images.length < 2) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) move(dx < 0 ? 1 : -1);
  }

  const current = index === null ? null : images[index];

  const element = (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      aria-label="Photo viewer"
      className="m-0 h-dvh max-h-none w-full max-w-none overscroll-contain bg-transparent p-0 text-white backdrop:bg-[#0b0906]/95 backdrop:backdrop-blur-sm"
    >
      {current && (
        <div className="flex h-full w-full flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/70 tabular-nums" aria-live="polite">
              {index! + 1} <span className="text-white/40">/ {images.length}</span>
            </p>
            <button type="button" onClick={close} autoFocus className={control}>
              <X className="size-5" strokeWidth={1.6} aria-hidden="true" />
              <span className="sr-only">Close photo viewer</span>
            </button>
          </div>
          <div
            className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2 pb-2 sm:px-20"
            onClick={(e) => { if (e.target === e.currentTarget) close(); }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div className="relative h-full w-full">
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
                  <span className="sr-only">Previous photo</span>
                </button>
                <button type="button" onClick={() => move(1)} className={`${control} absolute right-3 top-1/2 hidden -translate-y-1/2 sm:inline-flex sm:right-6`}>
                  <ChevronRight className="size-5" strokeWidth={1.6} aria-hidden="true" />
                  <span className="sr-only">Next photo</span>
                </button>
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 px-4 pb-4 pt-2 sm:justify-center sm:px-6 sm:pb-6">
            {images.length > 1 && (
              <button type="button" onClick={() => move(-1)} className={`${control} shrink-0 sm:hidden`}>
                <ChevronLeft className="size-5" strokeWidth={1.6} aria-hidden="true" />
                <span className="sr-only">Previous photo</span>
              </button>
            )}
            <p className="min-w-0 text-center text-[13px] leading-snug text-white/70">{current.alt}</p>
            {images.length > 1 && (
              <button type="button" onClick={() => move(1)} className={`${control} shrink-0 sm:hidden`}>
                <ChevronRight className="size-5" strokeWidth={1.6} aria-hidden="true" />
                <span className="sr-only">Next photo</span>
              </button>
            )}
          </div>
        </div>
      )}
    </dialog>
  );

  return { open, element };
}
