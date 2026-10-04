"use client";

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { BedDouble, Crown, Loader2, Search, Armchair, X } from "lucide-react";
import { prettyPhone } from "@/lib/guest-messages";
import { cn } from "@/lib/utils";
import type { CustomerHit } from "@/server/services/guests";
import { findCustomersAction } from "./customer-actions";

/** Two letters of a name or three digits of a number — the same rule as the server. */
const searchable = (q: string) => q.replace(/[\d\s+().-]/g, "").length >= 2 || q.replace(/\D/g, "").replace(/^(?:00)?255|^0/, "").length >= 3;

/** Who may search customers (guests.view) — set once in the staff shell; the finder hides for everyone else. */
const Access = createContext(false);
export function CustomerFinderAccess({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return <Access.Provider value={allowed}>{children}</Access.Provider>;
}

/**
 * Find a customer we already have — by part of the name or the phone number — and tap them:
 * their phone and name are filled in. A new customer is still typed in the fields below.
 */
export function CustomerFinder({ onPick, className, placeholder = "Find a customer — name or phone", inline }: {
  /** `id` is that very customer (send it on, so the right person is used even when a number is shared); `phone` is "" when none is saved — keep what was typed. */
  onPick: (c: { id: string; name: string; phone: string }) => void;
  className?: string;
  placeholder?: string;
  /** In a short dialog: the results push the fields down instead of floating over them (nothing is cut off). */
  inline?: boolean;
}) {
  const allowed = useContext(Access);
  const listId = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [res, setRes] = useState<{ q: string; hits: CustomerHit[]; failed?: boolean } | null>(null);
  const can = searchable(q.trim());

  useEffect(() => {
    if (!can || !allowed) return;
    let stop = false;
    const term = q;
    const t = setTimeout(async () => {
      const r = await findCustomersAction(term).catch(() => null);
      if (stop) return;
      setRes({ q: term, hits: r?.ok ? r.data : [], failed: !r?.ok });
      setActive(0);
    }, 250);
    return () => { stop = true; clearTimeout(t); };
  }, [q, can, allowed]);

  const ready = can && res?.q === q;
  const hits = ready ? res.hits : [];
  const show = open && can;
  const pick = (c: CustomerHit) => {
    onPick({ id: c.id, name: c.name, phone: c.phone ? prettyPhone(c.phone) : "" });
    setQ(""); setOpen(false);
  };

  if (!allowed) return null;
  return (
    <div className={cn("relative", className)}>
      <label className="relative block">
        <span className="sr-only">Find a customer</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q} placeholder={placeholder} autoComplete="off" maxLength={60} type="search" enterKeyHint="search"
          role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={show && hits[active] ? `${listId}-${hits[active].id}` : undefined}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { if (q) { e.preventDefault(); e.stopPropagation(); setQ(""); } return; }
            if (!show || !hits.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
            else if (e.key === "Enter") { e.preventDefault(); pick(hits[Math.min(active, hits.length - 1)]); }
          }}
          className="h-11 w-full rounded-xl border border-border/80 bg-background pl-10 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus:border-[oklch(0.75_0.12_80)] focus:ring-2 focus:ring-[oklch(0.75_0.12_80/0.25)] [&::-webkit-search-cancel-button]:hidden"
        />
        {q && (
          <button type="button" aria-label="Clear the search" onMouseDown={(e) => e.preventDefault()} onClick={() => setQ("")}
            className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
      </label>

      {show && (
        // Keep the field focused while a name is tapped (the list closes on blur).
        <div onMouseDown={(e) => e.preventDefault()}
          className={cn("mt-1.5 overflow-hidden rounded-2xl", inline ? "relative" : "absolute inset-x-0 top-full z-40", "border border-border/80 bg-popover text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,0.55)]")}>
          {!ready ? (
            <p className="flex items-center gap-2 px-3.5 py-3 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Searching…</p>
          ) : res.failed ? (
            <p className="px-3.5 py-3 text-xs text-muted-foreground">The search did not work — type the phone and name below.</p>
          ) : !hits.length ? (
            <p className="px-3.5 py-3 text-xs text-muted-foreground">No customer found — a new one is saved with the phone below.</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Customers" className="max-h-72 overflow-y-auto p-1">
              {hits.map((c, i) => (
                <li key={c.id} id={`${listId}-${c.id}`} role="option" aria-selected={i === active}
                  onClick={() => pick(c)} onMouseEnter={() => setActive(i)}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2", i === active && "bg-muted")}>
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
                    c.vip ? "bg-[oklch(0.75_0.13_80)]/20 text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]" : "bg-muted text-muted-foreground")}>
                    {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <span className="truncate">{c.name}</span>
                      {c.vip && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[oklch(0.75_0.13_80)]/20 px-1.5 text-[9px] font-bold text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]"><Crown className="size-2.5" />VIP</span>}
                    </span>
                    <span className="block truncate text-[11px] tabular-nums text-muted-foreground">{c.phone ? prettyPhone(c.phone) : "No phone saved"}</span>
                  </span>
                  {(c.room || c.table) && (
                    <span className="flex shrink-0 flex-col items-end gap-0.5 text-[10.5px] font-medium">
                      {c.room && <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-1.5 py-0.5 text-violet-600 dark:text-violet-300"><BedDouble className="size-3" />Room {c.room}</span>}
                      {c.table && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300"><Armchair className="size-3" />{c.table}</span>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
