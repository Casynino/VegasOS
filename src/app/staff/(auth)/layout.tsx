import { GuestI18n } from "@/components/i18n/guest-i18n";
import { StaffServiceWorker } from "@/components/staff/staff-service-worker";
import { STAFF_APP_METADATA, STAFF_VIEWPORT } from "@/lib/staff-viewport";

export const viewport = STAFF_VIEWPORT;
export const metadata = STAFF_APP_METADATA;

/**
 * Before signing in: the language of this device (the person's choice, else a Chinese phone → Chinese).
 * The pass-through service worker starts here too (owner, 2026-11-09), so Android Chrome can offer its one-tap "Install app" from the
 * sign-in page itself — "Get the full-screen app" — and not only after the person has signed in.
 */
export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <GuestI18n bundle="staff">
      <StaffServiceWorker />
      {children}
    </GuestI18n>
  );
}
