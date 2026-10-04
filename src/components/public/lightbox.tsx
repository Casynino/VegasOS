"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface LightboxImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * Accessible lightbox on the native <dialog> element: modal focus handling,
 * Escape to close, arrow keys / buttons to move, focus returns to the opener.
 */
export function useLightbox(images: LightboxImage[]) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);

  const open = useCallback((i: number) => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setIndex(i);
  }, []);
  const close = useCallback(() => dialogRef.current?.close(), []);
  const move = useCallback(
    (delta: number) => setIndex((i) => (i === null ? i : (i + delta + images.length) % images.length)),
    [images.length],
  );

  useEffect(() => {
    const d = dialogRef.current;
    if (index !== null && d && !d.open) d.showModal();
  }, [index]);

  function onClose() {
    setIndex(null);
    openerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
  }

  const current = index === null ? null : images[index];

  const element = (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      aria-label="Photo viewer"
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 text-white backdrop:bg-[#0d0b08]/95 backdrop:backdrop-blur-sm"
    >
      {current && (
        <div className="flex h-full w-full flex-col" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="flex items-center justify-between px-4 py-3 sm:px-6">
            <p className="text-sm text-white/70" aria-live="polite">
              {index! + 1} / {images.length}
            </p>
            <button
              type="button"
              onClick={close}
              autoFocus
              className="inline-flex size-11 items-center justify-center rounded-full border border-white/20 text-white/80 transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <X className="size-6" aria-hidden="true" />
              <span className="sr-only">Close photo viewer</span>
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-20" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
            <div className="relative h-full w-full">
              <Image key={current.src} src={current.src} alt={current.alt} fill sizes="100vw" className="object-contain motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500" />
            </div>
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => move(-1)}
                  className="absolute left-2 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-md transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:left-5"
                >
                  <ChevronLeft className="size-7" aria-hidden="true" />
                  <span className="sr-only">Previous photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => move(1)}
                  className="absolute right-2 top-1/2 inline-flex size-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-md transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:right-5"
                >
                  <ChevronRight className="size-7" aria-hidden="true" />
                  <span className="sr-only">Next photo</span>
                </button>
              </>
            )}
          </div>
          <p className="px-4 pb-5 text-center text-sm text-white/70">{current.alt}</p>
        </div>
      )}
    </dialog>
  );

  return { open, element };
}
