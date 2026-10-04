import { redirect } from "next/navigation";

/** Short address staff can type: vegasluxuryhotel.co.tz/login */
export default function LoginShortcut() {
  redirect("/staff/login");
}
