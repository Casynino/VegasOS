import Image from "next/image";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { AttentionList, type AttentionRow } from "./attention-list";

/**
 * Soft, light dashboard kit shared by every staff dashboard (admin, manager,
 * reception): pastel stat tiles with sparklines, rounded panels, status pills
 * and a month calendar. Pure server components — no client JS.
 */

export type Tone = "gold" | "violet" | "emerald" | "sky" | "rose" | "amber" | "slate";
const TONES: Record<Tone, { tile: string; chip: string; stroke: string; fill: string }> = {
  gold: { tile: "from-[oklch(0.97_0.035_85)] border-[oklch(0.9_0.05_85)]", chip: "bg-[oklch(0.72_0.12_80)] shadow-[0_8px_20px_-8px_oklch(0.72_0.12_80)]", stroke: "oklch(0.66 0.12 78)", fill: "oklch(0.72 0.12 80 / 0.18)" },
  violet: { tile: "from-violet-50 border-violet-100", chip: "bg-violet-500 shadow-[0_8px_20px_-8px_var(--color-violet-500)]", stroke: "#8b5cf6", fill: "rgb(139 92 246 / 0.15)" },
  emerald: { tile: "from-emerald-50 border-emerald-100", chip: "bg-emerald-500 shadow-[0_8px_20px_-8px_var(--color-emerald-500)]", stroke: "#10b981", fill: "rgb(16 185 129 / 0.15)" },
  sky: { tile: "from-sky-50 border-sky-100", chip: "bg-sky-500 shadow-[0_8px_20px_-8px_var(--color-sky-500)]", stroke: "#0ea5e9", fill: "rgb(14 165 233 / 0.15)" },
  rose: { tile: "from-rose-50 border-rose-100", chip: "bg-rose-500 shadow-[0_8px_20px_-8px_var(--color-rose-500)]", stroke: "#f43f5e", fill: "rgb(244 63 94 / 0.15)" },
  amber: { tile: "from-amber-50 border-amber-100", chip: "bg-amber-500 shadow-[0_8px_20px_-8px_var(--color-amber-500)]", stroke: "#f59e0b", fill: "rgb(245 158 11 / 0.15)" },
  slate: { tile: "from-slate-50 border-border", chip: "bg-slate-600 shadow-[0_8px_20px_-8px_var(--color-slate-600)]", stroke: "#64748b", fill: "rgb(100 116 139 / 0.15)" },
};

export function Sparkline({ values, tone = "gold", className }: { values: number[]; tone?: Tone; className?: string }) {
  if (values.length < 2) return null;
  const w = 120, h = 36, max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const t = TONES[tone];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-9 w-full", className)} aria-hidden="true">
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={t.fill} />
      <path d={line} fill="none" stroke={t.stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Delta({ value, unit = "%", invert, label }: { value: number | null; unit?: string; invert?: boolean; label?: string }) {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 0.05) return <span className="text-xs text-muted-foreground">{label ? `Same as ${label}` : "No change"}</span>;
  const up = value > 0, good = invert ? !up : up;
  const I = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold", good ? "bg-emerald-500/12 text-emerald-700" : "bg-rose-500/12 text-rose-700")}>
        <I className="size-3" />{Math.abs(value).toFixed(1)}{unit}
      </span>
      {label && <span>vs {label}</span>}
    </span>
  );
}

