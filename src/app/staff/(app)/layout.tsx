import { StaffShell } from "@/components/staff/staff-shell";

export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return <StaffShell>{children}</StaffShell>;
}
