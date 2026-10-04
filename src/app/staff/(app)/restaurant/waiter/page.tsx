import { redirect } from "next/navigation";

/** A waiter's Home is the Live board now (their shift sits on it) — old links land there. */
export default function WaiterWorkspacePage() {
  redirect("/staff/restaurant");
}