/** Pastel stat tile: coloured icon squircle, big figure, change and a sparkline. */
export function StatTile({ label, value, icon, tone = "gold", delta, sub, spark, href }: {
  label: string; value: React.ReactNode; icon: React.ReactNode; tone?: Tone; delta?: React.ReactNode; sub?: React.ReactNode; spark?: number[]; href?: string;
}) {
  const t = TONES[tone];
  const body = (
    <div className={cn("group relative flex h-full flex-col overflow-hidden rounded-3xl border bg-linear-to-br to-card p-4 dark:from-white/[0.04] dark:border-border transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-22px_rgba(15,23,42,0.35)] sm:p-5", t.tile)}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-2xl text-white sm:size-11 [&_svg]:size-5", t.chip)}>{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
          <p className={cn("mt-0.5 truncate font-bold tracking-tight text-foreground tabular-nums", typeof value === "string" && value.length > 10 ? "text-[15px] sm:text-xl" : "text-xl sm:text-[1.65rem]")}>{value}</p>
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 pt-3">
        <div className="min-w-0 text-xs text-muted-foreground">{delta}{sub && <div className="mt-0.5 truncate">{sub}</div>}</div>
        {spark && <Sparkline values={spark} tone={tone} className="w-24 shrink-0 sm:w-28" />}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">{body}</Link> : body;
}

/** Rounded white panel with a title row. */
export function Panel({ title, subtitle, action, children, className, bodyClassName }: {
  title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-3xl border border-border/70 bg-card p-4 shadow-[0_2px_4px_rgba(15,23,42,0.03),0_12px_32px_-18px_rgba(15,23,42,0.18)] sm:p-6", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function PanelLink({ href, children = "View all" }: { href: string; children?: React.ReactNode }) {
  return <Link href={href} className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted">{children}</Link>;
}

const PILL: Record<string, string> = {
  CONFIRMED: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30", RESERVED: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30", CHECKED_IN: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  CHECKED_OUT: "bg-muted text-muted-foreground ring-slate-200", PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30", OWES: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  LATE: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30", NEW: "bg-[oklch(0.96_0.05_85)] text-[oklch(0.45_0.1_75)] ring-[oklch(0.88_0.07_85)]",
};
export function Pill({ kind, children }: { kind: keyof typeof PILL | string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", PILL[kind] ?? PILL.CHECKED_OUT)}>{children}</span>;
}

export function Initials({ name, className }: { name: string; className?: string }) {
  const palette = ["bg-violet-100 text-violet-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700"];
  const i = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % palette.length;
  return <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold", palette[i], className)} aria-hidden="true">{name.replace(/\(.*\)/, "").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</span>;
}

/** Month calendar: arrivals (dot + count) per day, today highlighted. */
export function MonthCalendar({ month, today, arrivals, departures, href }: {
  month: string; today: string; arrivals: Record<string, number>; departures: Record<string, number>; href?: (date: string) => string;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const title = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-foreground">{title}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d} className="pb-1">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const a = arrivals[d] ?? 0, dep = departures[d] ?? 0, isToday = d === today, past = d < today;
          const inner = (
            <span className={cn("relative flex aspect-square flex-col items-center justify-center rounded-xl text-xs font-medium transition-colors",
              isToday ? "bg-[oklch(0.72_0.12_80)] text-white shadow-[0_8px_18px_-8px_oklch(0.72_0.12_80)]" : past ? "text-muted-foreground/50" : "text-foreground/80 hover:bg-muted")}>
              {Number(d.slice(8))}
              {(a > 0 || dep > 0) && (
                <span className="absolute bottom-1 flex gap-0.5">
                  {a > 0 && <span className={cn("size-1 rounded-full", isToday ? "bg-white" : "bg-emerald-500")} />}
                  {dep > 0 && <span className={cn("size-1 rounded-full", isToday ? "bg-white/70" : "bg-rose-400")} />}
                </span>
              )}
              <span className="sr-only">{a} arrivals, {dep} departures</span>
            </span>
          );
          return href && !past ? <Link key={d} href={href(d)} title={`${a} arriving · ${dep} leaving`}>{inner}</Link> : <span key={d} title={`${a} arriving · ${dep} leaving`}>{inner}</span>;
        })}
      </div>
      <div className="mt-3 flex gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" />Arrivals</span>
        <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-rose-400" />Departures</span>
      </div>
    </div>
  );
}

/**
 * Welcome banner: warm night gradient with a real hotel photo fading in on
 * the right, date/time chip, greeting, one line, live figure chips and actions.
 */
