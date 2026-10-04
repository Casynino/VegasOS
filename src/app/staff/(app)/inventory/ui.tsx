"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small shared pieces for the inventory and asset screens. */

export const field = "h-10 w-full min-w-0 rounded-xl border border-border/80 bg-background/60 px-3 text-sm outline-none transition focus:border-[oklch(0.78_0.12_80)] focus:ring-4 focus:ring-[oklch(0.78_0.12_80/0.15)] disabled:opacity-60";

export function Label({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0 text-xs text-muted-foreground", className)}>
      <span className="mb-1 flex items-baseline justify-between gap-2"><span className="font-medium text-foreground/80">{label}</span>{hint && <span className="truncate text-[10px]">{hint}</span>}</span>
      {children}
    </label>
  );
}

export function Chip({ on, onClick, children, tone = "gold", className }: { on: boolean; onClick: () => void; children: React.ReactNode; tone?: "gold" | "rose" | "dark"; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors",
        on ? (tone === "rose" ? "border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-300" : tone === "dark" ? "border-foreground bg-foreground text-background" : "border-[oklch(0.75_0.12_80)] bg-[oklch(0.75_0.12_80/0.18)] text-foreground")
          : "border-border/70 bg-card hover:bg-muted", className)}>
      {children}
    </button>
  );
}

export function GoldButton({ pending, disabled, onClick, children, className, type = "button" }: { pending?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode; className?: string; type?: "button" | "submit" }) {
  return (
    <button type={type} disabled={disabled || pending} onClick={onClick}
      className={cn("inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-4 text-sm font-semibold text-[oklch(0.2_0.03_60)] shadow-sm transition hover:brightness-105 disabled:opacity-50", className)}>
      {pending && <Loader2 className="size-4 animate-spin" />}{children}
    </button>
  );
}

/** Run a server action; toast the result, refresh the page on success. */
export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = <T,>(fn: () => Promise<{ ok: true; data: T; message?: string } | { ok: false; error: string }>, ok?: (data: T) => string | void, after?: (data: T) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error); return; }
      const msg = ok?.(r.data) ?? r.message;
      if (msg) toast.success(msg);
      after?.(r.data);
      router.refresh();
    });
  return { pending, run };
}

export const tzs = (v: number) => `TZS ${Math.round(v).toLocaleString("en-US")}`;
export const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
