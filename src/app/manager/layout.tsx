import { StaffShell } from "@/components/staff/staff-shell";

export default function ManagerLayout({ children }: LayoutProps<"/manager">) {
  return <StaffShell>{children}</StaffShell>;
}
