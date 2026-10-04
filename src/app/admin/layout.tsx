import { StaffShell } from "@/components/staff/staff-shell";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <StaffShell>{children}</StaffShell>;
}
