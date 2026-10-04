"use server";

import { authorize } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { customerByPhone, findCustomers, type CustomerHit, type KnownCustomer } from "@/server/services/guests";

/** Staff typed a phone number: is this a customer we know? (For everyone who takes orders, seats or books.) */
export async function customerByPhoneAction(phone: string): Promise<ActionResult<KnownCustomer | null>> {
  return runAction(async () => {
    await authorize("guests.view", "reservations.create", "restaurant.orders", "restaurant.serve", "kitchen.orders");
    return customerByPhone(String(phone ?? "").slice(0, 30));
  });
}

/** Staff who see customers (reception, waiters, the Counter, managers — not the Mpishi) search them by name or number. */
export async function findCustomersAction(q: string): Promise<ActionResult<CustomerHit[]>> {
  return runAction(async () => {
    await authorize("guests.view");
    return findCustomers(String(q ?? "").slice(0, 60));
  });
}
