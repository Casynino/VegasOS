import { redirect } from "next/navigation";

/** A waiter's history is for managers and the MD (the Waiters page) — old links land on their Collections. */
export default function MyHistoryPage() {
  redirect("/staff/restaurant/waiter/payments");
}
