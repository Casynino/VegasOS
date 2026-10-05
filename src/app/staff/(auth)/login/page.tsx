import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { addressLines } from "@/components/public/contact";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false, follow: false } };

/**
 * The staff door. Always dark, over a real photo of the hotel, because the
 * first screen staff see each shift should feel like the hotel — not like
 * the login of a product bought off a shelf. One form for every role; the
 * right dashboard opens after sign-in.
 */
export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/staff");
  const settings = await getSettings();
  const [first, ...rest] = settings.hotelName.split(" ");

  return (
    <div className="relative isolate flex min-h-svh flex-1 flex-col overflow-hidden bg-[#0b0906] text-white">
      <Image
        src="/images/room-red/room-red-04.webp" alt="" fill priority sizes="100vw"
        className="-z-20 object-cover opacity-45"
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,#0b0906_18%,rgba(11,9,6,0.82)_48%,rgba(11,9,6,0.55)_100%)]" />
      <div aria-hidden="true" className="absolute -right-40 -top-40 -z-10 size-[40rem] rounded-full bg-gold/10 blur-3xl" />

      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-10 sm:py-7">
        <Link href="/" className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
          <Image src="/brand/logo-192.png" alt="" width={48} height={48} className="size-9 sm:size-11" />
          <span className="leading-none">
            <span className="block font-display text-[1.25rem] font-bold uppercase tracking-[0.16em] text-gold sm:text-2xl">{first}</span>
            {rest.length > 0 && <span className="mt-1 block text-[8.5px] font-semibold uppercase tracking-[0.38em] text-white/85 sm:text-[10px]">{rest.join(" ")}</span>}
          </span>
        </Link>
        <Link href="/" className="inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-[13px] text-white/70 transition-colors hover:text-white sm:border sm:border-white/15 sm:bg-white/5 sm:px-4 sm:backdrop-blur-sm">
          <ArrowLeft className="size-4" aria-hidden="true" /> <span className="sm:hidden">Website</span><span className="hidden sm:inline">Back to site</span>
        </Link>
      </header>

      <main className="flex flex-1 items-center px-4 py-4 sm:px-10 sm:py-8">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <div className="hidden lg:block">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold">Mlimani City · Dar es Salaam</p>
            <h1 className="mt-6 font-display text-6xl leading-[1.02]">Welcome back.</h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/70">
              Every arrival starts at reception.<br />
              Every room ready on time.<br />
              Every guest leaves wanting to return.
            </p>
            <div className="mt-10 h-px w-24 bg-gradient-to-r from-gold to-transparent" />
            <p className="mt-6 text-sm text-white/50">Reception · Management · Administration — one sign-in for the whole hotel.</p>
          </div>

          <div className="relative w-full">
            <div aria-hidden="true" className="absolute -inset-px rounded-[1.4rem] bg-gradient-to-b from-gold/35 via-white/5 to-transparent sm:rounded-[1.75rem]" />
            <div className="relative rounded-[1.4rem] border border-white/10 bg-[#15120e]/80 p-5 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:rounded-[1.75rem] sm:p-8">
              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-white/55">
                <Lock className="size-3" aria-hidden="true" /> Staff access only
              </span>
              <h2 className="mt-2 font-display text-[28px] leading-tight sm:mt-4 sm:text-4xl">Sign in</h2>
              <p className="mt-1 text-[13px] text-white/55 sm:text-sm">Your dashboard opens for your role.</p>
              <div className="mt-5 sm:mt-7">
                <LoginForm />
              </div>
              <p className="mt-5 flex items-start gap-2 border-t border-white/10 pt-4 text-[12px] leading-relaxed text-white/45 sm:mt-6 sm:pt-5">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-white/35" aria-hidden="true" />
                Forgot your password? Ask the hotel administrator.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="flex flex-wrap items-end justify-between gap-4 px-4 pb-5 pt-2 text-xs text-white/35 sm:p-5 sm:px-10">
        <p className="font-medium text-white/55">{settings.hotelName}</p>
        <p className="hidden sm:block">{addressLines(settings).join(" · ")}</p>
      </footer>
    </div>
  );
}
