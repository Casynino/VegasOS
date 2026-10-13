import "server-only";
import { db } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { msg } from "@/i18n/msg";

export type PriceActor = AuditActor & { userId: string; permissions: ReadonlySet<string> };

const MAX_PRICE = 5_000_000;

/**
 * Change ONE menu item's selling price — nothing else on the item. For the Accountant ("restaurant.prices") and for whoever
 * sets the menu up ("restaurant.menu"). An order copies the price when it is placed, so an order already placed keeps the
 * price it was made at; the change counts from the next order. The old and the new price go to the audit log with who.
 */
export async function setMenuItemPrice(id: string, price: number, actor: PriceActor) {
  if (!actor.permissions.has("restaurant.prices") && !actor.permissions.has("restaurant.menu")) throw new AppError("You do not have permission to do this.", "FORBIDDEN");
  if (!Number.isInteger(price) || price <= 0 || price > MAX_PRICE) throw new AppError("Enter the price in whole shillings.", "VALIDATION", { price: msg("Invalid") });
  return db.$transaction(async (tx) => {
    const before = await tx.menuItem.findUnique({ where: { id }, select: { id: true, name: true, price: true } });
    if (!before) throw new AppError("Menu item not found.", "NOT_FOUND");
    if (before.price === price) throw new AppError("That is already the price.", "VALIDATION", { price: msg("Same price") });
    // Two people changing the same price at once: only the one who saw the current price wins.
    const done = await tx.menuItem.updateMany({ where: { id, price: before.price }, data: { price, updatedById: actor.userId } });
    if (done.count !== 1) throw new AppError("The price was changed just now. Open it again.", "CONFLICT");
    await audit(tx, actor, { action: "menu.price_changed", entityType: "MenuItem", entityId: id, before: { name: before.name, price: before.price }, after: { name: before.name, price } });
    return { id, name: before.name, from: before.price, to: price };
  });
}
