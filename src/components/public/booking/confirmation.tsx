import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { telHref, whatsappHref } from "../contact";
import { Section } from "../kit/section";
import { typeScale } from "../kit/tokens";
import { BookingActions } from "./booking-actions";
import { BookingProgress } from "./progress";

/**
 * The private booking and request pages (/booking/[reference]): a night band that says where the
 * guest is (thank-you, reference, status), then calm hairline lists on paper. Server-safe.
 */

export type StatusTone = "ok" | "muted" | "warn";

/** Printing a night block: dark ink on white paper (browsers drop backgrounds when printing). */
export const printInk =
  "print:bg-none print:bg-transparent print:shadow-none print:ring-0 print:[--pub-fg:#15120e] print:[--pub-muted:#5b5249] print:[--pub-faint:#8a7f72] print:[--pub-line:#d9d2c5] print:[--pub-eyebrow:#7a5a1c]";

/** The status line: a dot and plain words, gold when all is well, the error tone when not. */
export function StatusPill({ label, tone, className }: { label: string; tone: StatusTone; className?: string }) {
  return (
    <p
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-2.5 rounded-full border px-4 py-2 text-[13px] leading-snug",
        tone === "ok" && "border-gold/45 text-pub-fg",
        tone === "muted" && "border-pub-line text-pub-muted",
        tone === "warn" && "border-pub-error/50 text-pub-error",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-gold" : tone === "warn" ? "bg-pub-error" : "bg-pub-faint")}
      />
      <span className="min-w-0">
        <span className="sr-only">Status: </span>
        {label}
      </span>
    </p>
  );
}

/**
 * Opening band of a booking / request page (clears the fixed header): the finished progress
 * line for a new booking, eyebrow, the thank-you (H1), one line, then the reference — sized
 * to fit a 320px phone — with its status.
 */
export function ConfirmationBand({
  progress,
  progressLast,
  eyebrow,
  title,
  lede,
  referenceLabel,
  reference,
  status,
  children,
}: {
  /** Show the completed 5-step line (new bookings and requests only). */
  progress?: boolean;
  progressLast?: string;
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  referenceLabel: string;
  reference: string;
  status?: { label: string; tone: StatusTone } | null;
  /** A line under the reference (e.g. the booking reference of a converted request). */
  children?: React.ReactNode;
}) {
  return (
    <Section tone="night" first space="sm" width="wide" glow="top" labelledBy="confirmation-title" className={cn("pb-10 sm:pb-14 lg:pb-14 print:pt-6", printInk)}>
      {progress && <BookingProgress current={5} last={progressLast} className="mb-10 max-w-3xl sm:mb-12 print:hidden" />}
      <p className={cn(typeScale.eyebrow, "flex items-center gap-2.5 text-pub-eyebrow")}>{eyebrow}</p>
      <h1 id="confirmation-title" className={cn(typeScale.title, "mt-4 max-w-3xl")}>
        {title}
      </h1>
      {lede && <div className={cn(typeScale.lede, "mt-4 max-w-[38rem] text-pub-muted sm:mt-5")}>{lede}</div>}
      <div className="mt-8 flex flex-col gap-5 border-t border-pub-line pt-6 sm:mt-10 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <p className={cn(typeScale.meta, "text-pub-muted")}>{referenceLabel}</p>
          <p className="mt-2 font-display text-[clamp(1.875rem,1.25rem+2.6vw,3rem)] font-medium leading-none tracking-[0.04em] text-pub-eyebrow lining-nums [overflow-wrap:anywhere]">
            {reference}
          </p>
          {children}
        </div>
        {status && <StatusPill label={status.label} tone={status.tone} className="shrink-0" />}
      </div>
    </Section>
  );
}

/** Check-in → check-out (or a meeting's date → time) as two quiet columns. */
export function DatePair({ from, to }: { from: { label: string; date: string; note?: string }; to: { label: string; date: string; note?: string } }) {
  const col = (d: { label: string; date: string; note?: string }) => (
    <div className="min-w-0 py-5">
      <dt className={cn(typeScale.meta, "text-pub-muted")}>{d.label}</dt>
      <dd className="mt-2 font-display text-[clamp(1.25rem,1.1rem+0.6vw,1.625rem)] leading-tight text-pub-fg lining-nums text-balance">{d.date}</dd>
      {d.note && <dd className="mt-1 text-[13px] text-pub-muted">{d.note}</dd>}
    </div>
  );
  return (
    <dl className="grid grid-cols-2 gap-x-6 border-y border-pub-line sm:gap-x-10">
      {col(from)}
      <div className="min-w-0 border-l border-pub-line pl-6 sm:pl-10">{col(to)}</div>
    </dl>
  );
}

/** One fact of the stay: the term on the left, the value (and an optional amount) beside it. */
export function FactRow({ term, children, amount }: { term: React.ReactNode; children: React.ReactNode; amount?: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-pub-line py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
      <dt className={cn(typeScale.meta, "text-pub-muted sm:pt-1")}>{term}</dt>
      <dd className="flex min-w-0 items-start justify-between gap-4 text-[15px] leading-relaxed text-pub-fg">
        <span className="min-w-0">{children}</span>
        {amount != null && <span className="shrink-0 tabular-nums">{amount}</span>}
      </dd>
    </div>
  );
}

const rowLink =
  "flex min-h-12 min-w-0 items-center gap-3 py-2 text-[15px] text-pub-fg transition-colors duration-200 hover:text-pub-eyebrow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none";

/** How to reach the front desk about this booking: hairline rows (phone, WhatsApp, email, address). */
export function ContactRows({
  phone,
  whatsapp,
  whatsappText,
  email,
  emailSubject,
  address = [],
}: {
  phone: string | null;
  whatsapp: string | null;
  whatsappText: string;
  email: string | null;
  emailSubject: string;
  address?: string[];
}) {
  return (
    <ul className="grid border-t border-pub-line sm:grid-cols-2 sm:gap-x-10">
      {phone && (
        <li className="border-b border-pub-line">
          <a href={telHref(phone)} className={rowLink}>
            <Phone className="size-4 shrink-0 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />
            {phone}
          </a>
        </li>
      )}
      {whatsapp && (
        <li className="border-b border-pub-line">
          <a href={whatsappHref(whatsapp, whatsappText)} target="_blank" rel="noopener noreferrer" className={rowLink}>
            <MessageCircle className="size-4 shrink-0 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />
            WhatsApp<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      )}
      {email && (
        <li className="border-b border-pub-line">
          <a href={`mailto:${email}?subject=${encodeURIComponent(emailSubject)}`} className={rowLink}>
            <Mail className="size-4 shrink-0 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{email}</span>
          </a>
        </li>
      )}
      {address.length > 0 && (
        <li className="flex min-h-12 items-start gap-3 border-b border-pub-line py-3.5 text-[15px] leading-snug text-pub-muted">
          <MapPin className="mt-0.5 size-4 shrink-0 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />
          <span className="min-w-0">{address.join(", ")}</span>
        </li>
      )}
    </ul>
  );
}

/** "Keep this page's link" with Copy link / Print. */
export function KeepLink({ what }: { what: string }) {
  return (
    <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8 print:hidden">
      <p className="max-w-[30rem] text-[14px] leading-relaxed text-pub-muted">
        <strong className="font-medium text-pub-fg">Keep this page’s link</strong> — it’s your private link to {what}.
      </p>
      <BookingActions />
    </div>
  );
}
