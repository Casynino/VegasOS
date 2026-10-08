"use server";

import { revalidatePath } from "next/cache";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { setMenuItemAvailable } from "@/server/services/restaurant";
import { msg } from "@/i18n/msg";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}

/** The kitchen marks a dish sold out / available again. */
export async function setDishAvailableAction(input: { id: string; isAvailable: boolean }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("kitchen.orders", "restaurant.menu");
    await setMenuItemAvailable(input.id, input.isAvailable, await actor(user));
    revalidatePath("/staff/restaurant", "layout");
    revalidatePath("/order");
    revalidatePath("/menu");
    return null;
  }, input.isAvailable ? msg("Back on the menu.") : msg("Marked as sold out — customers can't order it now."));
}
