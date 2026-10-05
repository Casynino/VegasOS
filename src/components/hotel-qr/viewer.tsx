"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackClose, useSheetBehaviour } from "./ui";

/** A photo to look at full screen: the picture, what it shows (for screen readers) and a short word under it. */
export type ViewPhoto = { src: string; alt: string; label?: string | null };
type Open = (photos: ViewPhoto[], index?: number) => void;

const Ctx = createContext<Open>(() => {});
/** Open any set of photos full screen (tap a photo anywhere in the app). */
export const usePhotoViewer = () => useContext(Ctx);

/**
 * THE PHOTO VIEWER — any photo in the app, tapped, opens here full screen on black: swipe (or arrows and the keyboard)
 * through its set, the word under it, X / Escape / the phone's Back to close. One viewer for the whole app.
 */
export function PhotoViewerProvider({ children }: { children: React.ReactNode }) {
  const [set, setSet] = useState<{ photos: ViewPhoto[]; index: number; n: number } | null>(null);
  const history = useBackClose(useCallback(() => setSet(null), []));
  const open = useCallback<Open>((photos, index = 0) => {
    if (!photos.length) return;
    history.opened();
    setSet((s) => ({ photos, index: Math.max(0, Math.min(index, photos.length - 1)), n: (s?.n ?? 0) + 1 }));
  }, [history]);
  const close = useCallback(() => { history.closed(); setSet(null); }, [history]);
  return (
    <Ctx.Provider value={open}>
      {children}
      {set && <Viewer key={set.n} photos={set.photos} start={set.index} onClose={close} />}
    </Ctx.Provider>
  );
}

function Viewer({ photos, start, onClose }: { photos: ViewPhoto[]; start: number; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(start);
  useSheetBehaviour(true, onClose, box);

  // Opened on a photo: start there (no sliding through the ones before it).
  useEffect(() => {
    const el = track.current;
    if (el) el.scrollTo({ left: start * el.clientWidth, behavior: "instant" });
    box.current?.querySelector<HTMLButtonElement>("[data-close]")?.focus({ preventScroll: true });
  }, [start]);

  const onScroll = () => {
    const el = track.current;
    if (el) setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  };
  const go = (d: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: d * el.clientWidth, behavior: "smooth" });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  };

  const current = photos[Math.min(at, photos.length - 1)] ?? photos[0];
  const arrow = "absolute top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-md transition hover:bg-white/20 disabled:opacity-0 sm:grid";
  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label="Photos" onKeyDown={onKey}
      className="vr fixed inset-0 z-[70] flex flex-col bg-[#0d0a07] text-white motion-safe:animate-[vlh-fade_0.2s_ease-out_both]">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
        <p className="text-[12px] font-medium tabular-nums text-white/65" aria-live="polite">{at + 1} / {photos.length}</p>
        <button type="button" data-close onClick={onClose} aria-label="Close photos"
          className="grid size-10 place-items-center rounded-full bg-white/10 ring-1 ring-white/20 transition hover:bg-white/20"><X className="size-5" /></button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={track} onScroll={onScroll} className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {photos.map((p, k) => (
            <div key={`${p.src}-${k}`} className="relative h-full w-full shrink-0 snap-center snap-always">
              {/* Only the photo in view and its neighbours load. */}
              {Math.abs(k - at) <= 1 && <Image src={p.src} alt={p.alt} fill sizes="100vw" className="object-contain" />}
            </div>
          ))}
        </div>
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} disabled={at === 0} aria-label="Previous photo" className={cn(arrow, "left-4 lg:left-8")}><ChevronLeft className="size-5" /></button>
            <button type="button" onClick={() => go(1)} disabled={at >= photos.length - 1} aria-label="Next photo" className={cn(arrow, "right-4 lg:right-8")}><ChevronRight className="size-5" /></button>
          </>
        )}
      </div>
      <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-center sm:px-6">
        {current.label && <p className="font-display text-[20px] font-semibold leading-tight text-(--vr-gold)">{current.label}</p>}
        {(!current.label || !current.alt.startsWith(current.label)) && <p className="mx-auto mt-0.5 max-w-xl text-[12.5px] leading-snug text-white/60">{current.alt}</p>}
        {photos.length > 1 && photos.length <= 24 && (
          <div aria-hidden className="mx-auto mt-3 flex max-w-xs justify-center gap-1">
            {photos.map((p, k) => <span key={`${p.src}-${k}`} className={cn("h-[3px] flex-1 rounded-full transition-colors", k === at ? "bg-(--vr-gold)" : "bg-white/20")} />)}
          </div>
        )}
      </div>
    </div>
  );
}
