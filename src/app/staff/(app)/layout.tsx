import { after } from "next/server";
import { StaffShell } from "@/components/staff/staff-shell";
import { sweepMobilePaymentsIfDue } from "@/server/services/mobile-payments";

export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  // A mobile-money payment nTZS confirmed but we have not recorded yet is found while staff work (after the page is sent).
  after(() => sweepMobilePaymentsIfDue().catch((e) => console.error("[ntzs] sweep failed", e)));
  return <StaffShell>{children}</StaffShell>;
}
