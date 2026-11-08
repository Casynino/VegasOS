import Image from "next/image";
import { getT } from "@/i18n/server";
import { getSettings } from "@/server/settings";
import { cn } from "@/lib/utils";

/**
 * THE SMALL BANNER every desk opens on, copied from the owner's Target Express / Swift Cargo console (2026-11-08): deep warm night, a
 * gold light from the top, the hotel's own photo fading in at the right; the person's FIRST NAME in wide capitals between two gold rules,
 * their job title small in gold under it, then today's date — nothing else (no greeting, no explanation: the figures are right below).
 * Read from whoever is shown, so the name and the title can never disagree. The bell and the account live in the side menu.
 */
export async function NameBanner({ name, role, image = "/images/exterior/exterior-02.webp" }: { name: string; role: string; image?: string }) {
  const [t, settings] = await Promise.all([getT(), getSettings()]);
  const date = new Intl.DateTimeFormat(t.intl, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: settings.timezone }).format(new Date());
  // A long name gets narrower letters, or a phone would push it onto two lines.
  const long = name.length > 10;
  return (
    <section className="relative isolate overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#140f0b_0%,#1d1610_45%,#2a1f14_75%,#3a2a17_100%)] text-white shadow-[0_12px_30px_-14px_rgba(10,6,2,0.75),inset_0_1px_0_rgba(255,255,255,0.10)] ring-1 ring-white/10 print:hidden">
      {/* Depth, painted in: a warm light from the right, a little gold from the top, a fine sheen along the top edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(600px_220px_at_92%_60%,oklch(0.72_0.12_80/0.3),transparent_62%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(420px_150px_at_50%_-10%,oklch(0.82_0.13_84/0.2),transparent_70%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      {/* The hotel at the side: softly on a phone, clearer on a computer. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-[45%] opacity-40 [mask-image:linear-gradient(to_left,#000_20%,transparent)] sm:w-[34%] sm:opacity-60 lg:w-[30%] lg:opacity-75 lg:[mask-image:linear-gradient(to_left,#000_40%,transparent)]">
        <Image src={image} alt="" fill sizes="(min-width: 1024px) 30vw, 45vw" className="object-cover" priority />
      </div>
      <div className="relative flex min-h-[5.75rem] flex-col items-center justify-center px-5 py-4 text-center sm:min-h-[7.5rem] sm:py-5">
        <h1 className={cn("flex max-w-full items-center gap-4 font-semibold uppercase text-white",
          long ? "text-base tracking-[0.2em] sm:text-2xl sm:tracking-[0.3em] lg:text-3xl" : "text-xl tracking-[0.32em] sm:text-3xl sm:tracking-[0.5em] lg:text-4xl")}>
          <span aria-hidden className="hidden h-px w-10 shrink-0 bg-[oklch(0.78_0.13_82)]/60 sm:block" />
          {/* The padding gives back the space the wide tracking leaves after the last letter, so the word sits truly in the middle. */}
          <span className={cn("min-w-0 break-words", long ? "pl-[0.2em] sm:pl-[0.3em]" : "pl-[0.32em] sm:pl-[0.5em]")}>{name}</span>
          <span aria-hidden className="hidden h-px w-10 shrink-0 bg-[oklch(0.78_0.13_82)]/60 sm:block" />
        </h1>
        <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.32em] text-[oklch(0.84_0.11_82)] sm:mt-2 sm:text-[11px]">{role}</p>
        <p className="mt-1 text-xs text-white/65 sm:mt-1.5 sm:text-sm">{date}</p>
      </div>
    </section>
  );
}
