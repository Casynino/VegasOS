import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Lock, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { addressLines } from "@/components/public/contact";
import { I18nProvider } from "@/i18n/client";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { msg } from "@/i18n/msg";
import { getT, guestLocale } from "@/i18n/server";
import { LoginForm } from "./login-form";
import { STAFF_PAINT } from "@/lib/staff-viewport";
import { INSTALL_WORDS } from "@/components/staff/install-words";
import { LoginGate } from "./login-gate";
import { LoginScene } from "./login-scene";
import "./login.css";

export async function generateMetadata(): Promise<Metadata> {
  await guestLocale();
  const t = await getT();
  return { title: t("Staff sign in"), robots: { index: false, follow: false } };
}

/** The words the sign-in form shows — the browser gets only these here (the staff app's strings come after sign-in). */
const FORM_WORDS = [msg("Email"), msg("you@vegashoteltz.com"), msg("Password"), msg("Hide password"), msg("Show password"), msg("Signing in…"), msg("Sign in"), ...INSTALL_WORDS];

const rd = (s: number) => ({ "--rd": `${s}s` }) as CSSProperties;

/**
 * The staff door. Always dark, over the hotel at night (login-scene.tsx, animated), because the first screen staff see each
 * shift should feel like the hotel — not like the login of a product bought off a shelf. One form for every role; the right
 * dashboard opens after sign-in. On a phone the page shows the welcome and one small Sign in button that opens the form as a
 * pop-up (login-gate.tsx); on a tablet or computer the card stays on the page.
 */
export default async function LoginPage() {
  await guestLocale();
  if (await getCurrentUser()) redirect("/staff");
  const settings = await getSettings();
  const [first, ...rest] = settings.hotelName.split(" ");
  // Before sign-in: the visitor's own language choice on this device, else a Chinese phone → Chinese, else English.
  const t = await getT();
  const formWords = t.locale === DEFAULT_LOCALE ? null : Object.fromEntries(FORM_WORDS.map((w) => [w, t(w)]));

  return (
    <div className="relative isolate flex min-h-svh flex-1 flex-col overflow-hidden bg-[#0c0a07] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] text-white">
      {/* the browser's own bars (top and bottom of a phone) take the page's colour: dark, like the picture */}
      <style>{STAFF_PAINT}</style>
      <LoginScene />

      <header className="vg-up flex items-center justify-between gap-3 px-4 py-4 sm:px-10 sm:py-7" style={rd(0.05)}>
        <Link href="/" className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
          <Image src="/brand/logo-192.png" alt="" width={48} height={48} className="size-9 sm:size-11" />
          <span className="leading-none">
            <span className="block font-display text-[1.25rem] font-bold uppercase tracking-[0.16em] text-gold sm:text-2xl">{first}</span>
            {rest.length > 0 && <span className="mt-1 block text-[8.5px] font-semibold uppercase tracking-[0.38em] text-white/85 sm:text-[10px]">{rest.join(" ")}</span>}
          </span>
        </Link>
        <Link href="/" className="inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-[13px] text-white/70 transition-colors hover:text-white sm:border sm:border-white/15 sm:bg-white/5 sm:px-4 sm:backdrop-blur-sm">
          <ArrowLeft className="size-4" aria-hidden="true" /> <span className="sm:hidden">{t("Website")}</span><span className="hidden sm:inline">{t("Back to site")}</span>
        </Link>
      </header>

      <main className="vg-main flex flex-1 items-center px-4 py-4 sm:px-10 sm:py-8 lg:pb-[20svh]">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <div className="vg-up hidden lg:block" style={rd(0.15)}>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold">Mlimani City · Dar es Salaam</p>
            <h1 className="mt-6 font-display text-6xl leading-[1.02]">{t("Welcome back.")}</h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/70">
              {t("Every arrival starts at reception.")}<br />
              {t("Every room ready on time.")}<br />
              {t("Every guest leaves wanting to return.")}
            </p>
            <div className="mt-10 h-px w-24 bg-gradient-to-r from-gold to-transparent" />
            <p className="mt-6 text-sm text-white/50">{t("Reception · Management · Administration — one sign-in for the whole hotel.")}</p>
          </div>

          <I18nProvider locale={t.locale} catalog={formWords}>
          <LoginGate
            openLabel={t("Sign in")}
            closeLabel={t("Close")}
            intro={
              <>
                <p className="vg-up vg-intro-eyebrow text-[10px] font-semibold uppercase tracking-[0.26em] text-gold" style={rd(0.2)}>Mlimani City · Dar es Salaam</p>
                <h1 className="vg-up vg-title mt-3 font-display leading-[1.02]" style={rd(0.3)}>{t("Welcome back.")}</h1>
                <p className="vg-up vg-intro-sub mt-3 max-w-[16rem] text-balance text-[13px] leading-relaxed text-white/60" style={rd(0.42)}>{t("Your dashboard opens for your role.")}</p>
              </>
            }
          >
            <div className="relative w-full">
              <div aria-hidden="true" className="absolute -inset-px rounded-[1.4rem] bg-gradient-to-b from-gold/35 via-white/5 to-transparent sm:rounded-[1.75rem]" />
              <div className="relative rounded-[1.4rem] border border-white/10 vg-card p-5 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] sm:rounded-[1.75rem] sm:p-8">
                <span className="vg-pop-hide inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/55">
                  <Lock className="size-3" aria-hidden="true" /> {t("Staff access only")}
                </span>
                <h2 className="mt-2 font-display text-[28px] leading-tight sm:mt-4 sm:text-4xl">{t("Sign in")}</h2>
                <p className="vg-pop-hide mt-1 text-[13px] text-white/55 sm:text-sm">{t("Your dashboard opens for your role.")}</p>
                <div className="mt-5 sm:mt-7">
                  <LoginForm />
                </div>
                <p className="mt-5 flex items-start gap-2 border-t border-white/10 pt-4 text-[12px] leading-relaxed text-white/45 sm:mt-6 sm:pt-5">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-white/35" aria-hidden="true" />
                  {t("Forgot your password? Ask the hotel administrator.")}
                </p>
              </div>
            </div>
          </LoginGate>
          </I18nProvider>
        </div>
      </main>

      <footer className="flex flex-wrap items-end justify-center gap-x-6 gap-y-1 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 text-xs text-white/35 sm:justify-between sm:p-5 sm:px-10 sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {/* (the hotel's name is not repeated down here: it is already in the corner above) */}
        <p className="hidden sm:block">{addressLines(settings).join(" · ")}</p>
        {/* Who made the system — one quiet line to Nino's page and work (only here, on the sign-in page): the system's own name and "by Nino",
            worded like the other systems' sign-in pages ("The Distribution Chain by Nino", "Sales Inventory System by Nino", "Sea Freight System by Nino"),
            plain text with no pill or badge (owner, 2026-11-09: not "Developed by Nino", and no hotel name repeated). */}
        <p className="flex items-center justify-center gap-x-1.5 text-xs text-white/55">
          <span>{t("Hotel Management System")}</span>
          <Link href="/nino" aria-label={`${t("Hotel Management System")} by Nino`} className="group -my-2 inline-flex min-h-10 items-center gap-1 rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
            by <span className="font-semibold text-white/80 transition-colors group-hover:text-[#e2ba6e]">Nino</span>
            <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
          </Link>
        </p>
      </footer>
    </div>
  );
}
