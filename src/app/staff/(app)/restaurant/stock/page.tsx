import { redirect } from "next/navigation";

/** Stock requests moved to Stores → Stock requests (every department asks there). */
export default function OldStockRequestsPage() {
  redirect("/staff/stock-requests");
}
