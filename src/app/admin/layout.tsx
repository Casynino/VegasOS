import { StaffShell } from "@/components/staff/staff-shell";
import { STAFF_VIEWPORT } from "@/lib/staff-viewport";

export const viewport = STAFF_VIEWPORT;

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <StaffShell>{children}</StaffShell>;
}
