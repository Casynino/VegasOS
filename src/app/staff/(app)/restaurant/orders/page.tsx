import { redirect } from "next/navigation";

/** There is no list of orders at this address (an order opens at /staff/restaurant/orders/<id>): "one level up" from an order is the restaurant. */
export default function OrdersIndex() {
  redirect("/staff/restaurant");
}
