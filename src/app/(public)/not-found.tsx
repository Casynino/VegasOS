import { Actions, LinkButton, Section, SectionIntro, TextLink } from "@/components/public/kit";

/** 404 inside the public shell (a wrong booking link, an unknown room): a calm night moment and the two ways on. */
export default function PublicNotFound() {
  return (
    <Section tone="night" first glow="sky" width="narrow" labelledBy="not-found-title" className="flex flex-1 flex-col justify-center pb-24 sm:pb-28">
      <SectionIntro
        align="center"
        as="h1"
        eyebrow="Not found"
        id="not-found-title"
        title="We couldn’t find that page"
        lede="If you followed a booking link, please use the full link from your confirmation, or contact us and we’ll look it up."
      />
      <Actions align="center" className="mt-8">
        <LinkButton href="/" icon="arrow">Back to home</LinkButton>
        <TextLink href="/contact?subject=existing">Help with a booking</TextLink>
      </Actions>
    </Section>
  );
}
