"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

/**
 * Staff door on the public site. Reads the non-secret `vlh_staff` hint cookie
 * (set at sign-in, cleared at sign-out) so staff who are already signed in are
 * offered their dashboard instead of the login screen. Not a permission check —
 * every staff page authenticates on the server. Read on the client so public
 * pages stay static.
 */
function useStaffHint() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    // Re-read on navigation: someone may sign out in this tab and keep browsing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSignedIn(document.cookie.split("; ").some((c) => c === "vlh_staff=1"));
  }, [pathname]);
  return signedIn;
}

export function StaffLink({
  className,
  onClick,
  withIcon,
  iconOnly,
  labels = { signedIn: msg("Dashboard"), signedOut: msg("Login") },
}: {
  className?: string;
  onClick?: () => void;
  withIcon?: boolean;
  /** Just the icon (the words stay for screen readers) — the phone header. */
  iconOnly?: boolean;
  /** Visible text for each state (e.g. "Staff login" in the footer) — English keys (msg), translated here. */
  labels?: { signedIn: string; signedOut: string };
}) {
  const t = useT();
  const signedIn = useStaffHint();
  const Icon = signedIn ? LayoutDashboard : LockKeyhole;
  const label = t(signedIn ? labels.signedIn : labels.signedOut);
  return (
    <Link href={signedIn ? "/staff" : "/staff/login"} onClick={onClick} className={cn("inline-flex items-center gap-1.5", className)}>
      {(withIcon || iconOnly) && <Icon className={iconOnly ? "size-4" : "size-3.5"} aria-hidden="true" />}
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </Link>
  );
}
