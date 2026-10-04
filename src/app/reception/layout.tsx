import { StaffShell } from "@/components/staff/staff-shell";

export default function ReceptionLayout({ children }: LayoutProps<"/reception">) {
  return <StaffShell>{children}</StaffShell>;
}
