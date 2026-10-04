import "server-only";
import { z } from "zod";
import { isRestaurantDevice } from "@/lib/permissions";
import { requestMeta, type CurrentUser } from "./auth";
import { AppError } from "./errors";
import { waiterOnCounter } from "./services/waiter-on-counter";

/** The waiter chosen on the shared Restaurant Counter ("who serves it?"), sent with an action (the field is called `pin`). */
export const WaiterPin = z.object({ waiterId: z.string().min(1).max(40) });
export type WaiterPinInput = z.input<typeof WaiterPin>;

/**
 * Who is acting. On a personal account (a waiter's own phone, reception, a manager): the person
 * signed in. On the shared Restaurant Counter, service work (an order, serving one nobody has,
 * seating, a transfer) is done for the waiter picked from the list of waiters — the work is theirs,
 * with the Counter noted. No code or password: money never goes to a waiter (the Counter records it).
 */
export async function actingWaiter(user: CurrentUser, pin: WaiterPinInput | null | undefined, what: string, opts: { requireShift?: boolean } = {}) {
  const { ipAddress } = await requestMeta();
  if (!isRestaurantDevice(user.permissions)) {
    return { userId: user.id, label: user.fullName, role: user.roleName, ipAddress, permissions: user.permissions as ReadonlySet<string>, deviceUserId: null as string | null };
  }
  if (!pin) throw new AppError(`On the Restaurant Counter, ${what} needs the waiter who serves it — choose them from the list.`, "VALIDATION", { pin: "Required" });
  const p = WaiterPin.safeParse(pin);
  if (!p.success) throw new AppError("Choose the waiter from the list.", "VALIDATION", { pin: "Invalid" });
  const w = await waiterOnCounter(p.data.waiterId, { id: user.id, label: user.fullName }, opts);
  return { ...w, ipAddress } as typeof w & { ipAddress: string | null; deviceUserId: string | null };
}
