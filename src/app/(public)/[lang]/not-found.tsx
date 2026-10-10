import { Actions, LinkButton, Section, SectionIntro, TextLink } from "@/components/public/kit";
import { LostCompass, OutlineNumerals, WayBack } from "@/components/public/services/compass";
import { getT } from "@/i18n/server";

/**
 * 404 inside the public shell (a wrong booking link, an unknown room): a night moment off the map —
 * a faint survey compass searching for its bearing behind outline numerals — and the two ways on,
 * with the hotel's real coordinates as "the way back".
 */
export default async function PublicNotFound() {
  const t = await getT();
  return (
    <Section
      tone="night"
      first
      glow="sky"
      width="narrow"
      labelledBy="not-found-title"
      className="flex min-h-[80svh] flex-1 flex-col justify-center overflow-hidden pb-24 sm:pb-28"
    >
      <LostCompass y="34%" />
      <OutlineNumerals className="mb-6 sm:mb-8">404</OutlineNumerals>
      <SectionIntro
        align="center"
        as="h1"
        eyebrow={t("Not found")}
        id="not-found-title"
        title={t("We couldn’t find that page")}
        lede={t("If you followed a booking link, please use the full link from your confirmation, or contact us and we’ll look it up.")}
      />
      <Actions align="center" className="mt-8">
        <LinkButton href="/" icon="arrow">{t("Back to home")}</LinkButton>
        <TextLink href="/contact?subject=existing">{t("Help with a booking")}</TextLink>
      </Actions>
      <WayBack label={t("The way back")} className="mt-12 sm:mt-14" />
    </Section>
  );
}
