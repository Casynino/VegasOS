import { redirect } from "next/navigation";

/** Short address staff can type: vegashoteltz.com/login */
export default function LoginShortcut() {
  redirect("/staff/login");
}
