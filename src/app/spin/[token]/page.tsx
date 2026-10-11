import type { Metadata } from "next";
import { headers } from "next/headers";
import { Phone } from "lucide-react";
import { getT, guestLocale } from "@/i18n/server";
import { getCurrentUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { spinView } from "@/server/services/spin";
import { prettyPhone } from "@/lib/guest-messages";
import { telHref } from "@/components/hotel-qr/lib";
import { SpinApp } from "@/components/spin/spin-app";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { WebsiteLine } from "@/components/ordering/website-link";

// Every scan is answered from the database at that moment: who is checked in to the room, and what they have left.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  await guestLocale();
  const t = await getT();
  return { title: t("Spin to Win"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/**
 * The page behind the Spin to Win card in a room. The address carries the room's own code and nothing else — no
 * guest, no stay. The wheel opens only for the guest checked in to that room right now; everyone else (a free room,
 * a guest who has left, a wrong or switched-off code) gets one quiet page.
 */
export default async function SpinPage({ params }: { params: Promise<{ token: string }> }) {
  await guestLocale();
  const t = await getT();
  const { token } = await params;
  // A scan is the page being opened — not the page asking again after a spin.
  const opened = !(await headers()).has("rsc");
  const [view, s, user] = await Promise.all([spinView(token, new Date(), { count: opened }), getSettings(), getCurrentUser()]);
  if (view.open) return <SpinApp token={token} view={view} hotel={s.hotelName} languages={s.enabledLanguages} staff={!!user} />;

  const phone = s.phone ? prettyPhone(s.phone) : null;
  return (
    <main className="vr relative grid min-h-svh place-items-center overflow-hidden bg-(--vr-dark) px-4 py-10 text-white">
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-28 size-80 rounded-full bg-(--vr-gold)/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-20 size-96 rounded-full bg-(--vr-gold)/[0.06] blur-3xl" />
      <LanguageSwitch variant="toggle" languages={s.enabledLanguages} className="absolute right-3 top-3" />
      <div className="relative w-full max-w-sm text-center motion-safe:animate-[vlh-fade_0.7s_ease-out_both]">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-(--vr-dark) ring-[1.5px] ring-(--vr-gold)/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-192.png" alt="" className="size-12 rounded-full" />
        </span>
        <p className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.24em] text-white/55">{s.hotelName}</p>
        <h1 className="mt-3 font-display text-[30px] font-semibold leading-[1.08] text-balance">{t("Spin to Win is for our checked-in guests")}</h1>
        <p className="mx-auto mt-3 max-w-xs text-[14px] leading-relaxed text-white/70">
          {t("Once you have checked in to this room, scan this code again to spin for complimentary treats from our restaurant.")}
        </p>
        {phone && (
          <a href={telHref(phone)} className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white/[0.07] px-5 text-[13px] font-semibold ring-1 ring-white/20 transition hover:bg-white/[0.13]">
            <Phone className="size-3.5 text-(--vr-gold)" />{t("Call reception · {phone}", { phone })}
          </a>
        )}
        <WebsiteLine hotel={s.hotelName} className="mt-8 text-white/85" link="text-(--vr-gold)" />
      </div>
    </main>
  );
}
