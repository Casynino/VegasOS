import Image from "next/image";
import Link from "next/link";
import { Actions, LinkButton, Section, SectionIntro, TextLink, focusRing } from "@/components/public/kit";

/**
 * Site-wide 404 for addresses that match no page (a mistyped or old link). It renders outside the
 * public shell, so it carries the logo itself; otherwise it is the public 404's calm night moment.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-1 flex-col bg-night">
      <Section
        tone="night"
        glow="sky"
        width="narrow"
        labelledBy="not-found-title"
        className="flex flex-1 flex-col justify-center pb-[calc(4rem+env(safe-area-inset-bottom))]"
        containerClassName="flex flex-col items-center"
      >
        <Link href="/" className={`rounded-full ${focusRing}`}>
          <Image src="/brand/logo-192.png" alt="Vegas Luxury Hotel — home" width={72} height={72} className="size-16 sm:size-[4.5rem]" />
        </Link>
        <SectionIntro
          align="center"
          as="h1"
          eyebrow="Page not found"
          id="not-found-title"
          title="We couldn’t find that page"
          lede="The link may be old or mistyped. Let’s get you back to the hotel."
          className="mt-10"
        />
        <Actions align="center" className="mt-8">
          <LinkButton href="/" icon="arrow">Back to home</LinkButton>
          <TextLink href="/book">Book your stay</TextLink>
        </Actions>
      </Section>
    </main>
  );
}
