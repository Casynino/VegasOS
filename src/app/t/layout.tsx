import { GuestI18n } from "@/components/i18n/guest-i18n";

/** Guest pages: in the guest's own language (their choice on this device, else their phone's, else English). */
export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return <GuestI18n>{children}</GuestI18n>;
}
