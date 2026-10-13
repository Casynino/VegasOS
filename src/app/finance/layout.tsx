import { after } from "next/server";
import { StaffShell } from "@/components/staff/staff-shell";
import { sweepMobilePaymentsIfDue } from "@/server/services/mobile-payments";
import { sweepWithdrawalsIfDue } from "@/server/services/withdrawals";

export default function FinanceLayout({ children }: LayoutProps<"/finance">) {
  // Finance holds the money, so its home does what the staff pages do: a mobile-money payment nTZS confirmed but we have not
  // recorded yet, and a withdrawal nTZS has not finished, are looked into while Finance works (after the page is sent).
  after(() => sweepMobilePaymentsIfDue().catch((e) => console.error("[ntzs] sweep failed", e)));
  after(() => sweepWithdrawalsIfDue().catch((e) => console.error("[ntzs] withdrawals sweep failed", e)));
  return <StaffShell>{children}</StaffShell>;
}
