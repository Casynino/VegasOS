import { StaffShell } from "@/components/staff/staff-shell";
import { STAFF_VIEWPORT } from "@/lib/staff-viewport";

export const viewport = STAFF_VIEWPORT;

export default function ReceptionLayout({ children }: LayoutProps<"/reception">) {
  return <StaffShell>{children}</StaffShell>;
}
