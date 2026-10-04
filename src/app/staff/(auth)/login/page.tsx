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

      <header className="flex items-center justify-between gap-4 p-5 sm:px-10 sm:py-7">
        <Link href="/" className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
          <Image src="/brand/logo-192.png" alt="" width={48} height={48} className="size-11" />
          <span className="leading-none">
            <span className="block font-display text-2xl font-bold uppercase tracking-[0.16em] text-gold">{first}</span>
            {rest.length > 0 && <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.42em] text-white">{rest.join(" ")}</span>}
          </span>
        </Link>
        <Link href="/" className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/75 backdrop-blur-sm transition-colors hover:border-gold/60 hover:text-white">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to site
        </Link>
      </header>

      <main className="flex flex-1 items-center px-5 py-8 sm:px-10">
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
            <div aria-hidden="true" className="absolute -inset-px rounded-[1.75rem] bg-gradient-to-b from-gold/40 via-white/5 to-transparent" />
            <div className="relative rounded-[1.75rem] border border-white/10 bg-[#15120e]/75 p-7 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-8">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-white/55">
                <Lock className="size-3" aria-hidden="true" /> Staff access only
              </span>
              <h2 className="mt-4 font-display text-4xl">Sign in</h2>
              <p className="mt-2 text-sm text-white/55">Your dashboard opens automatically for your role — reception, manager or admin.</p>
              <div className="mt-7">
                <LoginForm />
              </div>
              <p className="mt-6 flex items-start gap-2 border-t border-white/10 pt-5 text-xs leading-relaxed text-white/45">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-white/35" aria-hidden="true" />
                Forgot your password? Ask the hotel administrator to reset it. Accounts are created by the hotel — guests don&apos;t need one; they book from the website.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="flex flex-wrap items-end justify-between gap-4 p-5 text-xs text-white/35 sm:px-10">
        <p className="font-medium text-white/55">{settings.hotelName}</p>
        <p>{addressLines(settings).join(" · ")}</p>
      </footer>
    </div>
  );
}