export function HeroBanner({ eyebrow, title, subtitle, chips, actions, extra, aside, image = "/images/exterior/exterior-02.webp" }: {
  eyebrow?: React.ReactNode; title: string; subtitle: React.ReactNode;
  /** Anything else that belongs in the banner (e.g. the reception shift). */
  extra?: React.ReactNode;
  /** Small panel on the right side of the banner (e.g. the reception shift). */
  aside?: React.ReactNode;
  chips?: { label: string; value: React.ReactNode; dot: string }[];
  actions?: { href: string; label: string; icon?: React.ReactNode; primary?: boolean }[];
  image?: string;
}) {
  return (
    <section className="relative isolate overflow-hidden rounded-[1.75rem] bg-[#191410] text-white shadow-[0_24px_60px_-30px_rgba(40,25,5,0.75)]">
      {/* photo: right half on desktop, soft full background on phones */}
      <div aria-hidden className="absolute inset-y-0 right-0 -z-10 w-full sm:w-[55%]">
        <Image src={image} alt="" fill sizes="(min-width: 640px) 55vw, 100vw" className="object-cover object-center opacity-45 sm:opacity-90" priority />
        <div className="absolute inset-0 bg-linear-to-r from-[#191410] via-[#191410]/75 to-[#191410]/10 sm:via-[#191410]/55" />
        <div className="absolute inset-0 bg-linear-to-t from-[#191410]/80 via-transparent to-transparent" />
      </div>
      <div aria-hidden className="absolute -left-20 -top-28 -z-10 size-80 rounded-full bg-[radial-gradient(circle,oklch(0.78_0.13_80/0.35),transparent_65%)]" />
      <div aria-hidden className="absolute -bottom-36 left-1/4 -z-10 size-96 rounded-full bg-[radial-gradient(circle,oklch(0.62_0.16_300/0.28),transparent_65%)]" />

      <div className={cn("relative", aside && "flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-7 sm:py-6")}>
      <div className={cn("max-w-2xl", !aside && "px-5 py-6 sm:p-7 lg:p-8")}>
        {eyebrow && (
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[oklch(0.84_0.11_82)]">{eyebrow}</p>
        )}
        <h1 className="text-[1.6rem] font-semibold leading-tight tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-white/75 sm:text-[15px]">{subtitle}</p>
        {chips && chips.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {chips.map((c) => (
              <span key={c.label} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.08] px-3 py-1.5 text-xs text-white/70 backdrop-blur">
                <span className={cn("size-2 rounded-full", c.dot)} /><strong className="text-sm font-semibold tabular-nums text-white">{c.value}</strong>{c.label}
              </span>
            ))}
          </div>
        )}
        {extra}
        {actions && actions.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2.5">
            {actions.map((a) => (
              <Link key={a.href} href={a.href} className={cn("inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-transform hover:-translate-y-0.5 [&_svg]:size-4",
                a.primary ? "bg-linear-to-r from-[#f2d28c] to-[#d9a646] text-[#1b1611] shadow-[0_10px_24px_-10px_#d9a646]" : "border border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/15")}>
                {a.icon}{a.label}
              </Link>
            ))}
          </div>
        )}
      </div>
      {aside}
      </div>
    </section>
  );
}

/** Each quick action keeps its own colour, as a soft tinted icon (and a matching count badge). */
const QA_TINT = {
  gold: { chip: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.55_0.11_75)] dark:text-[oklch(0.84_0.11_82)]", badge: "bg-[oklch(0.72_0.12_80)] text-black" },
  emerald: { chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", badge: "bg-emerald-500 text-white" },
  sky: { chip: "bg-sky-500/15 text-sky-600 dark:text-sky-300", badge: "bg-sky-500 text-white" },
  violet: { chip: "bg-violet-500/15 text-violet-600 dark:text-violet-300", badge: "bg-violet-500 text-white" },
  rose: { chip: "bg-rose-500/15 text-rose-600 dark:text-rose-300", badge: "bg-rose-500 text-white" },
  amber: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", badge: "bg-amber-500 text-black" },
  teal: { chip: "bg-teal-500/15 text-teal-600 dark:text-teal-300", badge: "bg-teal-500 text-white" },
} as const;
export type QuickTone = keyof typeof QA_TINT;
/**
 * Quick actions as one slim row of pills: the main job (the gold one — New
 * booking) first, then every other everyday job with a small tinted icon and a
 * live count where it helps. Scrolls sideways on a phone instead of stacking.
 */
