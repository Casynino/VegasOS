import { GuestI18n } from "@/components/i18n/guest-i18n";

export default function SpinLayout({ children }: { children: React.ReactNode }) {
  return <GuestI18n>{children}</GuestI18n>;
}
