import Image from "next/image";
import Link from "next/link";
import { Actions, LinkButton, Section, SectionIntro, TextLink, focusRing } from "@/components/public/kit";
import { LostCompass, OutlineNumerals, WayBack } from "@/components/public/services/compass";
import { getT } from "@/i18n/server";

/**
 * Site-wide 404 for addresses that match no page (a mistyped or old link). It renders outside the
 * public shell, so it carries the logo itself and the `pub-site` scope (the atmosphere's line work
 * lives there); otherwise it is the public 404's night moment off the map.
 */
export default async function NotFound() {
  const t = await getT();
  return (
    <main className="pub-site flex min-h-svh flex-1 flex-col bg-night">
      <Section
        tone="night"
        glow="sky"
        width="narrow"
        labelledBy="not-found-title"
        className="flex flex-1 flex-col justify-center overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))]"
        containerClassName="flex flex-col items-center"
      >
        <LostCompass y="38%" />
        <Link href="/" className={`rounded-full ${focusRing}`}>
          <Image src="/brand/logo-192.png" alt={t("Vegas Luxury Hotel — home")} width={72} height={72} className="size-16 sm:size-[4.5rem]" />
        </Link>
        <OutlineNumerals className="mt-8 sm:mt-10">404</OutlineNumerals>
        <SectionIntro
          align="center"
          as="h1"
          eyebrow={t("Page not found")}
          id="not-found-title"
          title={t("We couldn’t find that page")}
          lede={t("The link may be old or mistyped. Let’s get you back to the hotel.")}
          className="mt-6 sm:mt-8"
        />
        <Actions align="center" className="mt-8">
          <LinkButton href="/" icon="arrow">{t("Back to home")}</LinkButton>
          <TextLink href="/book">{t("Book your stay")}</TextLink>
        </Actions>
        <WayBack label={t("The way back")} className="mt-12 sm:mt-14" />
      </Section>
    </main>
  );
}