export function QuickActions({ items }: { items: { href: string; label: string; hint?: string; icon: React.ReactNode; tone: QuickTone; badge?: number }[] }) {
  const primary = items.find((a) => a.tone === "gold");
  const rest = items.filter((a) => a !== primary);
  return (
    <nav aria-label="Quick actions" className="flex items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible">
      {primary && (
        <Link href={primary.href} title={primary.hint}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] pl-2 pr-4 text-sm font-semibold text-[oklch(0.2_0.03_60)] shadow-[0_8px_22px_-12px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 transition-all hover:brightness-105 hover:shadow-[0_10px_26px_-10px_oklch(0.7_0.12_80)]">
          <span className="grid size-7 place-items-center rounded-full bg-black/10 [&_svg]:size-4">{primary.icon}</span>
          {primary.label}
        </Link>
      )}
      {rest.map((a) => (
        <Link key={a.label} href={a.href} title={a.hint}
          className="group inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-border/70 bg-card pl-1.5 pr-3.5 text-sm font-medium text-foreground/90 transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground">
          <span className={cn("grid size-7 place-items-center rounded-full transition-transform group-hover:scale-105 [&_svg]:size-[15px]", QA_TINT[a.tone].chip)}>{a.icon}</span>
          {a.label}
          {a.badge ? <span className={cn("-mr-1 min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 tabular-nums", QA_TINT[a.tone].badge)}>{a.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** Small uppercase section label with an optional "All →" link. */
export function SectionLabel({ title, href, linkLabel = "View all", count }: { title: string; href?: string; linkLabel?: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{title}
        {count !== undefined && <span className={cn("rounded-full px-2 py-0.5 text-[11px] tracking-normal", count > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700")}>{count}</span>}
      </h2>
      {href && <Link href={href} className="text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline">{linkLabel} →</Link>}
    </div>
  );
}

export type AttentionItem = AttentionRow;
/** Things that need someone: one card with area chips and slim rows (three in view, the rest scroll). */
export function AttentionCards({ items, emptyTitle = "All good — nothing needs you", emptyDetail = "No unpaid departures, no waiting requests, nothing blocked." }: { items: AttentionItem[]; emptyTitle?: string; emptyDetail?: string }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-linear-to-br from-emerald-50 to-card p-4 dark:border-emerald-500/20 dark:from-emerald-500/10">
        <span className="grid size-10 place-items-center rounded-xl bg-emerald-500 text-white shadow-[0_8px_18px_-8px_var(--color-emerald-500)]">✓</span>
        <span><span className="block text-sm font-semibold text-foreground">{emptyTitle}</span><span className="text-xs text-muted-foreground">{emptyDetail}</span></span>
      </div>
    );
  }
  return <AttentionList items={items} />;
}

/**
 * Rooms at a glance (dark card): a ring split by status around the total,
 * with the counts beside it — fills its space on every screen size.
 */
export function RoomsGlance({ total, parts, footer, href, title = "Rooms tonight", unit = "rooms", center }: {
  total: number; parts: { label: string; value: number; color: string }[]; footer?: React.ReactNode; href?: string;
  /** The heading and the word under the number (the tables use it too). */
  title?: string; unit?: string;
  /** What the middle of the ring says (e.g. "35%" / "full tonight") — instead of the total everyone knows. */
  center?: { value: string; label: string; sub?: string };
}) {
  const r = 46, c = 2 * Math.PI * r;
  const lens = parts.map((p) => (p.value / Math.max(1, total)) * c);
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  const body = (
    <div className="flex h-full flex-col gap-5 rounded-3xl bg-linear-to-br from-[#1d2233] via-[#232842] to-[#2e2a4a] p-5 text-white shadow-[0_18px_40px_-22px_rgba(15,23,42,0.8)] transition-transform hover:-translate-y-0.5 sm:p-6">
      <p className="text-sm font-medium text-white/70">{title}</p>
      <div className="flex items-center gap-5">
        <div className="relative size-32 shrink-0">
          <svg viewBox="0 0 110 110" className="size-full -rotate-90" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
            <circle cx="55" cy="55" r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="11" />
            {parts.map((p, i) => p.value > 0 && (
              <circle key={p.label} cx="55" cy="55" r={r} fill="none" stroke={p.color} strokeWidth="11" strokeDasharray={`${Math.max(0, lens[i] - 2)} ${c}`} strokeDashoffset={-offsets[i]} />
            ))}
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center"><div><p className={cn("font-bold tabular-nums leading-none tracking-tight", center ? "text-[1.6rem]" : "text-3xl")}>{center?.value ?? total}</p><p className="mt-1 text-[9px] font-medium uppercase leading-none tracking-[0.14em] text-white/55">{center?.label ?? unit}</p>{center?.sub && <p className="mt-1 text-[10px] leading-none tabular-nums text-white/40">{center.sub}</p>}</div></div>
        </div>
        <ul className="min-w-0 flex-1 space-y-2 text-sm">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="min-w-0 flex-1 truncate text-white/70">{p.label}</span>
              <span className="font-semibold tabular-nums">{p.value}</span>
            </li>
          ))}
        </ul>
      </div>
      {footer && <div className="mt-auto rounded-2xl bg-white/[0.07] px-3.5 py-2.5 text-xs text-white/70">{footer}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-3xl">{body}</Link> : body;
}

/** Two bars per day (e.g. arrivals vs departures) — plain SVG, no client JS. */
export function PairBars({ data, a, b }: { data: { label: string; a: number; b: number; today?: boolean }[]; a: { name: string; color: string }; b: { name: string; color: string } }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const totalA = data.reduce((s, d) => s + d.a, 0), totalB = data.reduce((s, d) => s + d.b, 0);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: a.color }} />{a.name} <strong className="text-foreground tabular-nums">{totalA}</strong></span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: b.color }} />{b.name} <strong className="text-foreground tabular-nums">{totalB}</strong></span>
      </div>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label={data.map((d) => `${d.label}: ${d.a} ${a.name.toLowerCase()}, ${d.b} ${b.name.toLowerCase()}`).join("; ")}>
        {data.map((d) => (
          <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.label}: ${d.a} ${a.name.toLowerCase()} · ${d.b} ${b.name.toLowerCase()}`}>
            <div className="flex h-full items-end justify-center gap-0.5">
              <span className="w-1/2 max-w-3 rounded-t-sm" style={{ height: `${Math.max(3, (d.a / max) * 100)}%`, background: a.color, opacity: d.a ? 1 : 0.25 }} />
              <span className="w-1/2 max-w-3 rounded-t-sm" style={{ height: `${Math.max(3, (d.b / max) * 100)}%`, background: b.color, opacity: d.b ? 1 : 0.25 }} />
            </div>
            <span className={cn("mt-1.5 truncate text-center text-[10px] tabular-nums", d.today ? "font-bold text-foreground" : "text-muted-foreground")}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars, one per row (e.g. how full each coming night is). */
export function BarList({ rows }: { rows: { label: string; value: number; max: number; note?: string; highlight?: boolean }[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const pct = r.max ? Math.round((r.value / r.max) * 100) : 0;
        return (
          <li key={r.label} className="text-sm">
            <div className="mb-1 flex justify-between gap-2">
              <span className={cn(r.highlight ? "font-semibold text-foreground" : "text-muted-foreground")}>{r.label}</span>
              <span className="tabular-nums text-muted-foreground"><strong className="text-foreground">{r.value}</strong>/{r.max} · {pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-sky-500" : "bg-amber-500")} style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
