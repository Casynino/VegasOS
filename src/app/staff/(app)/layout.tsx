import { Suspense } from "react";
import { after } from "next/server";
import { StaffShell } from "@/components/staff/staff-shell";
import { getCurrentUser } from "@/server/auth";
import { sweepMobilePaymentsIfDue } from "@/server/services/mobile-payments";
import { sweepWithdrawalsIfDue } from "@/server/services/withdrawals";
import { trackDeveloperView } from "@/server/services/developer-view-log";
import { DeveloperViewBeacon } from "./developer/view-beacon";

export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  // A mobile-money payment nTZS confirmed but we have not recorded yet is found while staff work (after the page is sent).
  after(() => sweepMobilePaymentsIfDue().catch((e) => console.error("[ntzs] sweep failed", e)));
  // A withdrawal nTZS has not finished is asked about the same way (asked only — nothing is ever sent again).
  after(() => sweepWithdrawalsIfDue().catch((e) => console.error("[ntzs] withdrawals sweep failed", e)));
  return (
    <>
      <StaffShell>{children}</StaffShell>
      <Suspense fallback={null}><DeveloperVisits /></Suspense>
    </>
  );
}

/**
 * A Developer's visit to a page is noted in the audit trail (src/server/services/developer-view-log.ts) — every page except the few
 * plainly harmless ones, a new page too. It sits beside the shell, not around it: it never holds the page back, and a failure here never
 * breaks the page (it is written to the server log). Staff get nothing from it.
 */
async function DeveloperVisits() {
  let developer = false;
  try {
    const user = await getCurrentUser();
    if (user?.actorType === "DEVELOPER") {
      developer = true;
      await trackDeveloperView(user);
    }
  } catch { /* looking must never break the page */ }
  return developer ? <DeveloperViewBeacon /> : null;
}
