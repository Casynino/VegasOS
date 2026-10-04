import type { ReactNode } from "react";

/**
 * The small page banner the staff pages share (Restaurant & Bar, shift pages…): a gold icon tile, a small eyebrow,
 * the title and one quiet line — and the page's own control on the right (a switch, a link). Nothing heavy.
 */
export function SlimBanner({ icon, eyebrow, title, sub, right }: { icon: ReactNode; eyebrow: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 size-56 rounded-full bg-[oklch(0.75_0.12_80/0.10)] blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-[oklch(0.84_0.11_85)] to-[oklch(0.62_0.12_65)] text-[#1b1611] shadow-[0_10px_24px_-12px_oklch(0.7_0.12_75)] [&_svg]:size-6">{icon}</span>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{eyebrow}</p>
            <h1 className="truncate text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{title}</h1>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
    </section>
  );
}
