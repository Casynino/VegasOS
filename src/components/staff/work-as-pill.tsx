"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, X } from "lucide-react";
import { useFormStatus } from "react-dom";

const KEY = "vlh.workas.folded";

function StopButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" data-work-as-stop disabled={pending}
      className="inline-flex h-8 items-center rounded-full bg-white px-4 text-xs font-bold text-fuchsia-800 transition-colors hover:bg-fuchsia-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60">
      {label}
    </button>
  );
}

/**
 * "Working as {name}" for a Developer, copied from the owner's Target console (2026-11-08): a small pill with an eye, the name, Stop and a
 * ✕ that folds it down to a round eye button (one press unfolds it again) — so it never has to cover the page while the Developer reads.
 * Floats bottom right, above the phone's bottom bar; the page keeps room for it (see stripVars). The fold is remembered for this tab only.
 * The words are drawn on the server (translated, with the person's name as plain text) and handed in; Stop is the server action.
 */
export function WorkAsPill({ label, tip, stopLabel, closeLabel, stopWorkAs }: {
  label: string; tip: string; stopLabel: string; closeLabel: string; stopWorkAs: () => void | Promise<void>;
}) {
  const [folded, setFolded] = useState(false);
  const eye = useRef<HTMLButtonElement>(null);
  const fold = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    try {
      // Browser storage can only be read in the browser, after the first drawing (so it matches the server's). The fold belongs to ONE person:
      // working as somebody else later starts unfolded, so the Developer always sees who they are acting as.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFolded(sessionStorage.getItem(KEY) === label);
    } catch { /* a private window: it simply starts unfolded */ }
  }, [label]);
  // After a fold or an unfold the keyboard focus goes to the button that took its place (the pressed one is gone).
  useEffect(() => {
    if (!moved.current) return;
    (folded ? eye.current : fold.current)?.focus();
  }, [folded]);
  const setFold = (on: boolean) => {
    moved.current = true;
    setFolded(on);
    try { sessionStorage.setItem(KEY, on ? label : ""); } catch { /* the fold still works for this page view */ }
  };
  return (
    <div role="region" aria-label={label} data-identity="work-as" title={tip}
      className="fixed bottom-20 right-3 z-50 max-w-[calc(100vw-1.5rem)] lg:bottom-5 lg:right-5 print:hidden">
      {folded ? (
        <button ref={eye} type="button" onClick={() => setFold(false)} aria-label={label} aria-expanded={false}
          className="ml-auto grid size-11 place-items-center rounded-full bg-fuchsia-700 text-white shadow-lg shadow-black/30 transition-colors hover:bg-fuchsia-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <Eye className="size-[18px]" aria-hidden />
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-full bg-fuchsia-700 py-1 pl-3.5 pr-1 text-white shadow-lg shadow-black/30">
          <Eye className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate text-xs font-semibold">{label}</span>
          <form action={stopWorkAs} onSubmit={() => { try { sessionStorage.removeItem(KEY); } catch { /* nothing to forget */ } }} className="shrink-0"><StopButton label={stopLabel} /></form>
          <button ref={fold} type="button" onClick={() => setFold(true)} aria-label={closeLabel} aria-expanded
            className="grid size-8 shrink-0 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
