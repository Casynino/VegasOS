import { GuestI18n } from "@/components/i18n/guest-i18n";

/** Before signing in: the language of this device (the person's choice, else a Chinese phone → Chinese). */
export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <GuestI18n bundle="staff">{children}</GuestI18n>;
}
