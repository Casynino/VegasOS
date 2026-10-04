import { redirect } from "next/navigation";

/** The kitchen is part of the one Restaurant Portal now. */
export default function KitchenPage() {
  redirect("/staff/restaurant");
}
