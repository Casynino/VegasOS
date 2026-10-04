import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings } from "@/server/settings";
import { thankYouByToken } from "@/server/services/thank-you";
import type { StaySnapshot } from "@/lib/thank-you";
import { ThankYouDocument } from "@/components/staff/thank-you/thank-you-document";
import { GuestPrintButton } from "./print-button";

export const metadata: Metadata = {
  title: "Thank you for staying with us",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** The guest's own copy of their thank-you note (the link sent by reception) — view, print or save as PDF. */
export default async function GuestThankYouPage({ params }: PageProps<"/thanks/[token]">) {
  const { token } = await params;
  const [note, s] = await Promise.all([thankYouByToken(token), getSettings()]);
  if (!note) notFound();
  return (
    <main className="min-h-svh bg-[#ece6da] px-3 py-6 sm:px-6 sm:py-10 print:bg-white print:p-0">
      <ThankYouDocument note={note.snapshot as unknown as StaySnapshot} s={s} preparedAt={note.createdAt} />
      <div className="mx-auto mt-5 flex max-w-[860px] justify-center print:hidden"><GuestPrintButton /></div>
    </main>
  );
}
