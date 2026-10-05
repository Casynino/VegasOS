"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Actions, Button, Section, SectionIntro, TextLink } from "@/components/public/kit";
import { LostCompass } from "@/components/public/services/compass";

/**
 * A calm night moment when a public page fails: say what happened, reassure, offer Try again and the
 * front desk. A faint compass searches for its bearing behind the words.
 */
export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Section
      tone="night"
      first
      glow="sky"
      width="narrow"
      labelledBy="error-title"
      className="flex min-h-[80svh] flex-1 flex-col justify-center overflow-hidden pb-24 sm:pb-28"
    >
      <LostCompass y="50%" />
      <SectionIntro
        align="center"
        as="h1"
        eyebrow="A small interruption"
        id="error-title"
        title="We couldn’t load this page just now"
        lede="Please try again in a moment. Nothing you entered has been booked or charged."
      />
      <Actions align="center" className="mt-8">
        <Button onClick={reset}>
          <span className="inline-flex items-center gap-2">
            <RotateCcw className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            Try again
          </span>
        </Button>
        <TextLink href="/contact">Contact the hotel</TextLink>
      </Actions>
    </Section>
  );
}
