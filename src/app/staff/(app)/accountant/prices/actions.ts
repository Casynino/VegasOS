"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { setMenuItemPrice } from "@/server/services/menu-prices";
import { msg } from "@/i18n/msg";

const Schema = z.object({
  id: z.string().min(10).max(40),
  price: z.coerce.number().int(msg("Whole shillings only.")).positive(msg("Enter the price.")),
});

/** A new selling price for one menu item. Orders already placed keep their price. Only the price changes. */
export async function setMenuPriceAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.prices", "restaurant.menu");
    const { ipAddress } = await requestMeta();
    const input = parseInput(Schema, Object.fromEntries(formData.entries()));
    await setMenuItemPrice(input.id, input.price, { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions });
    revalidatePath("/staff/accountant/prices");
    revalidatePath("/staff/restaurant", "layout");
    revalidatePath("/", "layout"); // the website's menu and the QR menus show the new price
    return null;
  }, msg("Price saved."));
}
