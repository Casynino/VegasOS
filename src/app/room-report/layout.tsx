import { GuestI18n } from "@/components/i18n/guest-i18n";

/** A report link (sent by WhatsApp): in the reader's language (?lang= on the link, their choice, their phone's). */
export default function ReportLinkLayout({ children }: { children: React.ReactNode }) {
  return <GuestI18n bundle="staff">{children}</GuestI18n>;
}
