import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";

/**
 * The small pieces every part of the Developer console shares: the banner, a stat block, a tag, the colours of the roles, and
 * the plain words for "how long ago" and "how big". All server components — no client code, nothing to download.
 */

// ───────────────────────────────────────────── words and numbers ─────────────────────────────────────────────
export function agoText(t: T, at: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{n} h ago", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 60) return t.plural(days, "{n} day ago", "{n} days ago");
  return t.plural(Math.floor(days / 30), "{n} month ago", "{n} months ago");
}

export const num = (t: T, n: number | null | undefined): string => (n === null || n === undefined ? "—" : n.toLocaleString(t.intl));

export function bytesText(t: T, bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString(t.intl, { maximumFractionDigits: i === 0 || v >= 100 ? 0 : 1 })} ${units[i]}`;
}

/** A business date as "17 Oct" (a UTC date, so a day never shifts). */
export const dayLabel = (t: T, date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString(t.intl, { day: "numeric", month: "short", timeZone: "UTC" });

// ───────────────────────────────────────────── colours ─────────────────────────────────────────────
/**
 * Series colours: clearly different from one another, and readable on both the light and the dark card (mid tones, never white or
 * black). A role keeps the same colour on every chart; a role nobody planned for takes the next free one.
 */
export const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#8466e0", "#1aa3b8", "#8aa02a", "#7d8aa0"] as const;
const ROLE_COLOUR: Record<string, string> = {
  OWNER: "#d55181", ADMIN: "#8466e0", MANAGER: "#3987e5", FINANCE: "#199e70", ACCOUNTANT: "#8aa02a", RECEPTIONIST: "#c98500",
  RESTAURANT: "#d95926", RESTAURANT_SCREEN: "#1aa3b8", KITCHEN: "#b5651d", DRIVER: "#7d8aa0", DEVELOPER: "#9a8f7a",
};
export function roleColours(codes: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>(codes.map((c) => ROLE_COLOUR[c]).filter(Boolean));
  const spare = PALETTE.filter((c) => !used.has(c));
  let next = 0;
  for (const code of codes) out[code] = ROLE_COLOUR[code] ?? spare[next++ % Math.max(1, spare.length)] ?? PALETTE[next % PALETTE.length];
  return out;
}

// ───────────────────────────────────────────── tags ─────────────────────────────────────────────
export type TagTone = "rose" | "amber" | "sky" | "emerald" | "slate" | "gold";
const TAG: Record<TagTone, string> = {
  rose: "bg-rose-500/12 text-rose-700 ring-rose-500/30 dark:text-rose-300",
  amber: "bg-amber-500/14 text-amber-800 ring-amber-500/35 dark:text-amber-300",
  sky: "bg-sky-500/12 text-sky-700 ring-sky-500/30 dark:text-sky-300",
  emerald: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
  slate: "bg-muted text-muted-foreground ring-border",
  gold: "bg-[oklch(0.72_0.12_80/0.16)] text-[oklch(0.45_0.1_75)] ring-[oklch(0.72_0.12_80/0.4)] dark:text-[oklch(0.84_0.11_82)]",
};
export function Tag({ tone = "slate", children, className }: { tone?: TagTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset", TAG[tone], className)}>{children}</span>;
}

// ───────────────────────────────────────────── banner ─────────────────────────────────────────────
/** The greeting at the top: the hotel's night colours with a faint grid, the date, the Developer tag, the greeting and one line. */
export function ConsoleBanner({ date, tag, title, subtitle }: { date: string; tag: string; title: string; subtitle: string }) {
  return (
    <section className="relative isolate overflow-hidden rounded-[1.75rem] bg-[#191410] px-5 py-6 text-white shadow-[0_24px_60px_-30px_rgba(40,25,5,0.75)] sm:px-7 sm:py-7">
      <div aria-hidden className="absolute -left-20 -top-28 -z-10 size-80 rounded-full bg-[radial-gradient(circle,oklch(0.78_0.13_80/0.35),transparent_65%)]" />
      <div aria-hidden className="absolute -bottom-40 right-0 -z-10 size-96 rounded-full bg-[radial-gradient(circle,oklch(0.62_0.16_300/0.26),transparent_65%)]" />
      <div aria-hidden className="absolute inset-0 -z-10 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
        <span className="size-1.5 rounded-full bg-[oklch(0.84_0.11_82)]" aria-hidden />
        <span>{date}</span>
        <span className="rounded-full bg-[oklch(0.72_0.12_80/0.22)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[oklch(0.88_0.1_84)]">{tag}</span>
      </div>
      <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/75 sm:text-[15px]">{subtitle}</p>
    </section>
  );
}

// ───────────────────────────────────────────── blocks ─────────────────────────────────────────────
/** A small heading with a one-line explanation under it. */
export function SectionTitle({ title, hint, count, id }: { title: string; hint?: string; count?: number; id?: string }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="flex items-center gap-2 text-base font-semibold text-foreground">
        {title}
        {count !== undefined && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{count}</span>}
      </h2>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * A figure with its words, as a compact card: a small label with an icon on the right, a big number, what it counts and one small tag.
 * The longer explanation of the figure (`note`) is not printed: it is the hover text of the card, so the page stays short (owner, 2026-10-18: "do not be repetitive").
 */
export function StatBlock({ label, value, caption, tag, tagTone = "slate", note, warn, small, icon: Icon }: {
  label: string; value: ReactNode; caption: string; tag?: string; tagTone?: TagTone; note?: string; warn?: boolean;
  /** A smaller figure, for a long one. */
  small?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <div title={note} className="flex min-w-0 flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        {Icon && <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground" aria-hidden><Icon className="size-4" /></span>}
      </div>
      <p className={cn("mt-2 break-words font-semibold leading-none tracking-tight tabular-nums", small ? "text-2xl" : "text-3xl", warn && "text-amber-700 dark:text-amber-300")}>{value}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">{caption}</p>
      {tag && <div className="mt-3"><Tag tone={tagTone}>{tag}</Tag></div>}
    </div>
  );
}

/** A quiet "nothing here" line. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{children}</p>;
}

/** How long something has waited, in plain words: "35 min", "2 h 5 min". */
export function waitText(t: T, minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return t("{n} min", { n: minutes });
  return t("{h} h {m} min", { h: Math.floor(minutes / 60), m: minutes % 60 });
}
