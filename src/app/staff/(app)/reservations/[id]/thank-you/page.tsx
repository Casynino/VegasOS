import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { siteOrigin } from "@/server/site-origin";
import { thankYouNotes } from "@/server/services/thank-you";
import { reservationMessage } from "@/server/services/guest-message-data";
import { formatDateTime } from "@/lib/format";
import type { StaySnapshot } from "@/lib/thank-you";
import { cn } from "@/lib/utils";
import { ThankYouDocument } from "@/components/staff/thank-you/thank-you-document";
import { SendDocument } from "@/components/staff/invoices/send-document";
import { AutoPrint } from "@/components/staff/invoices/auto-print";
import { MakeNote, PrintNote } from "./controls";
import { getT } from "@/i18n/server";
import { DEFAULT_LOCALE, LOCALE_META } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Thank-you note") };
}

/** The guest's thank-you note: view, print, save as PDF, send to the guest — and its earlier versions. */
export default async function ThankYouPage({ params, searchParams }: PageProps<"/staff/reservations/[id]/thank-you">) {
  const user = await requirePagePermission("reservations.view");
  const t = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const [r, notes, s] = await Promise.all([
    db.reservation.findUnique({ where: { id }, select: { id: true, reference: true, status: true, kind: true, guest: { select: { fullName: true, phone: true, email: true } } } }),
    thankYouNotes(id),
    getSettings(),
  ]);
  if (!r) notFound();
  const wanted = Number(sp.v) || null;
  const note = notes.find((x) => x.version === wanted) ?? notes[0] ?? null;
  const canRemake = can(user, "reservations.checkout_override") || can(user, "invoices.manage");
  const link = note ? `${await siteOrigin()}/thanks/${note.token}` : null;
  // The same message as at check-out: the final bill and the thank-you link, in the one Vegas format — in the guest's language.
  const sent = note ? await reservationMessage(r.id, "CHECKOUT", await siteOrigin(), { thanksUrl: link }) : null;

  return (
    <div className="w-full space-y-5 print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/staff/reservations/${r.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t("Back to {name}", { name: `${r.reference} · ${r.guest.fullName}` })}</Link>
        {note && (
          <div className="flex flex-wrap gap-2">
            <PrintNote label={t("Print")} />
            <PrintNote pdf label={t("Download PDF")} />
            <SendDocument
              entity={{ type: "Reservation", id: r.id }} what={`thank-you note (v${note.version})`}
              label={sent && sent.locale !== DEFAULT_LOCALE ? t("Send to guest ({language})", { language: LOCALE_META[sent.locale].short }) : t("Send to guest")}
              to={{ name: r.guest.fullName, phone: r.guest.phone, email: r.guest.email }}
              subject={sent?.subject ?? `Thank you for staying at ${s.hotelName}`}
              text={sent?.text ?? ""}
            />
            {canRemake && <MakeNote reservationId={r.id} again />}
          </div>
        )}
      </div>

      {!note ? (
        <div className="mx-auto max-w-lg space-y-3 rounded-3xl border border-border/70 bg-card p-8 text-center">
          <p className="font-display text-2xl">{t("No thank-you note yet")}</p>
          <p className="text-sm text-muted-foreground">{r.status === "CHECKED_OUT" ? t("This stay was checked out before notes existed — make it now from the finished stay.") : t("The note is made automatically when the guest checks out.")}</p>
          {r.status === "CHECKED_OUT" && can(user, "reservations.check_out") && <MakeNote reservationId={r.id} again={false} />}
        </div>
      ) : (
        <>
          {notes.length > 1 && (
            <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card px-4 py-2.5 text-xs print:hidden">
              <History className="size-4 text-muted-foreground" /><span className="text-muted-foreground">{t("Versions")}</span>
              {notes.map((x) => (
                <Link key={x.id} href={`?v=${x.version}`} className={cn("rounded-full border px-2.5 py-0.5", x.id === note.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}
                  title={`${t.locale === DEFAULT_LOCALE ? formatDateTime(x.createdAt) : t.dateTime(x.createdAt)}${x.createdBy ? ` · ${x.createdBy.fullName}` : ""}${x.reason ? ` · ${x.reason}` : ""}`}>
                  v{x.version}{x === notes[0] ? ` · ${t("latest")}` : ""}
                </Link>
              ))}
              {note.reason && <span className="text-muted-foreground">· v{note.version}: {note.reason}</span>}
            </div>
          )}
          <ThankYouDocument note={note.snapshot as unknown as StaySnapshot} s={s} preparedAt={note.createdAt} />
          {sp.print === "1" && <AutoPrint />}
        </>
      )}
    </div>
  );
}
