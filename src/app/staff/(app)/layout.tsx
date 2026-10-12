import { after } from "next/server";
import { StaffShell } from "@/components/staff/staff-shell";
import { sweepMobilePaymentsIfDue } from "@/server/services/mobile-payments";
import { sweepWithdrawalsIfDue } from "@/server/services/withdrawals";

export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  // A mobile-money payment nTZS confirmed but we have not recorded yet is found while staff work (after the page is sent).
  after(() => sweepMobilePaymentsIfDue().catch((e) => console.error("[ntzs] sweep failed", e)));
  // A withdrawal nTZS has not finished is asked about the same way (asked only — nothing is ever sent again).
  after(() => sweepWithdrawalsIfDue().catch((e) => console.error("[ntzs] withdrawals sweep failed", e)));
  return <StaffShell>{children}</StaffShell>;
}
